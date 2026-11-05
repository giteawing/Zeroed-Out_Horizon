/**
 * «Правила игры»: подробное описание экономики, собранное из тех же данных,
 * по которым считает движок.
 *
 * Принцип: ни одно число здесь не написано руками. Цены, сроки, доли и
 * мощности берутся из `config.json` и `upgrades.json`, поэтому правила
 * физически не могут разойтись с игрой. Формулировки — из `texts.json`.
 */
import { el } from './dom';
import type { Texts } from './texts';
import { formatMoney, formatNumber, formatPercent } from '../core/format';
import type { Content } from '../core/types';

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
    const refine = oil.channels.refine;
    const base = oil.basePricePerTon;
    const daySeconds = oil.wells.secondsPerDay;
    const shipSeconds = oil.shipDays * daySeconds;
    const crew = oil.autoDrill.requires.map((id) => this.content.byId.get(id)?.name ?? id);

    return [
      this.section('rules.goalTitle', [
        t('rules.goalText', {
          cost: formatMoney(config.winCost, this.currency),
          pump: this.texts.get('finale.pumpName'),
        }),
      ]),

      this.section('rules.tapTitle', [
        t('rules.tapText', {
          tonnes: formatNumber(oil.tapTonnes),
          unit: tonnes,
        }),
        t('rules.autoDrillText', {
          crew: crew.join(', '),
          bonus: formatPercent(oil.autoDrill.bonus, 0),
        }),
      ]),

      this.section('rules.wellsTitle', [
        t('rules.wellsText', {
          day: daySeconds,
          min: formatPercent(oil.wells.decline.minFactor, 0),
          halfLife: oil.wells.decline.halfLifeSeconds,
        }),
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
        t('rules.channelDomestic', {
          rate: rate(contract.baseRate),
          price: price(base * contract.priceFactor),
        }),
        t('rules.channelExport', {
          rate: rate(exportChannel.baseRate),
          price: price(base * exportChannel.priceFactor),
        }),
        t('rules.channelRefine', {
          rate: rate(refine.baseRate),
          price: price(base * refine.priceFactor),
        }),
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
          drop: config.tax.influenceDrop,
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
      ]),

      this.section('rules.upgradesTitle', [
        t('rules.upgradesText', {
          count: upgrades.filter((u) => !u.win).length,
        }),
        t('rules.conquestText', {}),
        t('rules.bankText', {}),
      ]),

      this.section('rules.saveTitle', [
        t('rules.saveText', { cap: Math.round(config.offline.capSeconds / 60) }),
      ]),
    ];
  }
}
