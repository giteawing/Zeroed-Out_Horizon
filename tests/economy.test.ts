import { describe, expect, it } from 'vitest';
import {
  affordableLevels,
  computeDerived,
  costFor,
  eventPayout,
  exportPayout,
  isUnlocked,
  isWinReady,
  netForInterval,
  totalCostFor,
  unlockBlocker,
  winCostOf,
} from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import { loadContent } from '../src/core/content';
import type { GameConfig, GameState, UpgradeDef } from '../src/core/types';

const content = loadContent();
const config = content.config;

function makeUpgrade(partial: Partial<UpgradeDef>): UpgradeDef {
  return {
    id: 'x',
    tab: 'technical',
    group: 'test',
    name: 'Тест',
    description: 'Тест',
    icon: 'well',
    type: 'passive',
    baseCost: 100,
    maxLevel: 10,
    effect: {},
    ...partial,
  };
}

function withUpgrades(levels: Record<string, number> = {}): GameState {
  const state = createInitialState(config, 1);
  state.levels = levels;
  return state;
}

describe('цены', () => {
  it('растут геометрически: baseCost · 1.15^level', () => {
    const def = makeUpgrade({ baseCost: 100 });
    expect(costFor(config, def, 0)).toBe(100);
    expect(costFor(config, def, 1)).toBe(115);
    expect(costFor(config, def, 2)).toBe(132);
    expect(costFor(config, def, 10)).toBe(Math.round(100 * Math.pow(1.15, 10)));
  });

  it('бесплатные покупки всегда стоят 0', () => {
    const def = makeUpgrade({ baseCost: 0, type: 'oneShot' });
    expect(costFor(config, def, 5)).toBe(0);
  });

  it('сумма уровней считается по каждому шагу', () => {
    const def = makeUpgrade({ baseCost: 100 });
    const expected = costFor(config, def, 2) + costFor(config, def, 3) + costFor(config, def, 4);
    expect(totalCostFor(config, def, 2, 3)).toBe(expected);
  });

  it('affordableLevels не превышает ни баланс, ни maxLevel, ни лимит за раз', () => {
    const def = makeUpgrade({ baseCost: 100, maxLevel: 100 });
    expect(affordableLevels(config, def, 0, 0)).toBe(0);
    expect(affordableLevels(config, def, 0, 100)).toBe(1);
    expect(affordableLevels(config, def, 0, 1000)).toBeGreaterThan(1);
    expect(affordableLevels(config, def, 0, Infinity)).toBe(config.maxBuyLevels);
    expect(affordableLevels(config, def, 100, Infinity)).toBe(0);
  });
});

describe('разблокировка покупок', () => {
  it('учитывает накопленный заработок', () => {
    const def = makeUpgrade({ unlockAt: { balance: 1000 } });
    const state = withUpgrades();
    state.totalEarned = 999;
    expect(isUnlocked(def, state)).toBe(false);
    expect(unlockBlocker(def, state)).toEqual({ kind: 'balance', value: 1000 });
    state.totalEarned = 1000;
    expect(isUnlocked(def, state)).toBe(true);
    expect(unlockBlocker(def, state)).toBeNull();
  });

  it('учитывает уровень другой покупки', () => {
    const locked = makeUpgrade({ id: 'b', unlockAt: { upgrade: 'a', level: 3 } });
    const state = withUpgrades({ a: 2 });
    expect(isUnlocked(locked, state)).toBe(false);
    expect(unlockBlocker(locked, state)).toEqual({ kind: 'upgrade', id: 'a', level: 3 });
    state.levels.a = 3;
    expect(isUnlocked(locked, state)).toBe(true);
  });
});

describe('производные показатели', () => {
  it('без покупок тап равен базовому значению', () => {
    const d = computeDerived(config, content.upgrades, withUpgrades());
    expect(d.tapValue).toBeCloseTo(config.baseTapValue, 6);
    expect(d.grossPerSecond).toBe(0);
    expect(d.netPerSecond).toBe(0);
  });

  it('perTap складывается линейно и умножается на множители', () => {
    const tap = makeUpgrade({ id: 'tap', type: 'perTap', effect: { value: 5 } });
    const mult = makeUpgrade({ id: 'mult', type: 'multiplier', effect: { factor: 2 } });
    const d = computeDerived(config, [tap, mult], withUpgrades({ tap: 3, mult: 2 }));
    // (1 + 5*3) * 2^2
    expect(d.tapValue).toBeCloseTo((config.baseTapValue + 15) * 4, 4);
  });

  it('passive складывается и умножается на множители пассива', () => {
    const passive = makeUpgrade({ id: 'p', type: 'passive', effect: { value: 10 } });
    const mult = makeUpgrade({ id: 'm', type: 'multiplier', effect: { factor: 1.5, scope: 'passive' } });
    const d = computeDerived(config, [passive, mult], withUpgrades({ p: 2, m: 2 }));
    expect(d.grossPerSecond).toBeCloseTo(20 * Math.pow(1.5, 2), 4);
  });

  it('множитель с scope=tap не влияет на пассив', () => {
    const passive = makeUpgrade({ id: 'p', type: 'passive', effect: { value: 10 } });
    const mult = makeUpgrade({ id: 'm', type: 'multiplier', effect: { factor: 3, scope: 'tap' } });
    const d = computeDerived(config, [passive, mult], withUpgrades({ p: 1, m: 1 }));
    expect(d.grossPerSecond).toBeCloseTo(10, 4);
    expect(d.tapValue).toBeCloseTo(config.baseTapValue * 3, 4);
  });

  it('налог не опускается ниже минимума и не растёт выше 100%', () => {
    const cut = makeUpgrade({ id: 'cut', type: 'taxCut', effect: { percent: 30 } });
    const d = computeDerived(config, [cut], withUpgrades({ cut: 5 }));
    expect(d.taxRate).toBeCloseTo(config.tax.minRate, 6);

    const add = makeUpgrade({ id: 'add', type: 'passive', effect: { value: 1, taxAdd: 0.5 } });
    const d2 = computeDerived(config, [add], withUpgrades({ add: 5 }));
    expect(d2.taxRate).toBeLessThanOrEqual(1);
    expect(d2.taxRate).toBeGreaterThan(config.tax.baseRate);
  });

  it('цена победы берётся из winCost конфига', () => {
    expect(winCostOf(config, content.upgrades)).toBe(config.winCost);
  });

  it('чистый доход не уходит в минус даже при огромных расходах', () => {
    const bad = makeUpgrade({ id: 'bad', type: 'passive', effect: { value: 1, salaryAdd: 500 } });
    const d = computeDerived(config, [bad], withUpgrades({ bad: 10 }));
    expect(d.netPerSecond).toBeGreaterThanOrEqual(0);
    expect(netForInterval(d, 1)).toBeGreaterThanOrEqual(0);
  });

  it('налоговые буффы работают и истекают по времени', () => {
    const d = computeDerived(config, [], withUpgrades(), [
      { id: 'buff', amount: 0.2, untilMs: 5000 },
    ]);
    expect(d.taxRate).toBeCloseTo(Math.max(config.tax.minRate, config.tax.baseRate - 0.2), 6);
  });

  it('роскошь попадает в витрину и не даёт дохода', () => {
    const yacht = makeUpgrade({ id: 'y', type: 'luxury', effect: {} });
    const d = computeDerived(config, [yacht], withUpgrades({ y: 1 }));
    expect(d.luxuries).toContain('y');
    expect(d.grossPerSecond).toBe(0);
    expect(d.tapValue).toBeCloseTo(config.baseTapValue, 6);
  });
});

describe('условия победы', () => {
  it('требует денег и ключевых улучшений', () => {
    const state = withUpgrades();
    state.coins = config.winCost;
    expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(false);

    for (const req of config.winRequirements) {
      if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
    }
    expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(true);
    state.coins = config.winCost - 1;
    expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(false);
  });
});

describe('выплаты событий', () => {
  const derived = computeDerived(
    config,
    content.upgrades,
    withUpgrades({ t_well: 10 }),
  );

  it('растут вместе с империей', () => {
    const def = content.byId.get('p_monarch') as UpgradeDef;
    const small = eventPayout(def, { ...derived, tapValue: 1, grossPerSecond: 0 }, 1, 0);
    const big = eventPayout(def, { ...derived, tapValue: 100, grossPerSecond: 0 }, 1, 0);
    expect(big).toBeGreaterThan(small);
  });

  it('платный розыгрыш возвращает множитель от цены', () => {
    const def = content.byId.get('p_crisis') as UpgradeDef;
    const payout = eventPayout(def, derived, 1, 1000);
    expect(payout).toBe(1000 * (def.effect.factor ?? 1));
  });

  it('экспорт зависит от мировой цены и терминала', () => {
    const def = content.byId.get('p_export') as UpgradeDef;
    const cheap = exportPayout(def, { ...derived, exportMultiplier: 1 }, 0.7);
    const dear = exportPayout(def, { ...derived, exportMultiplier: 1 }, 1.3);
    const withTerminal = exportPayout(def, { ...derived, exportMultiplier: 2 }, 1.3);
    expect(dear).toBeGreaterThan(cheap);
    expect(withTerminal).toBeCloseTo(dear * 2, -1);
  });
});

describe('устойчивость формул', () => {
  it('не выдают NaN при пустом конфиге эффектов', () => {
    const weird: GameConfig = { ...config };
    const defs: UpgradeDef[] = [
      makeUpgrade({ id: 'a', type: 'multiplier', effect: {} }),
      makeUpgrade({ id: 'b', type: 'passive', effect: {} }),
    ];
    const d = computeDerived(weird, defs, withUpgrades({ a: 1, b: 1 }));
    expect(Number.isFinite(d.tapValue)).toBe(true);
    expect(Number.isFinite(d.netPerSecond)).toBe(true);
    expect(Number.isFinite(d.taxRate)).toBe(true);
  });
});
