/**
 * AUDIT F03: условия финала считались в трёх местах (движок, магазин,
 * «Правила»), и два из них показывали игроку порог «заработано всего» без
 * кривой `currencyCostCurve`. Единый источник — `winRequirementBlocker`.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import {
  adjustCurrencyCost,
  isWinReady,
  requirementBlocker,
  requirementTerms,
  unlockBlocker,
  winCostOf,
  winRequirementBlocker,
  winRequirementTerms,
} from '../src/core/economy';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';
import type { Content } from '../src/core/types';

const RAW_BALANCE = 1e14;

function contentWith(requirements: Content['config']['winRequirements']): Content {
  const content = structuredClone(loadContent());
  content.config.winRequirements = requirements;
  content.byId = new Map(content.upgrades.map((def) => [def.id, def]));
  return content;
}

describe('единый расчёт условий финала (AUDIT F03)', () => {
  it('кривая цен действительно сжимает порог: тест не вырожден', () => {
    const { config } = loadContent();
    const adjusted = adjustCurrencyCost(config, RAW_BALANCE);
    expect(adjusted).toBeGreaterThan(0);
    expect(adjusted).toBeLessThan(RAW_BALANCE / 100);
  });

  it('requirementTerms перечисляет все условия с итоговыми порогами', () => {
    const { config } = loadContent();
    expect(requirementTerms({}, config)).toEqual([]);
    expect(requirementTerms({ balance: RAW_BALANCE, upgrade: 't_smart', influence: 7 }, config))
      .toEqual([
        { kind: 'balance', value: adjustCurrencyCost(config, RAW_BALANCE) },
        { kind: 'upgrade', id: 't_smart', level: 1 },
        { kind: 'influence', value: 7 },
      ]);
    // Без конфигурации порог не пересчитывается (так работают юнит-тесты цен).
    expect(requirementTerms({ balance: 1000 })).toEqual([{ kind: 'balance', value: 1000 }]);
  });

  it('unlockBlocker и requirementBlocker дают один и тот же ответ', () => {
    const content = loadContent();
    const state = createInitialState(content.config, 1);
    for (const def of content.upgrades) {
      const expected = def.unlockAt
        ? requirementBlocker(def.unlockAt, state, 0, content.config)
        : null;
      expect(unlockBlocker(def, state, 0, content.config), def.id).toEqual(expected);
    }
  });

  it('порог «заработано всего» проходит через currencyCostCurve', () => {
    const content = contentWith([{ balance: RAW_BALANCE }]);
    const { config } = content;
    const adjusted = adjustCurrencyCost(config, RAW_BALANCE);
    const state = createInitialState(config, 2);
    state.coins = winCostOf(config, content.upgrades);

    state.totalEarned = adjusted - 1;
    expect(winRequirementBlocker(config, state, 0)).toEqual({ kind: 'balance', value: adjusted });
    expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(false);

    state.totalEarned = adjusted;
    expect(winRequirementBlocker(config, state, 0)).toBeNull();
    expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(true);
    expect(winRequirementTerms(config)).toEqual([{ kind: 'balance', value: adjusted }]);
  });

  it('называет первое невыполненное условие: улучшение, затем влияние', () => {
    const content = contentWith([{ upgrade: 't_pump4', level: 5 }, { influence: 3 }]);
    const { config } = content;
    const state = createInitialState(config, 3);
    expect(winRequirementBlocker(config, state, 0)).toEqual({ kind: 'upgrade', id: 't_pump4', level: 5 });
    state.levels.t_pump4 = 4;
    expect(winRequirementBlocker(config, state, 0)).toEqual({ kind: 'upgrade', id: 't_pump4', level: 5 });
    state.levels.t_pump4 = 5;
    expect(winRequirementBlocker(config, state, 2.99)).toEqual({ kind: 'influence', value: 3 });
    expect(winRequirementBlocker(config, state, 3)).toBeNull();
    expect(winRequirementTerms(config)).toEqual([
      { kind: 'upgrade', id: 't_pump4', level: 5 },
      { kind: 'influence', value: 3 },
    ]);
  });

  it('isWinReady = хватает денег и нет невыполненного условия — для боевого контента', () => {
    const content = loadContent();
    const { config } = content;
    const state = createInitialState(config, 4);
    const cost = winCostOf(config, content.upgrades);
    expect(config.winRequirements.length).toBeGreaterThan(0);
    expect(winRequirementBlocker(config, state, 0)).not.toBeNull();
    expect(isWinReady(config, content.upgrades, state, cost)).toBe(false);
    for (const term of winRequirementTerms(config)) {
      if (term.kind === 'upgrade') state.levels[term.id] = term.level;
      if (term.kind === 'balance') state.totalEarned = Math.max(state.totalEarned, term.value);
    }
    const influence = Math.max(
      0, ...winRequirementTerms(config).map((term) => (term.kind === 'influence' ? term.value : 0)),
    );
    expect(winRequirementBlocker(config, state, influence)).toBeNull();
    expect(isWinReady(config, content.upgrades, state, cost, influence)).toBe(true);
    expect(isWinReady(config, content.upgrades, state, cost - 1, influence)).toBe(false);
  });

  it('Game.checkBuy финала согласован с winRequirementBlocker', () => {
    const content = contentWith([{ balance: RAW_BALANCE }]);
    const { config } = content;
    const win = content.upgrades.find((def) => def.win);
    expect(win).toBeDefined();
    const adjusted = adjustCurrencyCost(config, RAW_BALANCE);
    const state = createInitialState(config, 5);
    // Карточка финала открыта, денег хватает — мешает только условие финала.
    state.totalEarned = Math.max(
      0, adjustCurrencyCost(config, win!.unlockAt?.balance ?? 0),
    );
    state.coins = winCostOf(config, content.upgrades);
    const game = new Game(content, state);
    if (state.totalEarned < adjusted) {
      expect(game.checkBuy(win!.id).ok).toBe(false);
    }
    state.totalEarned = adjusted;
    game.invalidate();
    expect(game.checkBuy(win!.id).ok).toBe(true);
  });
});
