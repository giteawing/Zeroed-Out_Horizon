/**
 * Панель империи — правый столбец: товарная статистика (цены, сырая нефть,
 * нефтепродукты), денежная и собственность.
 *
 * Денежная часть идёт строго в порядке применения: доход → расходы → EBT →
 * налог на прибыль → чистая прибыль. Так видно, из чего складывается каждая
 * следующая строка, и не приходится считать в голове.
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
  private readonly oilBar: HTMLElement;
  private readonly oilFill: HTMLElement;
  /**
   * Денежная таблица: одна колонка сверху вниз по порядку применения —
   * доход, расходы, EBT, налог на прибыль, чистая прибыль.
   */
  private readonly invoice: HTMLElement;
  private readonly ebtNode: HTMLElement;
  /** Пометки под ценами: у каждой цены своя надбавка, поэтому и подпись своя. */
  private readonly priceNotes = new Map<string, HTMLElement>();
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

    this.oilFill = el('i', { class: 'hud__oil-fill' });
    this.oilBar = el('div', { class: 'hud__oilbar' }, [this.oilFill]);

    const row = (key: string, label: string, cls = '', rowCls = ''): Row => {
      const value = el('span', { class: `hud__row-value ${cls}` }, '');
      const root = el('div', { class: `hud__row ${rowCls}`.trim() }, [
        el('span', { class: 'hud__row-label' }, label),
        value,
      ]);
      const entry: Row = { root, value, last: '' };
      this.rows.set(key, entry);
      return entry;
    };

    this.invoice = el('div', { class: 'hud__invoice' });
    this.ebtNode = el('span', { class: 'hud__row-value hud__row-value--ebt' }, '');
    this.profitValue = el('span', { class: 'hud__profit-value' }, '');

    const group = (key: string, title: string, body: HTMLElement[], extra = ''): HTMLElement =>
      el('div', { class: `hud__group ${extra}`.trim(), 'data-group': key }, [
        el('span', { class: 'hud__group-title' }, title),
        ...body,
      ]);

    this.root = el('section', { class: 'hud', 'data-testid': 'hud' }, [
      // --- товарная статистика: цены, сырая нефть, нефтепродукты ---
      group('goods', texts.get('hud.groupGoods'), [
        // Цены. Заказчик ловил расхождение: в строках сбыта стояло одно
        // число, а здесь другое. Причина — надбавки от сбытовых построек
        // (тресты, брокеры, биржа) входили в цену продажи, но не в подпись.
        // Теперь у каждой цены есть пометка, что в неё входит, а цена в
        // строках сбыта — ровно та же, что и здесь.
        el('div', { class: 'hud__prices' }, [
          el('div', { class: 'hud__price' }, [
            el('span', { class: 'hud__price-label' }, texts.get('hud.worldPrice')),
            row('worldPrice', '', 'hud__row-value--price').value,
            this.note('world'),
          ]),
          el('div', { class: 'hud__price' }, [
            el('span', { class: 'hud__price-label' }, texts.get('hud.domesticPrice')),
            row('domesticPrice', '', 'hud__row-value--price').value,
            this.note('contract'),
          ]),
          el('div', { class: 'hud__price' }, [
            el('span', { class: 'hud__price-label' }, texts.get('hud.exportPrice')),
            row('exportPrice', '', 'hud__row-value--price').value,
            this.note('export'),
          ]),
          el('div', { class: 'hud__price' }, [
            el('span', { class: 'hud__price-label' }, texts.get('hud.productPriceDomestic')),
            row('productPriceDomestic', '', 'hud__row-value--price').value,
            this.note('productDomestic'),
          ]),
          el('div', { class: 'hud__price' }, [
            el('span', { class: 'hud__price-label' }, texts.get('hud.productPriceExport')),
            row('productPriceExport', '', 'hud__row-value--price').value,
            this.note('productExport'),
          ]),
        ]),

        el('div', { class: 'hud__oil' }, [
          el('div', { class: 'hud__oil-head' }, [
            el('span', { class: 'hud__label' }, texts.get('hud.oil')),
            row('oil', '').value,
          ]),
          this.oilBar,
        ]),

        // Сырая нефть: добыча и куда она уходит. Экспорт показан по видам
        // транспорта — заказчик просил видеть, сколько уходит поездами,
        // сколько танкерами, а сколько по трубопроводу.
        el('div', { class: 'hud__section', 'data-section': 'crude' }, [
          el('span', { class: 'hud__section-title' }, texts.get('hud.crudeOil')),
          el('div', { class: 'hud__rows hud__rows--single' }, [
            row('produced', texts.get('hud.production'), 'hud__row-value--oil').root,
            row('crudeDomestic', texts.get('hud.saleDomestic'), 'hud__row-value--sell').root,
            row('crudeExport', texts.get('hud.saleExport'), 'hud__row-value--sell').root,
            // Три способа доставки — подпункты экспорта: отступ слева и
            // вертикальная связка показывают, что они входят в строку выше.
            row('exportPipeline', texts.get('hud.exportPipeline'),
              'hud__row-value--sell hud__row-value--under', 'hud__row--under').root,
            row('exportRail', texts.get('hud.exportRail'),
              'hud__row-value--sell hud__row-value--under', 'hud__row--under').root,
            row('exportTanker', texts.get('hud.exportTanker'),
              'hud__row-value--sell hud__row-value--under', 'hud__row--under').root,
            row('crudeRefine', texts.get('hud.toRefine'), 'hud__row-value--sell').root,
            // Сколько добычи легло в резервуары и ждёт отправки.
            row('crudeStored', texts.get('hud.stored'), 'hud__row-value--stored').root,
            // «Доступный объём» рынков: сколько они ещё могут принять.
            // Занято / всего — сразу видно, где узкое место.
            row('crudeMarketDomestic', texts.get('hud.marketDomestic'),
              'hud__row-value--market').root,
            row('crudeMarketExport', texts.get('hud.marketExport'),
              'hud__row-value--market').root,
          ]),
        ]),

        // Нефтепродукты: сколько дают НПЗ и куда уходят.
        el('div', { class: 'hud__section', 'data-section': 'products' }, [
          el('span', { class: 'hud__section-title' }, texts.get('hud.products')),
          el('div', { class: 'hud__rows hud__rows--single' }, [
            row('productsOut', texts.get('hud.production'), 'hud__row-value--oil').root,
            row('productsDomestic', texts.get('hud.saleDomestic'), 'hud__row-value--sell').root,
            // Излишек сверх рынка и склада — подпункт внутренней продажи:
            // он уходит по внутренней цене, но уже без мощности рынка.
            row('productsSpill', texts.get('hud.productsSpill'),
              'hud__row-value--sell hud__row-value--under', 'hud__row--under').root,
            row('productsExport', texts.get('hud.saleExport'), 'hud__row-value--sell').root,
            // Топливо, которому не хватило рынка: оно лежит на нефтебазах.
            // Без этой строки производство не сходилось с продажей, и
            // казалось, что продукты исчезают.
            row('productsLeft', texts.get('hud.productsUnsold'),
              'hud__row-value--stored hud__row-value--under').root,
            // Нефтебазы хранят нефтепродукты: показываем, сколько их лежит
            // и сколько всего влезает.
            row('productsOnHand', texts.get('hud.productStorage'), 'hud__row-value--stored').root,
            // Те же «доступные объёмы» рынков, но для нефтепродуктов.
            row('productsMarketDomestic', texts.get('hud.marketDomestic'),
              'hud__row-value--market').root,
            row('productsMarketExport', texts.get('hud.marketExport'),
              'hud__row-value--market').root,
          ]),
        ]),

        el('div', { class: 'hud__rows' }, [
          row('perTap', texts.get('hud.perTap'), 'hud__row-value--oil').root,
        ]),
        // Автодобыча — отдельной строкой на всю ширину колонки: короткий
        // вердикт «команда в сборе / не собрана» важнее соседства с тапом.
        el('div', { class: 'hud__rows hud__rows--single' }, [
          row('autoDrill', '', 'hud__row-value--crew hud__row-value--wide').root,
        ]),
      ]),

      // --- денежная статистика: строго в порядке применения ---
      // доход → расходы → EBT → налог на прибыль → чистая прибыль.
      group('money', texts.get('hud.groupMoney'), [this.invoice]),

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

    ]);

    // Таблица счёта: каждая строка — шаг расчёта, суммы справа по краю.
    // Расходы раскрыты двумя статьями, но в EBT идут одной суммой.
    this.invoice.append(
      row('gross', texts.get('hud.income'), 'hud__row-value--plus').root,
      // «Расходы» — итог по статьям, чтобы арифметика читалась построчно:
      // доход − расходы = EBT.
      row('expenses', texts.get('hud.expensesTitle'), 'hud__row-value--minus').root,
      row('salaries', texts.get('hud.salaries'), 'hud__row-value--minus', 'hud__row--sub').root,
      row('officials', texts.get('hud.officials'), 'hud__row-value--minus', 'hud__row--sub').root,
      el('div', { class: 'hud__row hud__row--total' }, [
        el('span', { class: 'hud__row-label' }, texts.get('hud.ebt')),
        this.ebtNode,
      ]),
      row('taxPaid', texts.get('hud.taxPaid'), 'hud__row-value--minus').root,
      el('div', { class: 'hud__profit' }, [
        el('span', { class: 'hud__profit-label' }, texts.get('hud.profit')),
        this.profitValue,
      ]),
    );
  }

  /** Мелкая пометка под ценой: что входит в число. */
  private note(kind: string): HTMLElement {
    const node = el('span', { class: 'hud__price-note' }, '');
    this.priceNotes.set(kind, node);
    return node;
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
    // Экспорт по видам транспорта: поезда, танкеры, трубопровод.
    const exportPrice = derived.channels.export.price;
    set('exportPipeline', sale(flows.exportByMode.pipeline, exportPrice));
    set('exportRail', sale(flows.exportByMode.rail, exportPrice));
    set('exportTanker', sale(flows.exportByMode.tanker, exportPrice));
    // Сколько нефти ушло в резервуары и ждёт отправки (не продано сразу).
    set('crudeStored', rate(flows.stored));
    /*
     * Доступный объём рынков: «сколько принято / сколько всего может принять».
     * Это ёмкость канала, а не факт продажи: если добыча меньше ёмкости,
     * справа будет запас, а не потолок. Считается для сырья и продуктов
     * отдельно, потому что рынки у них разные.
     */
    const market = (used: number, total: number) => units('marketVolume', {
      used: formatNumber(used),
      total: formatNumber(total),
      tonnes,
      s: perSecond.replace('/', ''),
    });
    set('crudeMarketDomestic', market(flows.domestic, derived.capacities.domestic.crude));
    set('crudeMarketExport', market(flows.export, derived.capacities.export.crude));
    set('productsMarketDomestic', market(flows.productsDomestic, derived.capacities.domestic.products));
    set('productsMarketExport', market(flows.productsExport, derived.capacities.export.products));
    // Переработка не продаёт сырьё, а превращает его в продукты.
    set('crudeRefine', rate(flows.refined));
    set('productsOut', rate(flows.productsProduced));
    set('productsDomestic', sale(flows.productsDomestic, derived.productPriceDomestic));
    set('productsExport', sale(flows.productsExport, derived.productPriceExport));
    // Не продано: топливо осталось на нефтебазах и ждёт свободного рынка,
    // а излишек сверх ёмкости склада ушёл по внутренней цене — показываем
    // обе части, чтобы производство сходилось с продажей построчно.
    set('productsLeft', rate(flows.productsStored));
    set('productsSpill', sale(flows.productsSpill, derived.productPriceDomestic));
    // Запас нефтепродуктов на нефтебазах: «сколько / сколько влезает».
    set('productsOnHand', units('oilInTank', {
      oil: formatNumber(state.products),
      capacity: formatNumber(derived.productCapacity),
      tonnes,
    }));
    set('gross', units('moneyRate', {
      value: formatMoney(derived.grossPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    // EBT — прибыль до налога: доход минус расходы. Из неё считается налог,
    // поэтому в таблице она стоит отдельной строкой перед налогом.
    const ebtText = units('moneyRate', {
      value: formatMoney(derived.ebtPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    });
    if (this.ebtNode.textContent !== ebtText) this.ebtNode.textContent = ebtText;
    // «Налог на прибыль 2%» слева и сумма справа: ставка и деньги в одной
    // строке, как просил заказчик.
    set('taxPaid', units('minusRate', {
      value: formatMoney(derived.taxPaidPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    const taxLabel = this.texts.get('hud.taxPaid', { rate: formatPercent(derived.taxRate) });
    const taxRow = this.rows.get('taxPaid');
    const taxLabelNode = taxRow?.root.querySelector('.hud__row-label');
    if (taxLabelNode && taxLabelNode.textContent !== taxLabel) taxLabelNode.textContent = taxLabel;
    // Внутренняя цена сырья — рядом с мировой (см. блок цен выше).
    // Цены: мировая — базовая (без надбавок), остальные — фактические,
    // те же, по которым считаются строки сбыта.
    set('domesticPrice', units('pricePerTon', {
      price: formatMoney(derived.domesticPricePerTon, this.currency),
      tonnes,
    }));
    set('exportPrice', units('pricePerTon', {
      price: formatMoney(derived.exportPricePerTon, this.currency),
      tonnes,
    }));
    set('productPriceDomestic', units('pricePerTon', {
      price: formatMoney(derived.productPriceDomestic, this.currency),
      tonnes,
    }));
    set('productPriceExport', units('pricePerTon', {
      price: formatMoney(derived.productPriceExport, this.currency),
      tonnes,
    }));
    /*
     * Пометка под ценой — это отношение к СТАРТОВОЙ цене канала
     * (basePricePerTon · priceFactor). Так видно, сколько дают постройки и
     * политика: «×2,35 к базовой». Мировая цена — базовая по определению.
     */
    const base = this.config.oil.basePricePerTon;
    const markups: Record<string, number> = {
      world: 1,
      contract: derived.domesticPricePerTon / (base * this.config.oil.channels.contract.priceFactor),
      export: derived.exportPricePerTon / (base * this.config.oil.channels.export.priceFactor),
      productDomestic: derived.productPriceDomestic / (base * this.config.product.domesticPriceFactor),
      productExport: derived.productPriceExport / (base * this.config.product.exportPriceFactor),
    };
    for (const [kind, node] of this.priceNotes) {
      const ratio = markups[kind] ?? 1;
      const text = kind === 'world' || ratio <= 1.005
        ? this.texts.get('hud.priceNoteBase')
        : this.texts.get('hud.priceNoteMarkup', {
          markup: formatNumber(Math.round(ratio * 100) / 100),
        });
      if (node.textContent !== text) node.textContent = text;
    }
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
    // Автодобыча — одной фразой на всю ширину: подпись и статус слиты.
    set('autoDrill', derived.autoDrill
      ? this.texts.get('hud.autoDrillOn')
      : this.texts.get('hud.autoDrillOff'));
    set('expenses', units('minusRate', {
      value: formatMoney(derived.expensesPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('salaries', units('minusRate', {
      value: formatMoney(derived.salaries, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('officials', units('minusRate', {
      value: formatMoney(derived.officials, this.currency),
      s: perSecond.replace('/', ''),
    }));
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
