// @vitest-environment happy-dom

/**
 * Магазин обновляется пять раз в секунду. Раньше каждое обновление заново
 * фильтровало и сортировало контент, проверяло каждую покупку минимум дважды,
 * переписывало текст всех карточек и пересобирало список целиком, когда
 * открывалась новая карточка (REVIEW C11, AUDIT F09).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/core/content';
import { Game } from '../../src/core/game';
import { formatNumber } from '../../src/core/format';
import { createInitialState } from '../../src/core/state';
import { Shop } from '../../src/ui/shop';
import { Texts } from '../../src/ui/texts';
import type { Content, Tab, UpgradeDef } from '../../src/core/types';

const TABS: Tab[] = ['technical', 'production', 'sales', 'political', 'luxury', 'goals'];

function setup(coins = 0): { content: Content; game: Game; shop: Shop } {
  const content = loadContent();
  const state = createInitialState(content.config, 2026);
  if (coins > 0) {
    state.coins = coins;
    state.totalEarned = coins;
  }
  const game = new Game(content, state);
  const shop = new Shop(game, new Texts(content.texts), content.config.currency, {
    onBuy: (id, count) => { game.buy(id, count); },
  });
  document.body.append(shop.root);
  return { content, game, shop };
}

/**
 * Разметка, как её видит игрок: без порядка атрибутов и классов (он зависит
 * от порядка записи) и без пустых текстовых узлов.
 */
function markup(node: Element): unknown {
  return {
    tag: node.tagName,
    attributes: [...node.attributes]
      .map((attribute) => attribute.name === 'class'
        ? `class=${attribute.value.split(/\s+/).filter(Boolean).sort().join(' ')}`
        : `${attribute.name}=${attribute.value}`)
      .sort(),
    children: [...node.childNodes]
      .filter((child) => child.nodeType === 1 || (child.textContent ?? '') !== '')
      .map((child) => (child.nodeType === 1 ? markup(child as Element) : child.textContent)),
  };
}

/** Магазин, собранный с нуля для текущего состояния игры. */
function freshShopMarkup(content: Content, game: Game, tab: Tab): unknown {
  const shop = new Shop(game, new Texts(content.texts), content.config.currency, { onBuy: () => undefined });
  shop.setTab(tab);
  return markup(shop.root);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('магазин: обновление без лишней работы (REVIEW C11, AUDIT F09)', () => {
  it('тесты ниже проходят по всем вкладкам магазина', () => {
    const { shop } = setup();
    const tabs = [...shop.root.querySelectorAll<HTMLElement>('[data-tab]')].map((button) => button.dataset.tab);
    expect(tabs).toEqual(TABS);
  });

  it.each(TABS)('вкладка %s: одна проверка покупки на карточку за обновление', (tab) => {
    const { game, shop } = setup(1e12);
    shop.setTab(tab);
    expect(shop.cardCount).toBeGreaterThan(0);

    const checkBuy = vi.spyOn(game, 'checkBuy');
    shop.update();

    const single = checkBuy.mock.calls.filter(([, count]) => count === undefined || count === 1);
    expect(single.map(([id]) => id).sort()).toEqual(
      [...shop.root.querySelectorAll<HTMLElement>('.card')].map((card) => card.dataset.id!).sort(),
    );
    // Цена пачки — ещё одна проверка, но не больше одной на карточку.
    const packs = checkBuy.mock.calls.filter(([, count]) => count !== undefined && count > 1).map(([id]) => id);
    expect(new Set(packs).size).toBe(packs.length);
    expect(checkBuy.mock.calls.length).toBe(shop.cardCount + packs.length);
  });

  it('у богатого игрока есть карточки с пачкой, и их цена всё ещё считается', () => {
    const { game, shop } = setup(1e12);
    shop.setTab('production');
    const checkBuy = vi.spyOn(game, 'checkBuy');
    shop.update();
    const packs = checkBuy.mock.calls.filter(([, count]) => count !== undefined && count > 1);
    expect(packs.length).toBeGreaterThan(0);
    const [id, count] = packs[0];
    const button = shop.root.querySelector<HTMLButtonElement>(`[data-id="${id}"] .card__buy`)!;
    expect(button.dataset.count).toBe(String(count));
  });

  it('список вкладки сортируется при её открытии, а не при каждом обновлении', () => {
    const { shop } = setup(1e9);
    shop.setTab('technical');
    const sort = vi.spyOn(Array.prototype, 'sort');
    for (let i = 0; i < 5; i++) shop.update();
    expect(sort).not.toHaveBeenCalled();
  });

  it.each(TABS)('вкладка %s: без изменений в игре обновление ничего не пишет в DOM', (tab) => {
    const { shop } = setup(1e12);
    shop.setTab(tab);
    shop.update();

    const observer = new MutationObserver(() => undefined);
    observer.observe(shop.root, { subtree: true, childList: true, characterData: true, attributes: true });
    shop.update();
    shop.update();
    const records = observer.takeRecords();
    observer.disconnect();

    const summary = records.map((record) => {
      const target = record.target as Element;
      const where = target.nodeType === 1 ? target.className : target.parentElement?.className;
      return `${record.type}${record.attributeName ? `[${record.attributeName}]` : ''} @ ${where}`;
    });
    expect([...new Set(summary)].join('; ')).toBe('');
  });

  it('наблюдатель видит запись текста: проверка выше не пустая', () => {
    const { game, shop } = setup(1e12);
    shop.setTab('production');
    shop.update();
    const observer = new MutationObserver(() => undefined);
    observer.observe(shop.root, { subtree: true, childList: true, characterData: true, attributes: true });
    expect(game.buy('t_well').ok).toBe(true);
    shop.update();
    const records = observer.takeRecords();
    observer.disconnect();
    expect(records.length).toBeGreaterThan(0);
  });
});

describe('магазин: карточки живут, пока открыта вкладка (REVIEW C11)', () => {
  /** Пара на одной вкладке: покупка первой открывает вторую. Проверяется на копии игры. */
  function unlockingPair(content: Content, coins: number): { opener: UpgradeDef; opened: UpgradeDef } {
    for (const opened of content.upgrades) {
      const need = opened.unlockAt?.upgrade;
      if (!need) continue;
      const opener = content.byId.get(need)!;
      if (opener.tab !== opened.tab) continue;
      const state = createInitialState(content.config, 2026);
      state.coins = coins;
      state.totalEarned = coins;
      const probe = new Game(content, state);
      if (probe.checkBuy(opened.id).unlocked || !probe.buy(opener.id).ok) continue;
      if (probe.checkBuy(opened.id).unlocked) return { opener, opened };
    }
    throw new Error('в контенте нет пары «покупка открывает соседнюю карточку»');
  }

  it('покупка, открывающая соседнюю карточку, не пересоздаёт список и не сбрасывает фокус', () => {
    const { content, game, shop } = setup(1e12);
    const { opener, opened } = unlockingPair(content, 1e12);
    shop.setTab(opener.tab);

    const button = shop.root.querySelector<HTMLButtonElement>(`[data-id="${opener.id}"] .card__buy`)!;
    const openedCard = shop.root.querySelector<HTMLElement>(`[data-id="${opened.id}"]`)!;
    expect(openedCard.classList.contains('card--locked')).toBe(true);
    const cards = [...shop.root.querySelectorAll('.card')];
    button.focus();
    expect(document.activeElement).toBe(button);

    button.click();
    shop.update();

    expect(game.level(opener.id)).toBeGreaterThan(0);
    expect(game.checkBuy(opened.id).unlocked).toBe(true);
    // Те же узлы: игрок с клавиатуры остаётся на своей кнопке.
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect([...shop.root.querySelectorAll('.card')]).toEqual(cards);
    // И при этом карточка действительно открылась.
    expect(openedCard.isConnected).toBe(true);
    expect(openedCard.classList.contains('card--locked')).toBe(false);
    expect(openedCard.querySelector<HTMLElement>('.card__lock')!.hidden).toBe(true);
  });

  it.each(TABS)('вкладка %s: обновлённые карточки совпадают с собранными заново', (tab) => {
    const { content, game, shop } = setup(5e7);
    shop.setTab(tab);
    let seed = 12345;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    let bought = 0;
    for (let round = 0; round < 12; round++) {
      // Несколько случайных покупок с любых вкладок, затем немного игрового времени.
      for (let attempt = 0; attempt < 3; attempt++) {
        const affordable = content.upgrades.filter((def) => !def.win && game.checkBuy(def.id).ok);
        if (affordable.length === 0) break;
        const def = affordable[Math.floor(random() * affordable.length)];
        if (game.buy(def.id, 1 + Math.floor(random() * 3)).ok) bought++;
      }
      game.update(100 + Math.floor(random() * 4000));
      shop.update();
      expect(markup(shop.root), `раунд ${round}`).toEqual(freshShopMarkup(content, game, tab));
      // Сравнение с новой сборкой не заметит поле, которое не пишется вовсе,
      // поэтому главное сверяем с самой игрой.
      for (const card of shop.root.querySelectorAll<HTMLElement>('.card')) {
        const id = card.dataset.id!;
        const button = card.querySelector<HTMLButtonElement>('.card__buy')!;
        expect(button.dataset.count, id).toMatch(/^[1-9]\d*$/);
        const check = game.checkBuy(id, Number(button.dataset.count));
        expect(button.disabled, id).toBe(!check.ok);
        expect(button.dataset.reason, id).toBe(check.reason ?? 'ok');
        expect(card.classList.contains('card--locked'), id).toBe(!check.unlocked);
        expect(card.querySelector('.card__name')!.textContent, id).not.toBe('');
        expect(card.querySelector('.card__cost')!.textContent, id).not.toBe('');
        expect(card.querySelector('.card__effect')!.textContent, id).not.toBe('');
      }
    }
    expect(bought).toBeGreaterThan(20);
  });

  it('строка эффекта, уровень и цена следуют за покупкой', () => {
    const { content, game, shop } = setup(1e12);
    const texts = new Texts(content.texts);
    const def = content.upgrades.find((candidate) =>
      candidate.type === 'storage' && candidate.maxLevel >= 3 && game.checkBuy(candidate.id).ok)!;
    expect(def).toBeDefined();
    shop.setTab(def.tab);
    const card = shop.root.querySelector<HTMLElement>(`[data-id="${def.id}"]`)!;
    const effect = card.querySelector('.card__effect')!;
    const level = card.querySelector<HTMLElement>('.card__level')!;
    const cost = card.querySelector('.card__cost')!;
    const effectAt = (levels: number): string =>
      texts.get('shop.effectStorage', { value: formatNumber((def.effect.value ?? 0) * levels) });

    expect(effect.textContent).toBe(effectAt(1));
    expect(level.hidden).toBe(true);
    const costBefore = cost.textContent;

    expect(game.buy(def.id, 3).ok).toBe(true);
    shop.update();

    expect(effect.textContent).toBe(effectAt(3));
    expect(effectAt(3)).not.toBe(effectAt(1));
    expect(level.hidden).toBe(false);
    expect(level.textContent).toBe(`3/${def.maxLevel}`);
    expect(cost.textContent).not.toBe(costBefore);
  });

  it('новая игра обновляет те же карточки', () => {
    const { content, game, shop } = setup(1e12);
    shop.setTab('production');
    expect(game.buy('t_well', 5).ok).toBe(true);
    shop.update();
    const level = shop.root.querySelector<HTMLElement>('[data-id="t_well"] .card__level')!;
    expect(level.hidden).toBe(false);

    game.reset(createInitialState(content.config, 7));
    shop.update();
    expect(level.isConnected).toBe(true);
    expect(level.hidden).toBe(true);
    expect(markup(shop.root)).toEqual(freshShopMarkup(content, game, 'production'));
  });
});
