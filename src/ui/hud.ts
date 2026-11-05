/**
 * Верхняя панель империи: деньги, нефть, добыча, сбыт, доход/расходы,
 * влияние и прогресс до «Упыря-Абсолюта».
 *
 * Это «правый столбец» на десктопе: он никогда не перекрывается магазином
 * и не уезжает при прокрутке — на телефоне стоит первым в колонке.
 */
import { el } from './dom';
import type { Texts } from './texts';
import { formatMoney, formatNumber, formatPercent, interpolate } from '../core/format';
import { wellsDailyTonnes } from '../core/economy';
import type { DerivedStats, GameConfig, GameState } from '../core/types';

interface Row {
  root: HTMLElement;
  value: HTMLElement;
  last: string;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly balance: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private readonly tax: HTMLElement;
  private readonly price: HTMLElement;
  private readonly priceBar: HTMLElement;
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
  private lastCoins = '';

  constructor(
    private readonly texts: Texts,
    private readonly currency: string,
    private readonly config: GameConfig,
  ) {
    this.balance = el('strong', { class: 'hud__balance' }, '');
    this.tax = el('span', { class: 'hud__chip' }, '');
    this.price = el('span', { class: 'hud__chip hud__chip--price' }, '');
    this.priceBar = el('i', { class: 'hud__pricebar-fill' });
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

    this.root = el('section', { class: 'hud', 'data-testid': 'hud' }, [
      el('div', { class: 'hud__wallet' }, [
        el('div', { class: 'hud__wallet-main' }, [
          el('span', { class: 'hud__label' }, texts.get('hud.balance')),
          this.balance,
        ]),
        el('div', { class: 'hud__pricebar' }, [this.price, this.priceBar]),
      ]),

      // Нефть в резервуарах — главный ресурс игры.
      el('div', { class: 'hud__oil' }, [
        el('div', { class: 'hud__oil-head' }, [
          el('span', { class: 'hud__label' }, texts.get('hud.oil')),
          row('oil', '').value,
        ]),
        this.oilBar,
      ]),

      el('div', { class: 'hud__rows' }, [
        // «Добыча» в тоннах в секунду убрана: игроку хватает суточного дебита.
        row('dailyRate', texts.get('hud.dailyRate'), 'hud__row-value--oil').root,
        row('wellsCount', texts.get('hud.wellsCount')).root,
        row('sellRate', texts.get('hud.sellRate'), 'hud__row-value--sell').root,
        row('domesticPrice', texts.get('hud.domesticPrice'), 'hud__row-value--price').root,
        row('exportPrice', texts.get('hud.exportPrice'), 'hud__row-value--price').root,
        row('gross', texts.get('hud.gross'), 'hud__row-value--plus').root,
        row('net', texts.get('hud.perSecond'), 'hud__row-value--plus').root,
        row('profit', texts.get('hud.profit'), 'hud__row-value--profit').root,
        row('assets', texts.get('hud.assets'), 'hud__row-value--assets').root,
        row('perTap', texts.get('hud.perTap'), 'hud__row-value--oil').root,
        row('salaries', texts.get('hud.salaries'), 'hud__row-value--minus').root,
        row('officials', texts.get('hud.officials'), 'hud__row-value--minus').root,
        row('expenses', texts.get('hud.expenses'), 'hud__row-value--minus').root,
        row('taxRate', texts.get('hud.taxRate'), 'hud__row-value--minus').root,
        row('capacity', texts.get('hud.capacity')).root,
      ]),

      // Сколько чего построено: НПЗ, нефтебазы, АЗС, трубопроводы.
      el('div', { class: 'hud__assets' }, [
        el('span', { class: 'hud__label' }, texts.get('hud.assetCounts')),
        row('assetsRefinery', texts.get('hud.refineries')).root,
        row('assetsDepot', texts.get('hud.depots')).root,
        row('assetsAzs', texts.get('hud.azsCount')).root,
        row('assetsExportPipe', texts.get('hud.exportPipes')).root,
        row('assetsRefineryPipe', texts.get('hud.refineryPipes')).root,
      ]),

      el('div', { class: 'hud__sales' }, [
        el('span', { class: 'hud__label' }, texts.get('sales.title')),
        salesRow('refine', texts.get('sales.refine')),
        salesRow('export', texts.get('sales.export')),
        salesRow('contract', texts.get('sales.contract')),
      ]),

      el('div', { class: 'hud__influence' }, [
        el('div', { class: 'hud__row' }, [
          el('span', { class: 'hud__row-label' }, texts.get('hud.influence')),
          this.influenceValue,
        ]),
        el('div', { class: 'hud__influence-track' }, [this.influenceFill]),
      ]),

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

      el('div', { class: 'hud__chips' }, [this.tax]),
    ]);
  }

  update(state: GameState, derived: DerivedStats, winCost: number): void {
    const money = formatMoney(state.coins, this.currency);
    if (money !== this.lastCoins) {
      this.balance.textContent = money;
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
    set('sellRate', units('tonnesRate', {
      value: formatNumber(derived.sellPerSecond),
      tonnes,
      s: perSecond.replace('/', ''),
    }));
    set('gross', units('moneyRate', {
      value: formatMoney(derived.grossPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('net', units('moneyRate', {
      value: formatMoney(derived.netPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    // Разные цены: внутренняя (контракты) и экспортная — обычно выше.
    set('domesticPrice', units('pricePerTon', {
      price: formatMoney(derived.domesticPricePerTon, this.currency),
      tonnes,
    }));
    set('exportPrice', units('pricePerTon', {
      price: formatMoney(derived.exportPricePerTon, this.currency),
      tonnes,
    }));
    set('profit', units('moneyRate', {
      value: formatMoney(derived.profitPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('assets', formatMoney(derived.assetsValue, this.currency));
    set('assetsRefinery', String(derived.assetCounts.refinery));
    set('assetsDepot', String(derived.assetCounts.depot));
    set('assetsAzs', String(derived.assetCounts.azs));
    set('assetsExportPipe', String(derived.assetCounts.exportPipe));
    set('assetsRefineryPipe', String(derived.assetCounts.refineryPipe));
    set('perTap', units('tonnesValue', { value: formatNumber(derived.tapValue), tonnes }));
    set('salaries', units('minusRate', {
      value: formatMoney(derived.salaries, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('officials', units('minusRate', {
      value: formatMoney(derived.officials, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('expenses', units('minusRate', {
      value: formatMoney(derived.expensesPerSecond, this.currency),
      s: perSecond.replace('/', ''),
    }));
    set('taxRate', formatPercent(derived.taxRate));
    set('capacity', units('tonnesValue', {
      value: formatNumber(derived.oilCapacity),
      tonnes,
    }));

    const fill = Math.max(0, Math.min(1, derived.oilCapacity > 0 ? state.oil / derived.oilCapacity : 0));
    this.oilFill.style.width = `${(fill * 100).toFixed(1)}%`;
    this.oilFill.dataset.level = fill > 0.97 ? 'full' : fill > 0.75 ? 'high' : 'ok';

    for (const key of ['contract', 'export', 'refine'] as const) {
      const channel = derived.channels[key];
      const node = this.channels[key];
      const text = channel.rate > 0
        ? interpolate(this.texts.get('sales.rate'), { value: formatNumber(channel.rate) })
        : this.texts.get('sales.locked');
      if (node.textContent !== text) node.textContent = text;
      node.dataset.active = channel.rate > 0 ? '1' : '0';
    }

    // Мировая цена показывается в нефтефантиках за тонну, а не в процентах:
    // полоса слева — это доля от диапазона цен, справа — живая цена тонны.
    const wpMin = this.config.worldPrice.min;
    const wpMax = this.config.worldPrice.max;
    const pricePercent = Math.round(
      ((state.worldPrice - wpMin) / Math.max(1e-6, wpMax - wpMin)) * 100,
    );
    const priceText = interpolate(this.texts.get('hud.worldPriceValue'), {
      price: formatMoney(derived.oilPricePerTon, this.currency),
      tonnes: this.texts.get('units.tonnes'),
    });
    if (this.price.textContent !== priceText) this.price.textContent = priceText;
    this.priceBar.style.width = `${Math.max(4, Math.min(100, pricePercent))}%`;
    this.priceBar.dataset.trend =
      state.worldPrice >= 1.15 ? 'high' : state.worldPrice <= 0.85 ? 'low' : 'mid';

    this.tax.textContent = `${this.texts.get('hud.taxRate')}: ${formatPercent(derived.taxRate)}`;

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
