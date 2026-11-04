/**
 * «Витрина богатства»: все купленные предметы роскоши в одном месте (ТЗ §6.3).
 */
import { el } from './dom';
import { icon } from '../core/assets';
import type { Texts } from './texts';
import type { Game } from '../core/game';

export class Wealth {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;

  constructor(
    private readonly game: Game,
    texts: Texts,
  ) {
    this.grid = el('div', { class: 'wealth__grid' });
    this.root = el('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'sheet__inner' }, [
        el('h2', { class: 'sheet__title' }, texts.get('panel.wealth')),
        this.grid,
      ]),
    ]);
  }

  open(): void {
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  render(): void {
    const owned = this.game.content.upgrades.filter(
      (u) => u.type === 'luxury' && this.game.level(u.id) > 0,
    );
    this.grid.replaceChildren(
      ...owned.map((def) =>
        el('figure', { class: 'wealth__item' }, [
          el('img', { src: icon(def.icon), alt: def.name, width: 64, height: 64 }),
          el('figcaption', {}, [el('strong', {}, def.name), el('span', {}, def.description)]),
        ]),
      ),
    );
  }
}
