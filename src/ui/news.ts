/**
 * Новостная лента: заголовки берутся из texts.json (минимум 30 строк, ТЗ §8.3)
 * и меняются в ответ на события игры.
 */
import { el } from './dom';
import type { Texts } from './texts';
import type { Rng } from '../core/rng';
import { levelOf } from '../core/economy';
import type { Content, DerivedStats, GameState, UpgradeDef } from '../core/types';

const MAX_ITEMS = 4;

/** Что лента знает об игре, когда выбирает фоновую новость. */
export interface NewsContext {
  content: Content;
  state: GameState;
  derived: DerivedStats;
}

type Background = (context: NewsContext) => boolean;

const always: Background = () => true;
/** У игрока есть хотя бы одна покупка, о которой рассказывает рубрика. */
const owns = (about: (def: UpgradeDef) => boolean): Background =>
  ({ content, state }) => content.upgrades.some((def) => levelOf(state, def.id) > 0 && about(def));

/**
 * Рубрики ленты — разделы `news` в texts.json. Значение — когда рубрика
 * годится для фоновой новости (она выходит без повода, раз в несколько
 * секунд): лента не должна сообщать о том, чего у игрока нет, — о банке до
 * покупки банка или о ставке, которую никто не делал. `null` — рубрика
 * выходит только по своему событию.
 */
export const NEWS_RUBRICS = {
  // Только по событию: начало партии, финал, исход ставки.
  start: null,
  win: null,
  gambleWin: null,
  gambleLose: null,
  // Общий фон: добыча, внутренний рынок и биржа есть с первой секунды.
  production: always,
  sales: always,
  world: always,
  crisis: always,
  // Остальное — когда появилось то, о чём новость.
  milestone: ({ state }) => state.totalPurchases > 0,
  export: ({ derived }) => derived.exportThroughputCapacity > 0,
  influence: ({ derived }) => derived.influence > 0,
  tax: owns((def) => def.type === 'taxCut'),
  periodic: owns((def) => def.type === 'periodic'),
  luxury: owns((def) => def.type === 'luxury'),
  // Банковская операция проведена хотя бы раз: сам банк ещё не новость.
  launder: owns((def) => def.effect.launder === true),
  // Эти две рубрики названы так же, как группы покупок в магазине.
  conquest: owns((def) => def.conquest === true || def.group === 'conquest'),
  pmc: owns((def) => def.group === 'pmc'),
} satisfies Record<string, Background | null>;

export type NewsRubric = keyof typeof NEWS_RUBRICS;

/** Рубрики, из которых сейчас можно взять фоновую новость. */
export function backgroundRubrics(context: NewsContext): NewsRubric[] {
  return (Object.keys(NEWS_RUBRICS) as NewsRubric[]).filter((rubric) => {
    const allowed: Background | null = NEWS_RUBRICS[rubric];
    return allowed !== null && allowed(context);
  });
}

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

  /** Добавить заголовок из рубрики. */
  push(rubric: NewsRubric): void {
    const lines = this.texts.list('news', rubric);
    if (lines.length === 0) return;
    const text = this.rng.pick(lines);
    const item = el('li', { class: 'news__item' }, [
      el('span', { class: 'news__tag' }, this.texts.data.news.prefix),
      el('span', { class: 'news__text' }, text),
    ]);
    this.items.unshift(item);
    this.list.prepend(item);
    while (this.items.length > MAX_ITEMS) {
      const last = this.items.pop();
      last?.remove();
    }
    // Класс нужен, чтобы CSS проиграл анимацию появления.
    requestAnimationFrame(() => item.classList.add('news__item--in'));
  }

  /** Фоновая новость — «жизнь империи» между событиями. */
  pushRandom(context: NewsContext): void {
    this.push(this.rng.pick(backgroundRubrics(context)));
  }
}
