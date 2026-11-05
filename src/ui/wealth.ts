/**
 * «Витрина богатства»: все купленные предметы роскоши в одном месте (ТЗ §6.3).
 *
 * Окно закрывается тремя способами, как и остальные шторки: кнопкой «Закрыть»,
 * кликом по пустому месту вокруг листа и Escape (Escape обрабатывает main.ts).
 * Раньше кнопки не было вовсе, а клик по фону никто не слушал — открытая
 * витрина оставалась на экране навсегда.
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

    const close = el('button', { class: 'btn btn--gold', type: 'button' }, texts.get('panel.close'));
    close.addEventListener('click', () => this.close());

    this.root = el('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'sheet__inner' }, [
        el('h2', { class: 'sheet__title' }, texts.get('panel.wealth')),
        this.grid,
        close,
      ]),
    ]);

    // Клик по затемнению закрывает окно, клик по самому листу — нет.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
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
