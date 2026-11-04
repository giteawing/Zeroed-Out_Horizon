/**
 * Стартовый экран: логотип, слоган и кнопка «Начать бурить».
 * Показывается при первом запуске и по кнопке «Новая игра».
 */
import { el } from './dom';
import { image } from '../core/assets';
import type { Texts } from './texts';

export interface StartCallbacks {
  onStart: (fresh: boolean) => void;
}

export class StartScreen {
  readonly root: HTMLElement;

  constructor(
    texts: Texts,
    private readonly callbacks: StartCallbacks,
    hasSave: boolean,
  ) {
    const primary = el('button', { class: 'btn btn--gold btn--big', type: 'button' }, '');
    primary.textContent = hasSave
      ? texts.get('start.continueButton')
      : texts.get('start.startButton');
    primary.addEventListener('click', () => this.callbacks.onStart(false));

    const actions: HTMLElement[] = [primary];
    if (hasSave) {
      const fresh = el('button', { class: 'btn btn--ghost', type: 'button' }, texts.get('start.newGameButton'));
      fresh.addEventListener('click', () => {
        if (window.confirm(texts.get('start.newGameConfirm'))) {
          this.callbacks.onStart(true);
        }
      });
      actions.push(fresh);
    }

    this.root = el('div', { class: 'start' }, [
      el('div', { class: 'start__inner' }, [
        el('img', {
          class: 'start__logo',
          src: image('logo.svg'),
          alt: texts.data.meta.title,
          width: 660,
          height: 330,
        }),
        el('p', { class: 'start__tagline' }, texts.get('start.tagline')),
        el('div', { class: 'start__actions' }, actions),
        el('p', { class: 'start__hint' }, texts.get('start.hint')),
        el('p', { class: 'start__note' }, texts.get('start.autosaveNote')),
      ]),
    ]);
  }

  hide(): void {
    this.root.classList.add('start--hidden');
    window.setTimeout(() => this.root.remove(), 420);
  }
}
