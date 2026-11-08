import { assetValueBreakdownOf, assetsValueOf } from '../core/economy/assets';
import type { Game } from '../core/game';
import { formatMoney, formatNumber } from '../core/format';
import { el } from './dom';
import type { Texts } from './texts';

export class AssetDetails {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly total: HTMLElement;

  constructor(private readonly game: Game, private readonly texts: Texts, private readonly currency: string) {
    this.list = el('div', { class: 'assets__list' });
    this.total = el('strong', { class: 'assets__total-value' }, '');
    const close = el('button', { class: 'btn btn--gold', type: 'button' }, texts.get('panel.close'));
    close.addEventListener('click', () => this.close());
    this.root = el('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'sheet__inner assets__inner' }, [
        el('h2', { class: 'sheet__title' }, texts.get('panel.assets')),
        this.list,
        el('div', { class: 'assets__total' }, [
          el('span', {}, texts.get('panel.assetsTotal')),
          this.total,
        ]),
        close,
      ]),
    ]);
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  open(): void { this.render(); this.root.hidden = false; }
  close(): void { this.root.hidden = true; }
  get visible(): boolean { return !this.root.hidden; }

  render(): void {
    const exchangeRate = this.game.derived().exchangeRate;
    const lines = assetValueBreakdownOf(this.game.config, this.game.content.upgrades, this.game.state, exchangeRate);
    const nodes = lines.map((line) => {
      const name = line.kind === 'wells'
        ? this.texts.get('panel.assetsWells')
        : line.kind === 'luxury' ? this.texts.get('panel.assetsLuxury') : line.name ?? line.id;
      return el('div', { class: 'assets__row', 'data-asset-id': line.id }, [
        el('span', { class: 'assets__name' }, [
          el('strong', {}, name),
          el('small', {}, this.texts.get('panel.assetsCount', { count: formatNumber(line.count) })),
        ]),
        el('strong', { class: 'assets__value' }, formatMoney(line.value, this.currency)),
      ]);
    });
    this.list.replaceChildren(...nodes);
    if (nodes.length === 0) this.list.append(el('p', { class: 'assets__empty' }, this.texts.get('panel.assetsEmpty')));
    this.total.textContent = formatMoney(
      assetsValueOf(this.game.config, this.game.content.upgrades, this.game.state, exchangeRate), this.currency,
    );
  }
}
