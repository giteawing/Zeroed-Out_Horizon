/**
 * Верхняя панель: баланс, чистый доход, доход за тап, налог/расходы,
 * мировая цена нефти и прогресс до «Упыря-Абсолюта».
 */
import { el } from './dom';
import type { Texts } from './texts';
import { formatMoney, formatPercent, interpolate } from '../core/format';
import type { DerivedStats, GameState } from '../core/types';

export class Hud {
  readonly root: HTMLElement;
  private readonly balance: HTMLElement;
  private readonly perSecond: HTMLElement;
  private readonly perTap: HTMLElement;
  private readonly tax: HTMLElement;
  private readonly price: HTMLElement;
  private readonly priceBar: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly progressValue: HTMLElement;
  private lastCoins = '';

  constructor(
    private readonly texts: Texts,
    private readonly currency: string,
  ) {
    this.balance = el('strong', { class: 'hud__balance' }, '—');
    this.perSecond = el('span', { class: 'hud__value' }, '—');
    this.perTap = el('span', { class: 'hud__value' }, '—');
    this.tax = el('span', { class: 'hud__chip' }, '—');
    this.price = el('span', { class: 'hud__chip hud__chip--price' }, '—');
    this.priceBar = el('i', { class: 'hud__pricebar-fill' });
    this.progressFill = el('i', { class: 'hud__progress-fill' });
    this.progressLabel = el('span', { class: 'hud__progress-label' }, '—');
    this.progressValue = el('span', { class: 'hud__progress-value' }, '—');

    this.root = el('header', { class: 'hud' }, [
      el('div', { class: 'hud__top' }, [
        el('div', { class: 'hud__wallet' }, [
          el('span', { class: 'hud__label' }, texts.get('hud.balance')),
          this.balance,
        ]),
        el('div', { class: 'hud__stats' }, [
          el('div', { class: 'hud__stat' }, [
            el('span', { class: 'hud__label' }, texts.get('hud.perSecond')),
            this.perSecond,
          ]),
          el('div', { class: 'hud__stat' }, [
            el('span', { class: 'hud__label' }, texts.get('hud.perTap')),
            this.perTap,
          ]),
        ]),
      ]),
      el('div', { class: 'hud__chips' }, [
        this.tax,
        el('div', { class: 'hud__pricebar' }, [this.price, this.priceBar]),
      ]),
      el('div', { class: 'hud__progress' }, [
        el('div', { class: 'hud__progress-head' }, [this.progressLabel, this.progressValue]),
        el('div', {
          class: 'hud__progress-track',
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
        }, [this.progressFill]),
      ]),
    ]);
  }

  update(state: GameState, derived: DerivedStats, winCost: number): void {
    const money = formatMoney(state.coins, this.currency);
    if (money !== this.lastCoins) {
      this.balance.textContent = money;
      this.lastCoins = money;
    }
    this.perSecond.textContent = `+${formatMoney(derived.netPerSecond, this.currency)}`;
    this.perTap.textContent = formatMoney(derived.tapValue, this.currency);
    this.tax.textContent = `${this.texts.get('hud.taxRate')}: ${formatPercent(derived.taxRate)}`;
    const pricePercent = Math.round(
      ((state.worldPrice - 0.7) / 0.6) * 100,
    );
    this.price.textContent = `${this.texts.get('hud.worldPrice')}: ${formatPercent(state.worldPrice)}`;
    this.priceBar.style.width = `${Math.max(4, Math.min(100, pricePercent))}%`;
    this.priceBar.dataset.trend = state.worldPrice >= 1.15 ? 'high' : state.worldPrice <= 0.85 ? 'low' : 'mid';

    const progress = Math.min(1, winCost > 0 ? state.coins / winCost : 0);
    this.progressFill.style.width = `${(progress * 100).toFixed(2)}%`;
    this.progressLabel.textContent = this.texts.get('hud.progress');
    this.progressValue.textContent = interpolate('{percent}', {
      percent: formatPercent(progress, 1),
    });
    this.progressFill.parentElement?.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }
}
