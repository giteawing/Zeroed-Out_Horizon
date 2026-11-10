/**
 * REVIEW B9: правило достижения выдаёт его ровно за то, что написано в тексте.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { stagedNameOf } from '../src/core/economy';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';

const content = loadContent();

function setup(seed = 31) {
  const state = createInitialState(content.config, seed);
  const game = new Game(content, state);
  return { state, game };
}

/** Игрок владеет покупкой — проверяем правило, а не побочный эффект buy(). */
function own(id: string, level = 1): string[] {
  const { state, game } = setup();
  state.levels[id] = level;
  game.invalidate();
  game.checkAchievements();
  return state.achievements;
}

const textOf = (id: string) => {
  const text = content.texts.achievements.list.find((entry) => entry.id === id);
  expect(text, id).toBeDefined();
  return text!;
};

describe('достижения соответствуют своим описаниям (REVIEW B9)', () => {
  it('«предмет одежды» — это пиджак или шуба, а не сигары, часы и украшения', () => {
    for (const id of ['l_jacket1', 'l_jacket2', 'l_jacket3', 'l_fur']) {
      expect(own(id), id).toContain('a_hat');
    }
    for (const id of ['l_cigars', 'l_watch1', 'l_watch3', 'l_cane', 'l_ring', 'l_crown']) {
      expect(own(id), id).not.toContain('a_hat');
    }
    expect(textOf('a_hat').description).toMatch(/одежд/);
  });

  it('пиджак выдаёт достижение сразу при покупке', () => {
    const { state, game } = setup();
    state.coins = 1e30;
    state.totalEarned = 1e30;
    expect(game.buy('l_jacket1').ok).toBe(true);
    expect(state.achievements).toContain('a_hat');
  });

  it('«украшение» — любая вещь из линейки «Брюлики», но не часы и не одежда', () => {
    const jewelry = content.upgrades.filter((def) => def.name.startsWith('Брюлики'));
    expect(jewelry.map((def) => def.id).sort()).toEqual(['l_crown', 'l_necklace', 'l_ring', 'l_signet']);
    for (const def of jewelry) expect(own(def.id), def.id).toContain('a_brilliant');
    for (const id of ['l_watch1', 'l_jacket1', 'l_cigars', 'l_fur']) {
      expect(own(id), id).not.toContain('a_brilliant');
    }
  });

  it('«Терминатор» выдаётся, когда долото становится «Терминатором»', () => {
    const blade = content.byId.get('d1_blade');
    expect(blade).toBeDefined();
    const rule = content.achievements.find((entry) => entry.id === 'a_drill7')?.rule;
    expect(rule).toMatchObject({ kind: 'own', upgrade: 'd1_blade' });
    const level = rule?.kind === 'own' ? rule.value ?? 1 : 0;
    const name = textOf('a_drill7').name;

    expect(stagedNameOf(blade!, level)).toContain(name);
    expect(stagedNameOf(blade!, level - 1)).not.toContain(name);
    expect(own('d1_blade', level - 1)).not.toContain('a_drill7');
    expect(own('d1_blade', level)).toContain('a_drill7');
    // Описание называет модель и уровень, которые проверяет правило.
    expect(textOf('a_drill7').description).toContain(name);
    expect(textOf('a_drill7').description).toContain(String(level));
  });

  it('«Пихнул» выдаётся за акцию, которую называет описание', () => {
    const def = content.byId.get('p_export');
    expect(def).toBeDefined();
    expect(content.achievements.find((entry) => entry.id === 'a_import')?.rule)
      .toEqual({ kind: 'own', upgrade: 'p_export' });
    // Акция может уйти и по контрактной цене внутри страны, поэтому описание
    // говорит о самой «Контрабанде», а не о «нефти за границей».
    expect(textOf('a_import').description).toContain(`«${def!.name}»`);

    const { state, game } = setup();
    state.totalEarned = 1e9;
    state.oil = 400;
    game.invalidate();
    game.checkAchievements();
    expect(state.achievements).not.toContain('a_import');
    expect(game.buy('p_export').ok).toBe(true);
    game.checkAchievements();
    expect(state.achievements).toContain('a_import');
  });

  it('название покупки в журнале совпадает с названием в магазине', () => {
    // Журнал берёт имена из texts.upgrades, магазин — из upgrades.json.
    for (const def of content.upgrades) {
      const expected = def.stagedNames?.[0] ?? def.name;
      expect(content.texts.upgrades?.[def.id], def.id).toBe(expected);
    }
  });
});
