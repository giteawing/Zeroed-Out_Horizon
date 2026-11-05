/**
 * Панель империи — правый столбец: товарная статистика, денежная
 * (доходы слева, расходы справа, под ними прибыль), собственность,
 * влияние и прогресс до «Упыря-Абсолюта».
 *
 * Деньги (кошелёк) живут в шапке рядом с иконками меню — так в правом
 * столбце остаётся место на цифры.
 */
import { el } from './dom';
import type { Texts } from './texts';
import { formatMoney, formatNumber, formatPercent } from '../core/format';
import { wellsDailyTonnes } from '../core/economy';
import type { DerivedStats, GameConfig, GameState } from '../core/types';

interface Row {
  root: HTMLElement;
  value: HTMLElement;
  last: string;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private readonly tax: HTMLElement;
  private readonly oilBar: HTMLElement;
  private readonly oilFill: HTMLElement;
  private readonly channels: Record<'contract' | 'export' | 'refine', HTMLElement> = {
    contract: el('span', { class: 'sale__value' }, ''),
    export: el('span', { class: 'sale__value' }, ''),
    refine: el('span', { class: 'sale__value' }, ''),
  };
  private readonly influenceFill: HTMLElement;
  private readonly influenceValue: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressValue: HTMLElement;
  /** Денежные доходы (выручка) и расходы: две колонки, под ними прибыль. */
  private readonly incomeRows: HTMLElement;
  private readonly expenseRows: HTMLElement;
  private readonly profitValue: HTMLElement;
  private readonly balanceNode: HTMLElement;
  private lastCoins = '';

  constructor(
    private readonly texts: Texts,
    private readonly currency: string,
    private readonly config: GameConfig,
  ) {
    // Кошелёк живёт в шапке, но обновляется тем же hud.update() — см. баланс().
    this.balanceNode = el('strong', { class: 'topbar__coins', 'data-testid': 'balance' }, '');

    this.tax = el('span', { class: 'hud__chip' }, '');
    this.oilFill = el('i', { class: 'hud__oil-fill' });
    this.oilBar = el('div', { class: 'hud__oilbar' }, [this.oilFill]);
    this.influenceFill = el('i', { class: 'hud__influence-fill' });
    this.influenceValue = el('span', { class: 'hud__influence-value' }, '');
    this.progressFill = el('i', { class: 'hud__progress-fill' });
    this.progressValue = el('span', { class: 'hud__progress-value' }, '');

    const row = (key: string, label: string, cls = ''): Row => {
      const value = el('span', { class: `hud__row-value ${cls}` }, '');
      const root = el('div', { class: 'hud__row' }, [
        el('span', { class: 'hud__row-label' }, label),
        value,
      ]);
      const entry: Row = { root, value, last: '' };
      this.rows.set(key, entry);
      return entry;
    };

    const salesRow = (
      key: 'contract' | 'export' | 'refine',
      label: string,
    ): HTMLElement =>
      el('div', { class: 'sale', 'data-channel': key }, [
        el('span', { class: 'sale__label' }, label),
        this.channels[key],
      ]);

    this.incomeRows = el('div', { class: 'hud__col hud__col--income' });
    this.expenseRows = el('div', { class: 'hud__col hud__col--expense' });
    this.profitValue = el('span', { class: 'hud__profit-value' }, '');

    const group = (key: string, title: string, body: HTMLElement[], extra = ''): HTMLElement =>
      el('div', { class: `hud__group ${extra}`.trim(), 'data-group': key }, [
        el('span', { class: 'hud__group-title' }, title),
        ...body,
      ]);

    this.root = el('section', { class: 'hud', 'data-testid': 'hud' }, [
      // --- товарная статистика: нефть, дебит, сбыт, цены ---
      group('goods', texts.get('hud.groupGoods'), [
        el('div', { class: 'hud__oil' }, [
          el('div', { class: 'hud__oil-head' }, [
            el('span', { class: 'hud__label' }, texts.get('hud.oil')),
            row('oil', '').value,
          ]),
          this.oilBar,
        ]),
        el('div', { class: 'hud__rows' }, [
          row('dailyRate', texts.get('hud.dailyRate'), 'hud__row-value--oil').root,
          // Бригада молча удваивает пассив: без строки игрок не понимает, откуда рост.
          row('autoDrill', texts.get('hud.autoDrill'), 'hud__row-value--crew').root,
          row('perTap', texts.get('hud.perTap'), 'hud__row-value--oil').root,
          // Мировая цена — строкой (без полосы в шапке), рядом цены продажи.
          row('worldPrice', texts.get('hud.worldPrice'), 'hud__row-value--price').root,
          row('pricePerTon', texts.get('hud.pricePerTon'), 'hud__row-value--price').root,
        ]),
        el('div', { class: 'hud__sales' }, [
          salesRow('refine', texts.get('sales.refine')),
          salesRow('export', texts.get('sales.export')),
          salesRow('contract', texts.get('sales.contract')),
        ]),
      ]),

      // --- денежная статистика: доходы слева, расходы справа, прибыль снизу ---
      group('money', texts.get('hud.groupMoney'), [
        el('div', { class: 'hud__invoice' }, [
          this.incomeRows,
          this.expenseRows,
        ]),
        el('div', { class: 'hud__profit' }, [
          el('span', { class: 'hud__profit-label' }, texts.get('hud.profit')),
          this.profitValue,
        ]),
      ]),

      // --- собственность: стоимость активов, объекты, резервуары, скважины ---
      group('property', texts.get('hud.groupProperty'), [
        el('div', { class: 'hud__rows' }, [
          row('assets', texts.get('hud.assets'), 'hud__row-value--assets').root,
          row('assetsRefinery', texts.get('hud.refineries')).root,
          row('assetsDepot', texts.get('hud.depots')).root,
          row('assetsAzs', texts.get('hud.azsCount')).root,
          row('assetsExportPipe', texts.get('hud.exportPipes')).root,
          row('assetsRefineryPipe', texts.get('hud.refineryPipes')).root,
          row('capacity', texts.get('hud.capacity')).root,
          row('wellsCount', texts.get('hud.wellsCount')).root,
        ]),
      ]),

      group('influence', '', [
        el('div', { class: 'hud__influence' }, [
          el('div', { class: 'hud__row' }, [
            el('span', { class: 'hud__row-label' }, texts.get('hud.influence')),
            this.influenceValue,
          ]),
          el('div', { class: 'hud__influence-track' }, [this.influenceFill]),
        ]),
      ]),

      group('progress', '', [
        el('div', { class: 'hud__progress' }, [
          el('div', { class: 'hud__progress-head' }, [
            el('span', { class: 'hud__progress-label' }, texts.get('hud.progress')),
            this.progressValue,
          ]),
          el('div', {
            class: 'hud__progress-track',
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          }, [this.progressFill]),
        ]),
      ]),

      el('div', { class: 'hud__chips' }, [this.tax]),
    ]);

    // Доходы и расходы — это разные колонки одной таблицы.
    // Доходы — слева, расходы — справа; прибыль под ними = разница.
    this.incomeRows.append(
      el('span', { class: 'hud__col-title' }, texts.get('hud.income')),
      row('gross', texts.get('hud.gross'), 'hud__row-value--plus').root,
    );
    this.expenseRows.append(
      el('span', { class: 'hud__col-title' }, texts.get('hud.expensesTitle')),
      row('taxPaid', texts.get('hud.taxRate'), 'hud__row-value--minus').root,
      row('salaries', texts.get('hud.salaries'), 'hud__row-value--minus').root,
      row('officials', texts.get('hud.officials'), 'hud__row-value--minus').root,
    );
  }

  /** Узел с суммой нефтефаников — стоит в шапке рядом с иконками меню. */
  get balance(): HTMLElement {
    return this.balanceNode;
  }

  update(state: GameState, derived: DerivedStats, winCost: number): void {
    const money = formatMoney(state.coins, this.currency);
    if (money !== this.lastCoins) {
      this.balanceNode.textContent = money;
      this.lastCoins = money;
    }

    const set = (key: string, value: string) => {
      const row = this.rows.get(key);
      if (!row || row.last === value) return;
      row.last = value;
      row.value.textContent = value;
    };

    const units = (key: string, params: Record<string, string | number>) =>
      this.texts.get(`units.${key}`, params);
    const tonnes = this.texts.get('units.tonnes');
    const perSecond = this.texts.get('units.perSecond');

    set('oil', units('oilInTank', {
      oil: formatNumber(state.oil),
      capacity: formatNumber(derived.oilCapacity),
      tonnes,
    }));
    const daily = wellsDailyTonnes(state, this.config);
    set('dailyRate', units('tonnesPerDay', { value: formatNumber(daily), tonnes }));
    set('wellsCount', String(state.wells.length));
    set('gross', units('moneyRate', {
      value: formatMoney(derived.grossPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    // Налог показываем деньгами, а не процентом: прибыль = доходы − расходы.
    set('taxPaid', units('minusRate', {
      value: formatMoney(derived.taxPaidPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    // Разные цены: внутренняя (контракты) и экспортная — обычно выше.
    set('pricePerTon', units('pricesPerTon', {
      domestic: formatMoney(derived.domesticPricePerTon, this.currency),
      export: formatMoney(derived.exportPricePerTon, this.currency),
      tonnes,
    }));
    const profitText = units('moneyRate', {
      value: formatMoney(derived.profitPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    });
    if (this.profitValue.textContent !== profitText) this.profitValue.textContent = profitText;
    this.profitValue.dataset.negative = derived.profitPerSecond <= 0 ? '1' : '0';
    set('assets', formatMoney(derived.assetsValue, this.currency));
    set('assetsRefinery', String(derived.assetCounts.refinery));
    set('assetsDepot', String(derived.assetCounts.depot));
    set('assetsAzs', String(derived.assetCounts.azs));
    set('assetsExportPipe', String(derived.assetCounts.exportPipe));
    set('assetsRefineryPipe', String(derived.assetCounts.refineryPipe));
    set('perTap', units('tonnesValue', { value: formatNumber(derived.tapValue), tonnes }));
    set('autoDrill', derived.autoDrill
      ? this.texts.get('hud.autoDrillOn')
      : this.texts.get('hud.autoDrillOff'));
    set('salaries', units('minusRate', {
      value: formatMoney(derived.salaries, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('officials', units('minusRate', {
      value: formatMoney(derived.officials, this.currency),
      s: perSecond.replace('/', ''),
    }));
    this.tax.textContent = `${this.texts.get('hud.taxRate')}: ${formatPercent(derived.taxRate)}`;
    set('capacity', units('tonnesValue', {
      value: formatNumber(derived.oilCapacity),
      tonnes,
    }));

    const fill = Math.max(0, Math.min(1, derived.oilCapacity > 0 ? state.oil / derived.oilCapacity : 0));
    this.oilFill.style.width = `${(fill * 100).toFixed(1)}%`;
    this.oilFill.dataset.level = fill > 0.97 ? 'full' : fill > 0.75 ? 'high' : 'ok';

    /*
     * Каналы показываем тем, что через них РЕАЛЬНО продаётся.
     *
     * Раньше выводилась пропускная способность: у безлимитных контрактов она
     * огромная и ни о чём не говорит, а игрок читал «Контракты 5000 т/с»,
     * хотя продавалось 9 т/с.
     */
    for (const key of ['contract', 'export', 'refine'] as const) {
      const channel = derived.channels[key];
      const node = this.channels[key];
      const text = channel.rate > 0
        ? units('tonnesRate', {
            value: formatNumber(derived.salesByChannel[key]),
            tonnes,
            s: perSecond.replace('/', ''),
          })
        : this.texts.get('sales.locked');
      if (node.textContent !== text) node.textContent = text;
      node.dataset.active = channel.rate > 0 ? '1' : '0';
    }

    // Мировая цена в нефтефаниках за тонну: полосы больше нет, только строка.
    set('worldPrice', units('pricePerTon', {
      price: formatMoney(derived.oilPricePerTon, this.currency),
      tonnes,
    }));
    const influenceShare = Math.min(1, derived.influence / 400);
    this.influenceFill.style.width = `${(influenceShare * 100).toFixed(1)}%`;
    const influenceText = String(derived.influence);
    if (this.influenceValue.textContent !== influenceText) {
      this.influenceValue.textContent = influenceText;
    }

    const progress = Math.min(1, winCost > 0 ? state.coins / winCost : 0);
    this.progressFill.style.width = `${(progress * 100).toFixed(2)}%`;
    this.progressValue.textContent = formatPercent(progress, 1);
    this.progressFill.parentElement?.setAttribute(
      'aria-valuenow',
      String(Math.round(progress * 100)),
    );
  }
}
