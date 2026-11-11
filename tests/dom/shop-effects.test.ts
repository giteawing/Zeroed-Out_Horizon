// @vitest-environment happy-dom

/**
 * Магазин показывает на карточке ровно ту строку эффекта, которую собирает
 * `describeEffect()`. Сама строка проверяется без DOM в
 * `tests/effect-line.test.ts`; здесь — что карточки её действительно несут.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { Game } from '../../src/core/game';
import { createInitialState } from '../../src/core/state';
import { describeEffect } from '../../src/ui/effect-line';
import { Shop } from '../../src/ui/shop';
import { Texts } from '../../src/ui/texts';
import type { Tab } from '../../src/core/types';

const TABS: Tab[] = ['technical', 'production', 'sales', 'political', 'luxury', 'goals'];

afterEach(() => {
  document.body.replaceChildren();
});

describe('магазин: строка эффекта на карточке', () => {
  it.each(TABS)('вкладка %s: у каждой карточки строка из describeEffect', (tab) => {
    const content = loadContent();
    const texts = new Texts(content.texts);
    const game = new Game(content, createInitialState(content.config, 2026));
    const shop = new Shop(game, texts, content.config.currency, { onBuy: () => undefined });
    shop.setTab(tab);

    const cards = [...shop.root.querySelectorAll<HTMLElement>('[data-id]')];
    expect(cards.length).toBe(content.upgrades.filter((def) => def.tab === tab).length);
    expect(cards.length).toBeGreaterThan(0);
    const wells = game.state.wells;
    for (const card of cards) {
      const def = content.byId.get(card.dataset.id ?? '');
      expect(def).toBeDefined();
      const effect = card.querySelector('.card__effect');
      expect(effect).not.toBeNull();
      const expected = describeEffect(def!, game.level(def!.id), {
        texts,
        config: content.config,
        currency: content.config.currency,
        lastWell: wells[wells.length - 1],
        unlocks: content.upgrades
          .filter((other) => other.unlockAt?.upgrade === def!.id)
          .map((other) => other.name),
      });
      expect(effect!.textContent, def!.id).toBe(expected);
      expect(expected.trim().length, def!.id).toBeGreaterThan(0);
    }
  });

  it('купленный уровень меняет строку множителя на карточке', () => {
    const content = loadContent();
    const texts = new Texts(content.texts);
    const state = createInitialState(content.config, 2026);
    state.coins = 1e9;
    state.totalEarned = 1e9;
    const game = new Game(content, state);
    const shop = new Shop(game, texts, content.config.currency, { onBuy: () => undefined });
    shop.setTab('technical');
    const effect = shop.root.querySelector('[data-id="t_carat"] .card__effect');
    expect(effect).not.toBeNull();
    const before = effect!.textContent;
    expect(game.buy('t_carat', 4).ok).toBe(true);
    shop.update();
    expect(effect!.textContent).not.toBe(before);
    expect(effect!.textContent).toBe(describeEffect(content.byId.get('t_carat')!, 4, {
      texts,
      config: content.config,
      currency: content.config.currency,
      lastWell: game.state.wells[game.state.wells.length - 1],
      unlocks: [],
    }));
  });
});
