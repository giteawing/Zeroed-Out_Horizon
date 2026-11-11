// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { computeDerived } from '../../src/core/economy';
import { Rng } from '../../src/core/rng';
import { createInitialState } from '../../src/core/state';
import type { GameState } from '../../src/core/types';
import { NEWS_RUBRICS, NewsFeed, backgroundRubrics } from '../../src/ui/news';
import type { NewsContext, NewsRubric } from '../../src/ui/news';
import { Texts } from '../../src/ui/texts';

const content = loadContent();
const texts = new Texts(content.texts);

/** Партия с заданными покупками: фон ленты зависит только от неё. */
function contextFor(levels: Record<string, number>, mutate?: (state: GameState) => void): NewsContext {
  const state = createInitialState(content.config, 5);
  state.levels = { ...levels };
  mutate?.(state);
  const derived = computeDerived(content.config, content.upgrades, state, [], content);
  return { content, state, derived };
}

const linesOf = (rubric: string): string[] => content.texts.news[rubric] as string[];
const rubrics = Object.keys(NEWS_RUBRICS) as NewsRubric[];

describe('новостная лента', () => {
  it('показывает все четыре последних заголовка', () => {
    const feed = new NewsFeed(texts, new Rng(42));
    for (let i = 0; i < 8; i++) feed.push('production');
    expect(feed.root.querySelectorAll('.news__item')).toHaveLength(4);
  });
});

describe('фоновые новости не сообщают о том, чего у игрока нет (REVIEW C5)', () => {
  /** Рубрики, которые выходят только по своему событию. */
  const EVENT_ONLY: NewsRubric[] = ['start', 'win', 'gambleWin', 'gambleLose'];
  /** Общий фон: добыча, рынок и биржа есть с первой секунды партии. */
  const ALWAYS: NewsRubric[] = ['crisis', 'production', 'sales', 'world'];

  it('рубрики ленты — ровно разделы news из texts.json', () => {
    const sections = Object.keys(content.texts.news).filter((key) => key !== 'prefix');
    expect([...rubrics].sort()).toEqual(sections.sort());
    for (const rubric of rubrics) expect(linesOf(rubric).length, rubric).toBeGreaterThan(0);
  });

  it('в начале партии фон — только общие рубрики', () => {
    expect(backgroundRubrics(contextFor({})).sort()).toEqual(ALWAYS);
  });

  it('за 600 фоновых новостей новая партия не слышит о банке, ЧВК, отжатии, роскоши и ставках', () => {
    const feed = new NewsFeed(texts, new Rng(7));
    const context = contextFor({});
    const allowed = new Set(ALWAYS.flatMap(linesOf));
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      feed.pushRandom(context);
      seen.add(feed.root.querySelector('.news__text')?.textContent ?? '');
    }
    expect([...seen].filter((text) => !allowed.has(text))).toEqual([]);
    // Фон при этом не обеднел до одной строки: каждая общая рубрика выходит.
    for (const rubric of ALWAYS) {
      expect(linesOf(rubric).some((line) => seen.has(line)), rubric).toBe(true);
    }
  });

  /**
   * Что должно появиться у игрока, чтобы рубрика вышла в фон. Покупки
   * подобраны так, чтобы каждая открывала свою рубрику и не задевала соседние.
   */
  const OPENED_BY: Array<[NewsRubric, Record<string, number>, ((state: GameState) => void)?]> = [
    ['milestone', {}, (state) => { state.totalPurchases = 1; }],
    ['export', { x_cistern: 1 }],
    ['influence', { p_parliament: 1 }],
    ['tax', { p_sauna: 1 }],
    ['periodic', { t_core: 1 }],
    ['luxury', { l_ring: 1 }],
    ['launder', { p_tranche: 1 }],
    ['conquest', { p_field: 1 }],
    ['pmc', { pmc_vet: 1 }],
  ];

  it.each(OPENED_BY)('рубрика «%s» выходит в фон только после своей покупки', (rubric, levels, mutate) => {
    expect(backgroundRubrics(contextFor({}))).not.toContain(rubric);
    const opened = backgroundRubrics(contextFor(levels, mutate));
    expect(opened).toContain(rubric);
    // Общий фон никуда не делся, событийные рубрики не появились.
    for (const always of ALWAYS) expect(opened).toContain(always);
    for (const event of EVENT_ONLY) expect(opened).not.toContain(event);
  });

  it('таблица проверки покрывает все рубрики', () => {
    const covered = [...EVENT_ONLY, ...ALWAYS, ...OPENED_BY.map(([rubric]) => rubric)];
    expect([...covered].sort()).toEqual([...rubrics].sort());
  });

  it('ЧВК даёт влияние, поэтому открывает обе рубрики, а банк без операций — ни одной', () => {
    const withPmc = backgroundRubrics(contextFor({ pmc_vet: 1 }));
    expect(withPmc).toContain('pmc');
    expect(withPmc).toContain('influence');
    // Купленный банк ещё ничего не отмывал: новости об отмывании рано.
    const withBank = backgroundRubrics(contextFor({ p_badbank: 1 }));
    expect(withBank).not.toContain('launder');
    expect(withBank).toContain('tax');
  });

  it('игрок, купивший всё, слышит все фоновые рубрики и ни одной событийной', () => {
    const everything = Object.fromEntries(content.upgrades.map((def) => [def.id, 1]));
    const all = backgroundRubrics(contextFor(everything, (state) => { state.totalPurchases = 500; }));
    expect([...all].sort()).toEqual(rubrics.filter((rubric) => !EVENT_ONLY.includes(rubric)).sort());
  });

  it('фоновая новость берётся из разрешённой рубрики и при богатой партии', () => {
    const feed = new NewsFeed(texts, new Rng(11));
    const context = contextFor({ pmc_vet: 1, l_ring: 1 }, (state) => { state.totalPurchases = 2; });
    const allowed = new Set(backgroundRubrics(context).flatMap(linesOf));
    const pmc = new Set(linesOf('pmc'));
    let heardPmc = false;
    for (let i = 0; i < 600; i++) {
      feed.pushRandom(context);
      const text = feed.root.querySelector('.news__text')?.textContent ?? '';
      expect(allowed.has(text), text).toBe(true);
      heardPmc ||= pmc.has(text);
    }
    expect(heardPmc).toBe(true);
  });
});
