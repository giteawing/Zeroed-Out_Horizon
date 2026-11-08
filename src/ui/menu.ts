/**
 * Меню шапки: одна иконка, из которой открывается список действий.
 *
 * Раньше в шапке висели пять кнопок подряд — они занимали место, которое
 * нужнее деньгам и влиянию. Теперь там одна «гамбургер»-иконка, а все
 * действия собраны в аккуратную панель под ней.
 */
import { el } from './dom';
import type { Texts } from './texts';

export interface MenuItem {
  /** Идентификатор для тестов и обновления состояния (звук вкл/выкл). */
  id: string;
  icon: string;
  label: string;
  onSelect: () => void;
  /** Для переключателей: текущее состояние, чтобы поставить галочку. */
  isOn?: () => boolean;
  /** Условно показывать пункт меню (например, финал только после победы). */
  isVisible?: () => boolean;
}

export class Menu {
  readonly root: HTMLElement;
  private readonly items: MenuItem[];
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private anchor: HTMLElement | null = null;

  constructor(private readonly texts: Texts, items: MenuItem[]) {
    this.items = items;
    this.root = el('div', {
      class: 'menu',
      hidden: true,
      role: 'menu',
      'aria-label': texts.get('menu.title'),
    });
    for (const item of items) {
      const button = el('button', {
        class: 'menu__item',
        type: 'button',
        // Переключатели (звук) — чекбоксы для скринридера, остальные — пункты.
        role: item.isOn ? 'menuitemcheckbox' : 'menuitem',
        'data-menu': item.id,
      }, [
        el('span', { class: 'menu__icon', 'aria-hidden': 'true' }, item.icon),
        el('span', { class: 'menu__label' }, item.label),
        el('span', { class: 'menu__state' }, ''),
      ]);
      button.addEventListener('click', () => {
        this.close();
        item.onSelect();
      });
      this.buttons.set(item.id, button);
      this.root.append(button);
    }

    // Клик мимо меню и Escape закрывают его — как обычное контекстное меню.
    document.addEventListener('pointerdown', (event) => {
      if (this.root.hidden) return;
      const target = event.target as Node | null;
      if (target && (this.root.contains(target) || this.anchor?.contains(target))) return;
      this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.root.hidden) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(anchor: HTMLElement): void {
    this.anchor = anchor;
    this.root.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    this.refresh();
  }

  close(): void {
    this.root.hidden = true;
    this.anchor?.setAttribute('aria-expanded', 'false');
  }

  toggle(anchor: HTMLElement): void {
    if (this.isOpen) this.close();
    else this.open(anchor);
  }

  /** Обновить галочки переключателей (звук включён/выключен). */
  refresh(): void {
    for (const item of this.items) {
      const node = this.buttons.get(item.id);
      if (!node) continue;
      const visible = item.isVisible?.() ?? true;
      node.hidden = !visible;
      if (!visible || !item.isOn) continue;
      const state = node.querySelector('.menu__state');
      if (state) state.textContent = item.isOn() ? this.texts.get('menu.on') : this.texts.get('menu.off');
      node.setAttribute('aria-checked', String(item.isOn()));
    }
  }
}
