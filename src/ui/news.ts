/**
 * Новостная лента: заголовки берутся из texts.json (минимум 30 строк, ТЗ §8.3)
 * и меняются в ответ на события игры.
 */
import { el } from './dom';
import type { Texts } from './texts';
import type { Rng } from '../core/rng';

const MAX_ITEMS = 4;

export class NewsFeed {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly items: HTMLElement[] = [];

  constructor(
    private readonly texts: Texts,
    private readonly rng: Rng,
  ) {
    this.list = el('ul', { class: 'news__list', 'aria-live': 'polite' });
    this.root = el('section', { class: 'news' }, [
      el('h2', { class: 'news__title' }, this.texts.get('panel.news')),
      this.list,
    ]);
    this.root.dataset.count = String(MAX_ITEMS);
    this.push('start');
  }

  /** Добавить заголовок из категории (start/tap/tax/.../luxury/win). */
  push(category: string): void {
    const lines = this.texts.list('news', category);
    if (lines.length === 0) return;
    const text = this.rng.pick(lines);
    const item = el('li', { class: 'news__item' }, [
      el('span', { class: 'news__tag' }, this.texts.data.news.prefix),
      el('span', { class: 'news__text' }, text),
    ]);
    this.items.unshift(item);
    this.list.prepend(item);
    while (this.items.length >= MAX_ITEMS) {
      const last = this.items.pop();
      last?.remove();
    }
    // Класс нужен, чтобы CSS проиграл анимацию появления.
    requestAnimationFrame(() => item.classList.add('news__item--in'));
  }

  /** Заголовок из случайной категории — для «фоновой» жизни империи. */
  pushRandom(): void {
    const categories = this.texts.newsCategories().filter((c) => c !== 'win');
    this.push(this.rng.pick(categories));
  }
}
