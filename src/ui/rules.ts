/**
 * «Правила игры»: подробное описание экономики, собранное из тех же данных,
 * по которым считает движок.
 *
 * Принцип: ни одно число здесь не написано руками. Цены, сроки, доли и
 * мощности берутся из `config.json` и `upgrades.json`, поэтому правила
 * физически не могут разойтись с игрой. Формулировки — из `texts.json`.
 */
import { el } from './dom';
import { describeRequirementTerm } from './requirements';
import type { Texts } from './texts';
import { formatMoney, formatNumber, formatPercent } from '../core/format';
import type { Content } from '../core/types';
import {
  INVESTMENT_RATE_MAX_PERCENT,
  INVESTMENT_RATE_MIN_PERCENT,
  INVESTMENT_YEAR_DAYS,
  computeDerived,
  constructionCostMultiplier,
  currencyCostCurveOf,
  wellDeclineFloorSeconds,
  winCostOf,
  winRequirementTerms,
} from '../core/economy';
import { createInitialState } from '../core/state';

export class Rules {
  readonly root: HTMLElement;

  constructor(
    private readonly content: Content,
    private readonly texts: Texts,
    private readonly currency: string,
    private readonly onClose: () => void,
  ) {
    const close = el('button', { class: 'btn btn--gold', type: 'button' }, texts.get('panel.close'));
    close.addEventListener('click', () => this.onClose());

    this.root = el('div', {
      class: 'sheet sheet--rules',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': texts.get('rules.title'),
    }, [
      el('div', { class: 'sheet__inner sheet__inner--rules' }, [
        el('h2', { class: 'sheet__title' }, texts.get('rules.title')),
        el('p', { class: 'rules__lead' }, texts.get('rules.lead')),
        ...this.sections(),
        close,
      ]),
    ]);
    // Клик по затемнению вокруг листа закрывает окно — как в остальных шторках.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.onClose();
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Параграф: заголовок и строки. Тексты — только из texts.json. */
  private section(titleKey: string, lines: Array<string | HTMLElement>): HTMLElement {
    return el('section', { class: 'rules__section' }, [
      el('h3', { class: 'rules__title' }, this.texts.get(titleKey)),
      el('ul', { class: 'rules__list' }, lines.map((line) =>
        typeof line === 'string' ? el('li', {}, line) : el('li', { class: 'rules__item--formula' }, line))),
    ]);
  }

  private sections(): HTMLElement[] {
    const { config, upgrades } = this.content;
    const t = (key: string, params: Record<string, string | number> = {}): string =>
      this.texts.get(key, params);
    const tonnes = t('units.tonnes');
    const perSecond = t('units.perSecond');
    const price = (value: number): string => `${formatMoney(value, this.currency)}/${tonnes}`;
    const rate = (value: number): string =>
      t('units.tonnesRate', { value: formatNumber(value), tonnes, s: perSecond.replace('/', '') });

    const oil = config.oil;
    const contract = oil.channels.contract;
    const exportChannel = oil.channels.export;
    const base = oil.basePricePerTon;
    const daySeconds = oil.wells.secondsPerDay;
    const shipSeconds = oil.shipDays * daySeconds;
    const crew = oil.autoDrill.requires.map((id) => this.content.byId.get(id)?.name ?? id);
    const winTerms = winRequirementTerms(config);
    // Стартовые мощности берём у движка, а не пересчитываем формулой здесь:
    // так правила показывают ровно тот предел, которым ограничена продажа.
    const initial = computeDerived(config, upgrades, createInitialState(config, 1), [], this.content);
    const declineFloorSeconds = wellDeclineFloorSeconds(config);
    /** Что покажет ядро, если купить перечисленные покупки до последнего уровня. */
    const derivedAtMax = (owned: readonly { id: string; maxLevel: number }[]) => {
      const state = createInitialState(config, 1);
      for (const def of owned) state.levels[def.id] = def.maxLevel;
      return computeDerived(config, upgrades, state, [], this.content);
    };

    // Предел множителя добычи от договоров: все покупки сбыта на последнем
    // уровне. Какие из них договоры и как складываются итоги, решает ядро.
    const maxSalesBoost = derivedAtMax(upgrades.filter((def) => def.type === 'sell')).salesVolumeMultiplier;

    // Всё влияние, которое продаётся в магазине. Потолки ставки по счёту и
    // скидки на штраф могут быть выше — тогда правила называют и достижимое.
    const attainable = derivedAtMax(upgrades.filter((def) => def.effect.influence));
    const finesCap = Math.ceil(config.fines.maxRelief / config.fines.influenceReliefPerPoint);

    // Механики, которые включает одна покупка: правила называют её по имени.
    const damper = upgrades.find((def) => def.effect.fuelDamper);
    const capitalFlight = upgrades.find((def) => def.effect.capitalFlightPerSecond);
    const devaluation = upgrades.filter((def) => def.type === 'priceBoost' && def.effect.exchangeRateDevaluation);
    const maxRate = derivedAtMax(devaluation).exchangeRate;
    // Стройка дорожает вместе с курсом; насколько — считает та же функция,
    // что и цену в магазине. Скважина здесь — образец строительной покупки.
    const built = upgrades.find((def) => def.type === 'well');
    const capexGrowth = built
      ? constructionCostMultiplier(config, built, maxRate) /
        constructionCostMultiplier(config, built, initial.exchangeRate) - 1
      : 0;

    const curve = currencyCostCurveOf(config);
    const levelGrowth = config.costGrowth - 1;
    const compressedGrowth = Math.pow(config.costGrowth, curve.exponent) - 1;
    /** Дробь с запятой и без хвостовых нулей: 0,065. */
    const decimal = (value: number, digits: number): string =>
      value.toFixed(digits).replace(/\.?0+$/, '').replace('.', ',');

    return [
      this.section('rules.goalTitle', [
        t('rules.goalText', {
          cost: formatMoney(winCostOf(config, upgrades), this.currency),
          pump: this.texts.get('finale.pumpName'),
        }),
        // Условия берутся из того же расчёта, что и проверка финала в ядре:
        // пороги итоговые, а требование из нескольких условий печатается целиком.
        ...(winTerms.length > 0 ? [t('rules.goalRequirements', {
          requirements: winTerms
            .map((term) => describeRequirementTerm(term, this.content, this.texts, this.currency))
            .join('; '),
        })] : []),
      ]),

      this.section('rules.productionTitle', [
        t('rules.productionText'),
        t('rules.autoDrillText', {
          crew: crew.join(', '),
          bonus: formatPercent(oil.autoDrill.bonus, 0),
        }),
        // Потолок добычи: число из конфига и пометка, которую покажет панель.
        t('rules.productionCapText', {
          cap: t('units.tonnesRate', {
            value: formatMoney(oil.maxProductionPerSecond, '').trim(),
            tonnes,
            s: perSecond.replace('/', ''),
          }),
          label: this.texts.get('hud.production'),
          mark: this.texts.get('hud.productionCap'),
        }),
        // Договоры о сбыте умножают саму добычу (REVIEW A5).
        ...(maxSalesBoost > 1 ? [t('rules.salesBoostText', {
          tab: this.texts.get('tabs.sales'),
          label: this.texts.get('hud.salesBoost'),
          max: t('units.times', { value: formatNumber(maxSalesBoost) }),
        })] : []),
      ]),

      this.section('rules.wellsTitle', [
        t('rules.wellsText', { day: daySeconds }),
        // Время до пола считает ядро по той же формуле, что и сам дебит.
        declineFloorSeconds > 0 && Number.isFinite(declineFloorSeconds)
          ? t('rules.wellsDecline', {
              min: formatPercent(oil.wells.decline.minFactor, 0),
              minutes: Math.max(1, Math.round(declineFloorSeconds / 60)),
            })
          : t('rules.wellsNoDecline'),
        t('rules.wellsClasses', {
          list: oil.wells.classes
            .map((cls) =>
              t('rules.wellClass', {
                name: this.texts.get(`wells.${cls.key}`),
                chance: Math.round(cls.chance * 100),
                min: formatNumber(cls.minDailyTonnes),
                max: formatNumber(cls.maxDailyTonnes),
                unit: tonnes,
              }),
            )
            .join('; '),
        }),
      ]),

      this.section('rules.storageTitle', [
        t('rules.storageText', {
          days: oil.shipDays,
          seconds: shipSeconds,
          base: formatNumber(oil.baseCapacity),
          unit: tonnes,
        }),
        t('rules.storageOverflow', {}),
        t('rules.pipelineText', {}),
      ]),

      this.section('rules.channelsTitle', [
        contract.unlimited
          ? t('rules.channelDomesticUnlimited')
          : t('rules.channelDomestic', {
              rate: rate(initial.capacities.domestic.crude),
              price: price(base * contract.priceFactor),
            }),
        t('rules.channelExport', {
          rate: rate(exportChannel.baseRate),
          price: price(base * exportChannel.priceFactor),
        }),
        t('rules.channelRefine', {
          yield: formatPercent(oil.refineryYield, 0),
        }),
        // Сколько рынок готов принять и как поставки выбирают, куда идти.
        t('rules.marketsText', {}),
        t('rules.marketsRedirect', {}),
      ]),

      // Разлив: откуда берётся штраф и как его уменьшить.
      this.section('rules.finesTitle', [
        t('rules.finesText', {
          oil: formatMoney(config.fines.oilPerTon, this.currency),
          product: formatMoney(config.fines.productPerTon, this.currency),
        }),
        [
          t('rules.finesInfluence', {
            relief: formatPercent(config.fines.influenceReliefPerPoint, 1),
            max: formatPercent(config.fines.maxRelief, 1),
            // Влияние, после которого скидка упирается в потолок.
            cap: formatNumber(finesCap),
          }),
          ...(attainable.influence < finesCap ? [t('rules.finesReach', {
            have: formatNumber(attainable.influence),
            relief: formatPercent(1 - attainable.fineFactor, 0),
          })] : []),
        ].join(' '),
        t('rules.finesTable', {}),
      ]),

      this.section('rules.productsTitle', [
        t('rules.productsText', {
          yield: formatPercent(oil.refineryYield, 0),
        }),
        t('rules.productPrices', {
          domestic: price(base * config.product.domesticPriceFactor),
          export: price(base * config.product.exportPriceFactor),
        }),
      ]),

      this.section('rules.worldPriceTitle', [
        t('rules.worldPriceText', {
          min: formatMoney(base * config.worldPrice.min, this.currency),
          max: formatMoney(base * config.worldPrice.max, this.currency),
          period: config.worldPrice.periodSeconds,
        }),
      ]),

      this.section('rules.moneyTitle', [
        t('rules.taxText', {
          base: formatPercent(config.tax.baseRate, 0),
          min: formatPercent(config.tax.minRate, 0),
          drop: decimal(config.tax.influenceDrop * 100, 3),
        }),
        t('rules.expensesText', {
          salaries: formatMoney(config.expenses.baseSalaries, this.currency),
          officials: formatMoney(config.expenses.baseOfficials, this.currency),
          share: formatPercent(config.expenses.salariesPerGross, 1),
        }),
        t('rules.ebtText', {}),
        // Формула — отдельным пунктом с рамкой: её ищут глазами.
        el('p', { class: 'rules__formula' }, t('rules.formula', {})),
        t('rules.profitText', {}),
        // Доходы помимо продажи нефти: проценты, демпфер, вывоз капитала.
        [
          t('rules.investmentText', {
            min: formatPercent(INVESTMENT_RATE_MIN_PERCENT / 100, 0),
            max: formatPercent(INVESTMENT_RATE_MAX_PERCENT / 100, 0),
            cap: formatNumber(config.influence.cap),
            days: INVESTMENT_YEAR_DAYS,
          }),
          ...(attainable.influence < config.influence.cap ? [t('rules.investmentReach', {
            have: formatNumber(attainable.influence),
            rate: formatPercent(attainable.investmentRatePercent / 100, 1),
          })] : []),
        ].join(' '),
        ...(damper ? [t('rules.damperText', { name: damper.name })] : []),
        ...(capitalFlight ? [t('rules.capitalFlightText', {
          name: capitalFlight.name,
          value: t('units.moneyRate', {
            value: formatMoney(capitalFlight.effect.capitalFlightPerSecond ?? 0, this.currency),
            s: perSecond.replace('/', ''),
          }),
          growth: formatPercent(capitalFlight.effect.capitalFlightGrowthPerMinute ?? 0, 0),
        })] : []),
        t('rules.externalIncomeText', {}),
        t('rules.untaxedText', {}),
      ]),

      this.section('rules.upgradesTitle', [
        t('rules.upgradesText', {
          count: upgrades.filter((u) => !u.win).length,
        }),
        // Рост цены уровня и сжатие больших цен общей кривой.
        compressedGrowth < levelGrowth
          ? t('rules.costText', {
              growth: formatPercent(levelGrowth, 0),
              anchor: formatMoney(curve.anchor, this.currency),
              slow: formatPercent(compressedGrowth, 1),
            })
          : t('rules.costTextFlat', { growth: formatPercent(levelGrowth, 0) }),
        t('rules.conquestText', {
          min: oil.conquestWells.min,
          max: oil.conquestWells.max,
        }),
        t('rules.bankText', {}),
        ...(devaluation.length > 0 ? [t('rules.devaluationText', {
          name: devaluation.map((def) => def.name).join('», «'),
          step: formatPercent(devaluation[0]?.effect.exchangeRateDevaluation ?? 0, 0),
          rate: t('units.times', { value: formatNumber(maxRate / initial.exchangeRate) }),
          capex: formatPercent(capexGrowth, 0),
        })] : []),
      ]),

      this.section('rules.saveTitle', [
        // Скорость офлайн-дохода — из конфига: «как в игре» пишем, только
        // если она действительно полная.
        config.offline.efficiency >= 1
          ? t('rules.saveText', { cap: Math.round(config.offline.capSeconds / 60) })
          : t('rules.saveTextSlow', {
              cap: Math.round(config.offline.capSeconds / 60),
              efficiency: formatPercent(config.offline.efficiency, 0),
            }),
      ]),
    ];
  }
}
