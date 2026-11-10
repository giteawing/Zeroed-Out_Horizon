/**
 * Магазин: вкладки «Политические / Технические / Роскошь / Цель» и список покупок.
 *
 * Два режима работы:
 *   • в браузере (main.ts) — обновляет существующие карточки, чтобы не
 *     пересобирать DOM каждый кадр (важно для 60 fps на телефоне);
 *   • в тестах (happy-dom) — просто render(), чтобы проверять разметку.
 */
import { clear, el } from './dom';
import { describeRequirementTerm } from './requirements';
import type { Texts } from './texts';
import { formatMoney, formatNumber, formatPercent } from '../core/format';
import { icon as iconPath } from '../core/assets';
import { isRepeatable, type BuyCheck, type Game } from '../core/game';
import { winRequirementBlocker, winRequirementTerms, type RequirementTerm } from '../core/economy';
import type { Tab, UpgradeDef } from '../core/types';

interface CardRefs {
  root: HTMLElement;
  level: HTMLElement;
  effect: HTMLElement;
  cost: HTMLElement;
  button: HTMLButtonElement;
  lock: HTMLElement;
}

export interface ShopOptions {
  onBuy: (id: string, count: number) => void;
}

const TABS: Tab[] = ['technical', 'production', 'sales', 'political', 'luxury', 'goals'];

export class Shop {
  readonly root: HTMLElement;
  private readonly tabBar: HTMLElement;
  private readonly list: HTMLElement;
  private readonly cards = new Map<string, CardRefs>();
  private readonly buttons = new Map<Tab, HTMLButtonElement>();
  private active: Tab = 'technical';
  private visibleSignature = '';

  constructor(
    private readonly game: Game,
    private readonly texts: Texts,
    private readonly currency: string,
    private readonly options: ShopOptions,
  ) {
    this.tabBar = el('div', { class: 'tabs', role: 'tablist' });
    for (const tab of TABS) {
      const button = el('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        'data-tab': tab,
        'aria-selected': 'false',
      }, this.texts.get(`tabs.${tab}`));
      button.addEventListener('click', () => this.setTab(tab));
      this.buttons.set(tab, button);
      this.tabBar.append(button);
    }
    this.list = el('div', { class: 'shop__list', role: 'tabpanel' });
    this.root = el('section', { class: 'shop' }, [this.tabBar, this.list]);
    this.setTab(this.active);
  }

  get activeTab(): Tab {
    return this.active;
  }

  setTab(tab: Tab): void {
    this.active = tab;
    for (const [key, button] of this.buttons) {
      button.setAttribute('aria-selected', String(key === tab));
      button.classList.toggle('tab--active', key === tab);
    }
    this.buildList();
  }

  /** Полная перерисовка списка (при смене вкладки или разблокировке). */
  private buildList(): void {
    clear(this.list);
    this.cards.clear();
    const defs = this.defsFor(this.active);
    if (defs.length === 0) {
      this.list.append(el('p', { class: 'shop__empty' }, this.texts.get('shop.emptyTab')));
      return;
    }
    for (const def of defs) {
      const card = this.buildCard(def);
      this.cards.set(def.id, card.refs);
      this.list.append(card.node);
    }
    this.visibleSignature = this.signature(defs);
  }

  private defsFor(tab: Tab): UpgradeDef[] {
    // Показываем ВСЁ, что есть на вкладке: игрок должен видеть, к чему идёт.
    // Заблокированные карточки неактивны, а красной строкой написано, что нужно.
    return this.game.content.upgrades
      .filter((u) => u.tab === tab)
      .sort((a, b) => a.baseCost - b.baseCost);
  }

  private signature(defs: UpgradeDef[]): string {
    return defs.map((def) => `${def.id}:${this.game.checkBuy(def.id).unlocked ? 1 : 0}`).join('|');
  }

  private buildCard(def: UpgradeDef): { node: HTMLElement; refs: CardRefs } {
    const icon = el('img', {
      class: 'card__icon',
      src: iconPath(def.icon),
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      width: 56,
      height: 56,
    });
    const level = el('span', { class: 'card__level' }, '');
    const effect = el('span', { class: 'card__effect' }, '');
    const cost = el('span', { class: 'card__cost' }, '');
    const button = el('button', { class: 'card__buy', type: 'button' }, this.texts.get('shop.buy'));
    const lock = el('span', { class: 'card__lock' }, '');

    button.addEventListener('click', () => {
      const count = Math.max(1, Number(button.dataset.count ?? 1));
      // Кнопка недоступной покупки выключена (`disabled`), а причина уже
      // написана на карточке. Проверка здесь — защита от устаревшей карточки:
      // состояние могло измениться между обновлениями интерфейса.
      if (!this.game.checkBuy(def.id, count).ok) return;
      this.options.onBuy(def.id, count);
    });

    const refs: CardRefs = { root: el('article'), level, effect, cost, button, lock };

    const node = el('article', { class: 'card', 'data-id': def.id }, [
      el('div', { class: 'card__art' }, [icon, level]),
      el('div', { class: 'card__body' }, [
        el('h3', { class: 'card__name' }, this.cardName(def)),
        el('p', { class: 'card__desc' }, this.descriptionOf(def)),
        el('div', { class: 'card__meta' }, [effect, cost]),
        lock,
      ]),
      el('div', { class: 'card__action' }, [button]),
    ]);
    refs.root = node;
    this.refreshCard(def, refs);
    return { node, refs };
  }

  /**
   * Название карточки. У улучшений с историей (долото, насос, двигатель,
   * раствор, ГРП) каждая покупка — новая модель, поэтому показываем
   * следующую модель, а купленную — в подписи эффекта.
   */
  private cardName(def: UpgradeDef): string {
    if (!def.staged) return def.name;
    // Показываем ту модель, которую игрок купит следующим нажатием.
    const level = Math.max(1, this.game.level(def.id) + 1);
    return this.game.stagedName(def.id, level);
  }

  /** Применить текущее состояние к карточке (дешёвая операция, вызывается часто). */
  private refreshCard(def: UpgradeDef, refs: CardRefs): void {
    let check = this.game.checkBuy(def.id);
    const level = check.level;
    // Действие с перезарядкой (контрабанда, кризис, отмывание) не
    // «прокачивается»: у него нет максимума, иначе кнопка мигала бы между
    // «Купить» и «Максимум» после первой покупки.
    const repeatable = isRepeatable(def);

    // У покупок-действий уровень не растёт — показываем уровень коротко,
    // иначе бейдж «1/1» выглядел бы как ошибка.
    refs.level.textContent = repeatable ? '×' : `${level}/${check.maxLevel}`;
    refs.level.hidden = level <= 0 && !repeatable;
    const name = this.cardName(def);
    const nameNode = refs.root.querySelector('.card__name');
    if (nameNode && nameNode.textContent !== name) nameNode.textContent = name;
    refs.effect.textContent = this.describeEffect(def, level);
    const lockText = this.describeLock(def, check);
    if (refs.lock.textContent !== lockText) refs.lock.textContent = lockText;
    refs.lock.hidden = lockText.length === 0;

    const maxed = !repeatable && !def.win && level >= check.maxLevel;
    const onCooldown = check.cooldownMs > 0;
    // Подпись, цена и обработчик используют одно и то же количество.
    // Для repeatable и финальной покупки пачек не существует.
    const bulkCount = !repeatable && !def.win && !maxed && !onCooldown
      ? Math.min(check.affordable, 10, this.game.config.maxBuyLevels)
      : 1;
    if (bulkCount > 1) check = this.game.checkBuy(def.id, bulkCount);
    refs.button.dataset.count = String(Math.max(1, check.count));
    refs.cost.textContent = maxed
      ? this.texts.get('shop.maxLevel')
      : formatMoney(check.cost, this.currency);

    let label = this.texts.get('shop.buy');
    if (def.win) label = this.texts.get('finale.buyButton');
    else if (maxed) label = this.texts.get('shop.maxLevel');
    else if (onCooldown) {
      label = this.texts.get('shop.cooldown', { seconds: Math.ceil(check.cooldownMs / 1000) });
    } else if (check.affordable > 1 && !repeatable) {
      label = this.texts.get('shop.buyMax', { n: Math.min(check.affordable, 10) });
    }
    refs.button.textContent = label;
    refs.button.disabled = !check.ok;
    refs.button.dataset.reason = check.reason ?? 'ok';

    refs.root.classList.toggle('card--locked', !check.unlocked);
    refs.root.classList.toggle('card--maxed', maxed);
    refs.root.classList.toggle('card--conquest', !!def.conquest);
    refs.root.classList.toggle('card--win', !!def.win);
    refs.root.classList.toggle('card--ready', def.win ? check.ok : false);
  }

  private describeEffect(def: UpgradeDef, level: number): string {
    const e = def.effect;
    const t = (key: string, params: Record<string, string | number> = {}) =>
      this.texts.get(`shop.${key}`, params);
    switch (def.type) {
      case 'production':
        return t('effectProduction', { value: formatNumber(e.value ?? 0) });
      case 'passive': {
        const parts: string[] = [];
        if (this.game.config.oil.autoDrill.requires.includes(def.id)) {
          parts.push(t('effectCrew', {
            value: formatPercent(this.game.config.oil.autoDrill.bonus, 0),
          }));
        }
        if (def.group === 'staff' || def.group === 'crew') parts.push(t('effectStaff'));
        if (def.id === 't_pump4') parts.push(t('effectGoalStage', { level: 5 }));
        if (e.value) parts.push(t('effectPassive', { value: formatNumber(e.value) }));
        if (e.exportBonus) {
          parts.push(t('effectPassiveExport', { value: formatPercent(e.exportBonus, 1) }));
        }
        if (e.salaryAdd) {
          parts.push(t('effectPassiveSalary', { value: formatPercent(e.salaryAdd, 1) }));
        }
        if (e.influence) parts.push(t('effectInfluence', { value: formatNumber(e.influence) }));
        if (e.capitalFlightPerSecond) {
          parts.push(t('effectCapitalFlight', {
            value: formatMoney(e.capitalFlightPerSecond, this.currency),
            growth: formatPercent(e.capitalFlightGrowthPerMinute ?? 0, 0),
          }));
        }
        const unlocks = this.game.content.upgrades
          .filter((upgrade) => upgrade.unlockAt?.upgrade === def.id)
          .map((upgrade) => upgrade.name);
        if (unlocks.length > 0) {
          parts.push(t('effectUnlocks', { names: unlocks.slice(0, 3).join(', ') }));
        }
        return parts.join(' · ') || t('effectNoDirectBonus');
      }
      case 'well': {
        // Показываем последнюю пробуренную скважину и расклад по классам.
        const wells = this.game.state.wells;
        const last = wells[wells.length - 1];
        if (last) {
          return this.texts.get('shop.effectWellLast', {
            value: formatNumber(last.dailyTonnes),
            kind: this.texts.get(`wells.${last.kind}`),
          });
        }
        return this.texts.get('shop.effectWellHint');
      }
      case 'multiplier':
        if (e.fuelDamper) return t('effectFuelDamper');
        return t('effectMultiplier', {
          value: formatPercent(Math.pow(e.factor ?? 1, Math.sqrt(Math.max(1, level))) - 1, 1),
        });
      case 'taxCut': {
        const parts = [t('effectTaxCut', { value: formatPercent((e.percent ?? 0) / 100, 1) })];
        // Банк усиливает операции: показываем, насколько выросли выплаты.
        if (e.bankScale) parts.push(t('effectBankScale', { value: formatPercent(e.bankScale, 0) }));
        return parts.join(' · ');
      }
      case 'costCut':
        return t('effectCostCut', { value: (e.percent ?? 0).toFixed(0) });
      case 'priceBoost': {
        const parts: string[] = [];
        if (e.domesticPriceMultiplier && e.domesticPriceMultiplier > 1) {
          parts.push(t('effectDomesticPrice', { value: formatPercent(e.domesticPriceMultiplier - 1, 1) }));
        }
        if (e.exportPriceMultiplier && e.exportPriceMultiplier > 1) {
          parts.push(t('effectExportPrice', { value: formatPercent(e.exportPriceMultiplier - 1, 1) }));
        }
        if (e.exchangeRateDevaluation && e.exchangeRateDevaluation > 0) {
          parts.push(t('effectDevaluation', { value: formatPercent(e.exchangeRateDevaluation, 1) }));
        }
        return parts.join(' · ') || t('effectPriceBoost', {
          value: `+${formatPercent(Math.pow(e.factor ?? 1, Math.max(1, level)) - 1, 1)}`,
        });
      }
      case 'oneShot':
        // Точная выплата зависит от текущего темпа империи и мировой цены,
        // поэтому в карточке показываем понятное описание, а не фиктивное число.
        return this.texts.get('shop.effectOneShotHint');
      case 'gamble':
        return t('effectGamble', { seconds: e.seconds ?? 0, value: e.factor ?? 2 });
      case 'periodic':
        return t('effectPeriodic', { seconds: e.seconds ?? 0, value: (e.value ?? 0) * Math.max(1, level) });
      case 'sell': {
        const channel = e.channel ?? 'contract';
        const parts = [
          t('effectSell', { value: formatNumber((e.value ?? 0) * Math.max(1, level)) }),
        ];
        if (e.percent) {
          const key = e.channel === 'refine' ? 'effectSellThroughput' : 'effectSellVolume';
          parts.push(t(key, { value: formatPercent(e.percent / 100, 1) }));
        }
        // В карточке видно, какой именно рынок она расширяет: сырьё,
        // нефтепродукты или оба. Раньше это было скрыто в конфиге.
        const channelName = this.texts.get(`sales.${channel}`);
        const split = e.channelSplit;
        const scope = !split
          ? this.texts.get('shop.scopeBoth')
          : (split.crude ?? 0) > 0 && (split.products ?? 0) > 0
            ? this.texts.get('shop.scopeBoth')
            : (split.products ?? 0) > 0
              ? this.texts.get('shop.scopeProducts')
              : this.texts.get('shop.scopeCrude');
        return `${channelName} · ${scope}: ${parts.join(' · ')}`;
      }
      case 'storage':
        return t('effectStorage', { value: formatNumber((e.value ?? 0) * Math.max(1, level)) });
      case 'luxury':
        return t('effectLuxury', {});
      case 'win':
        return this.texts.get('finale.pumpName');
      default:
        return '';
    }
  }

  /**
   * Что нужно, чтобы карточка открылась. Пишется красным прямо в карточке:
   * заблокированные покупки видит вся вкладка, а не только «следующие две».
   */
  private describeLock(def: UpgradeDef, check: BuyCheck): string {
    if (check.unlocked) {
      // У финальной цели обязательные условия лежат в config.winRequirements,
      // а не в unlockAt самой карточки. Показываем первое невыполненное —
      // из того же расчёта, по которому движок разрешает финал.
      if (def.win) {
        const blocker = winRequirementBlocker(
          this.game.config, this.game.state, this.game.derived().influence,
        );
        if (blocker) return this.describeTerm(blocker);
      }
      // Открытая карточка с выключенной кнопкой тоже объясняет причину:
      // на недоступной кнопке клик не срабатывает, поэтому пишем на карточке.
      if (check.reason === 'noOil') return this.texts.get('shop.buyFailOil');
      if (check.reason === 'noCapacity') return this.texts.get('shop.buyFailCapacity');
      return '';
    }
    return check.blocker ? this.describeTerm(check.blocker) : this.texts.get('shop.locked');
  }

  /**
   * Описание карточки. У финальной цели условия дописываются из
   * config.winRequirements — тем же расчётом, по которому движок разрешает
   * финал: в тексте покупки чисел нет, поэтому разойтись им не с чем.
   */
  private descriptionOf(def: UpgradeDef): string {
    if (!def.win) return def.description;
    const terms = winRequirementTerms(this.game.config);
    if (terms.length === 0) return def.description;
    return [def.description, ...terms.map((term) => `${this.describeTerm(term)}.`)].join(' ');
  }

  /** Невыполненное условие словами: порог уже итоговый, после кривой цен. */
  private describeTerm(term: RequirementTerm): string {
    return describeRequirementTerm(term, this.game.content, this.texts, this.currency);
  }

  /** Частое обновление: только значения, без пересборки DOM. */
  update(): void {
    const defs = this.defsFor(this.active);
    const signature = this.signature(defs);
    if (signature !== this.visibleSignature) {
      this.buildList();
      return;
    }
    for (const def of defs) {
      const refs = this.cards.get(def.id);
      if (refs) this.refreshCard(def, refs);
    }
  }

  /** Для тестов: сколько карточек сейчас в списке. */
  get cardCount(): number {
    return this.cards.size;
  }
}
