/**
 * Панель империи — правый столбец: товарная статистика (цены, сырая нефть,
 * нефтепродукты), денежная (доходы слева, расходы справа, под ними прибыль)
 * и собственность.
 *
 * Деньги и влияние живут в шапке — там же, где нефтефаники: правый столбец
 * отдан цифрам, которые меняются каждую секунду.
 */
import { el } from './dom';
import type { Texts } from './texts';
import { formatMoney, formatNumber, formatPercent } from '../core/format';
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
  /** Денежные доходы (выручка) и расходы: две колонки, под ними прибыль. */
  private readonly incomeRows: HTMLElement;
  private readonly expenseRows: HTMLElement;
  private readonly profitValue: HTMLElement;
  private readonly balanceNode: HTMLElement;
  private readonly influenceValue: HTMLElement;
  private readonly influenceFill: HTMLElement;
  private lastCoins = '';

  constructor(
    private readonly texts: Texts,
    private readonly currency: string,
    private readonly config: GameConfig,
  ) {
    // Кошелёк и влияние живут в шапке, но обновляются тем же hud.update().
    this.balanceNode = el('strong', { class: 'topbar__coins', 'data-testid': 'balance' }, '');
    this.influenceValue = el('strong', { class: 'topbar__influence-value' }, '');
    this.influenceFill = el('i', { class: 'topbar__influence-fill' });

    this.tax = el('span', { class: 'hud__chip' }, '');
    this.oilFill = el('i', { class: 'hud__oil-fill' });
    this.oilBar = el('div', { class: 'hud__oilbar' }, [this.oilFill]);

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

    this.incomeRows = el('div', { class: 'hud__col hud__col--income' });
    this.expenseRows = el('div', { class: 'hud__col hud__col--expense' });
    this.profitValue = el('span', { class: 'hud__profit-value' }, '');

    const group = (key: string, title: string, body: HTMLElement[], extra = ''): HTMLElement =>
      el('div', { class: `hud__group ${extra}`.trim(), 'data-group': key }, [
        el('span', { class: 'hud__group-title' }, title),
        ...body,
      ]);

    this.root = el('section', { class: 'hud', 'data-testid': 'hud' }, [
      // --- товарная статистика: цены, сырая нефть, нефтепродукты ---
      group('goods', texts.get('hud.groupGoods'), [
        // Мировая и внутренняя цена — в одной строке, как просил заказчик.
        el('div', { class: 'hud__prices' }, [
          el('div', { class: 'hud__price' }, [
            el('span', { class: 'hud__price-label' }, texts.get('hud.worldPrice')),
            row('worldPrice', '', 'hud__row-value--price').value,
          ]),
          el('div', { class: 'hud__price' }, [
            el('span', { class: 'hud__price-label' }, texts.get('hud.domesticPrice')),
            row('domesticPrice', '', 'hud__row-value--price').value,
          ]),
        ]),

        el('div', { class: 'hud__oil' }, [
          el('div', { class: 'hud__oil-head' }, [
            el('span', { class: 'hud__label' }, texts.get('hud.oil')),
            row('oil', '').value,
          ]),
          this.oilBar,
        ]),

        // Сырая нефть: добыча и куда она уходит.
        el('div', { class: 'hud__section' }, [
          el('span', { class: 'hud__section-title' }, texts.get('hud.crudeOil')),
          el('div', { class: 'hud__rows hud__rows--single' }, [
            row('produced', texts.get('hud.production'), 'hud__row-value--oil').root,
            row('crudeDomestic', texts.get('hud.saleDomestic'), 'hud__row-value--sell').root,
            row('crudeExport', texts.get('hud.saleExport'), 'hud__row-value--sell').root,
            row('crudeRefine', texts.get('hud.toRefine'), 'hud__row-value--sell').root,
          ]),
        ]),

        // Нефтепродукты: сколько дают НПЗ и куда уходят.
        el('div', { class: 'hud__section' }, [
          el('span', { class: 'hud__section-title' }, texts.get('hud.products')),
          el('div', { class: 'hud__rows hud__rows--single' }, [
            row('productsOut', texts.get('hud.production'), 'hud__row-value--oil').root,
            row('productsDomestic', texts.get('hud.saleDomestic'), 'hud__row-value--sell').root,
            row('productsExport', texts.get('hud.saleExport'), 'hud__row-value--sell').root,
          ]),
        ]),

        el('div', { class: 'hud__rows' }, [
          row('perTap', texts.get('hud.perTap'), 'hud__row-value--oil').root,
          row('autoDrill', texts.get('hud.autoDrill'), 'hud__row-value--crew').root,
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

  /** Значение влияния и шкала: заказчик просил вынести их в шапку. */
  get influence(): { value: HTMLElement; fill: HTMLElement } {
    return { value: this.influenceValue, fill: this.influenceFill };
  }

  update(state: GameState, derived: DerivedStats): void {
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
    const tonnes_ = this.texts.get('units.tonnes');
    const perSecond = this.texts.get('units.perSecond');
    const tonnes = tonnes_;

    set('oil', units('oilInTank', {
      oil: formatNumber(state.oil),
      capacity: formatNumber(derived.oilCapacity),
      tonnes,
    }));
    set('wellsCount', String(state.wells.length));
    // --- сырая нефть и нефтепродукты: всё в тоннах в секунду ---
    const flows = derived.flows;
    const rate = (value: number) => units('tonnesRate', {
      value: formatNumber(value),
      tonnes,
      s: perSecond.replace('/', ''),
    });
    /**
     * Строка сбыта в понятном виде: «сколько × по какой цене = сколько денег».
     * Заказчик просил именно так: «экспорт 500 т/с × ₦4,44/т = ₦2220/с».
     */
    const sale = (tonnes: number, pricePerTon: number): string =>
      this.texts.get('units.saleLine', {
        tonnes: formatNumber(tonnes),
        unit: tonnes_,
        price: formatMoney(pricePerTon, this.currency),
        money: formatMoney(tonnes * pricePerTon, this.currency),
        s: perSecond.replace('/', ''),
      });

    set('produced', rate(flows.produced));
    set('crudeDomestic', sale(flows.domestic, derived.channels.contract.price));
    set('crudeExport', sale(flows.export, derived.channels.export.price));
    // Переработка не продаёт сырьё, а превращает его в продукты.
    set('crudeRefine', rate(flows.refined));
    set('productsOut', rate(flows.productsProduced));
    set('productsDomestic', sale(flows.productsDomestic, derived.productPriceDomestic));
    set('productsExport', sale(flows.productsExport, derived.productPriceExport));
    set('gross', units('moneyRate', {
      value: formatMoney(derived.grossPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    // Налог — ставкой в процентах (просил заказчик), а рядом расшифровка
    // деньгами в чипе под панелью: «Налог: 28 % · −₦23/с».
    set('taxPaid', formatPercent(derived.taxRate));
    // Внутренняя цена сырья — рядом с мировой (см. блок цен выше).
    set('domesticPrice', units('pricePerTon', {
      price: formatMoney(derived.domesticPricePerTon, this.currency),
      tonnes,
    }));
    const profitText = units('moneyRate', {
      value: formatMoney(derived.profitPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    });
    if (this.profitValue.textContent !== profitText) this.profitValue.textContent = profitText;
    this.profitValue.dataset.negative = derived.profitPerSecond <= 0 ? '1' : '0';
    // Влияние — в шапке: значение и шкала до потолка из конфига.
    const influenceText = String(derived.influence);
    if (this.influenceValue.textContent !== influenceText) {
      this.influenceValue.textContent = influenceText;
    }
    const share = Math.min(1, derived.influence / Math.max(1, this.config.influence.cap));
    this.influenceFill.style.width = `${(share * 100).toFixed(1)}%`;
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
    this.tax.textContent = this.texts.get('hud.taxSummary', {
      rate: formatPercent(derived.taxRate),
      money: formatMoney(derived.taxPaidPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    });
    set('capacity', units('tonnesValue', {
      value: formatNumber(derived.oilCapacity),
      tonnes,
    }));

    const fill = Math.max(0, Math.min(1, derived.oilCapacity > 0 ? state.oil / derived.oilCapacity : 0));
    this.oilFill.style.width = `${(fill * 100).toFixed(1)}%`;
    this.oilFill.dataset.level = fill > 0.97 ? 'full' : fill > 0.75 ? 'high' : 'ok';

    // Мировая цена в нефтефаниках за тонну — рядом с внутренней.
    set('worldPrice', units('pricePerTon', {
      price: formatMoney(derived.oilPricePerTon, this.currency),
      tonnes,
    }));
  }
}
