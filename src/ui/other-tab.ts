/**
 * Сообщение второй вкладки: игра уже открыта в другой, и сохранение — её.
 *
 * Закрыть сообщение нельзя: под ним игра, которая не имеет права ни идти, ни
 * сохраняться. Оно уходит само, когда первая вкладка закрывается.
 */
import { el } from './dom';
import type { Texts } from './texts';

export class OtherTabNotice {
  readonly root: HTMLElement;

  constructor(texts: Texts) {
    const title = el('h2', { class: 'sheet__title', id: 'other-tab-title' }, texts.get('save.otherTabTitle'));
    const text = el('p', { class: 'sheet__text', id: 'other-tab-text' }, texts.get('save.otherTabText'));
    this.root = el('div', {
      class: 'sheet sheet--blocking',
      hidden: true,
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'other-tab-title',
      'aria-describedby': 'other-tab-text',
      'data-testid': 'other-tab',
      tabindex: '-1',
    }, [el('div', { class: 'sheet__inner' }, [title, text])]);
  }

  show(): void {
    this.root.hidden = false;
    this.root.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }
}
