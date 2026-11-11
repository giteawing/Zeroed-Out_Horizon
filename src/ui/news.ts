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

/** О каких покупках рассказывает рубрика. */
const ABOUT = {
  // Отжатием игра считает покупку с `conquest: true`: у неё скидка от ЧВК и
  // запись «Отжато» в журнале. Группа «Отжатия» в магазине шире — в ней и
  // газета, и свой человек в правительстве.
  conquest: (def: UpgradeDef) => def.conquest === true,
  pmc: (def: UpgradeDef) => def.group === 'pmc',
  // Банковская операция, а не сам банк: купленный банк ещё ничего не отмыл.
  launder: (def: UpgradeDef) => def.effect.launder === true,
  luxury: (def: UpgradeDef) => def.type === 'luxury',
  tax: (def: UpgradeDef) => def.type === 'taxCut',
  periodic: (def: UpgradeDef) => def.type === 'periodic',
};

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
  tax: owns(ABOUT.tax),
  periodic: owns(ABOUT.periodic),
  luxury: owns(ABOUT.luxury),
  launder: owns(ABOUT.launder),
  conquest: owns(ABOUT.conquest),
  pmc: owns(ABOUT.pmc),
} satisfies Record<string, Background | null>;

export type NewsRubric = keyof typeof NEWS_RUBRICS;

/**
 * Рубрика новости о самой покупке: лента отвечает на то, что игрок сделал.
 * Порядок — от частного к общему: отжатый завод — это отжатие, а не «империя
 * выросла».
 */
export function purchaseRubric(def: UpgradeDef): NewsRubric {
  if (ABOUT.conquest(def)) return 'conquest';
  if (ABOUT.pmc(def)) return 'pmc';
  if (ABOUT.launder(def)) return 'launder';
  if (ABOUT.luxury(def)) return 'luxury';
  if (ABOUT.tax(def)) return 'tax';
  if (def.type === 'oneShot' && def.effect.usesWorldPrice === true) return 'export';
  // Покупка даёт влияние, либо это просьба или услуга чиновнику.
  if ((def.effect.influence ?? 0) > 0 || def.group === 'grants' || def.group === 'favors') {
    return 'influence';
  }
  return 'milestone';
}

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
