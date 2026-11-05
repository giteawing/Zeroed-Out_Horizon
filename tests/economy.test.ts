import { describe, expect, it } from 'vitest';
import {
  affordableLevels,
  computeDerived,
  costFor,
  eventPayout,
  exportTonnes,
  isUnlocked,
  isWinReady,
  netForInterval,
  saleProceeds,
  sellOil,
  taxRateOf,
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
  it('без покупок тап добывает базовые тонны, а денег ещё нет', () => {
    const d = computeDerived(config, content.upgrades, withUpgrades());
    // Тап добывает НЕФТЬ; базовое значение тапа — это tonnы из config.oil.
    expect(d.tapValue).toBeCloseTo(config.oil.tapTonnes, 6);
    // Контракты доступны с самого начала: сбыт есть, но нефти ещё нет,
    // поэтому «теоретический» доход без добычи нулевой.
    expect(d.oilPerSecond).toBe(0);
    expect(d.netPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('perTap складывается линейно и умножается на множители (с затуханием)', () => {
    const tap = makeUpgrade({ id: 'tap', type: 'perTap', effect: { value: 5 } });
    const mult = makeUpgrade({ id: 'mult', type: 'multiplier', effect: { factor: 2 } });
    const d = computeDerived(config, [tap, mult], withUpgrades({ tap: 3, mult: 2 }));
    // (oil.tapTonnes + 5*3) * 2^√2 — отдача множителей затухает,
    // иначе к концу игры цены и доходы «взрываются».
    expect(d.tapValue).toBeCloseTo((config.oil.tapTonnes + 15) * Math.pow(2, Math.SQRT2), 4);
  });

  it('скважины дают добычу, множитель пассива её усиливает', () => {
    const mult = makeUpgrade({ id: 'm', type: 'multiplier', effect: { factor: 1.5, scope: 'passive' } });
    const state = withUpgrades({ m: 2 });
    // Две скважины: обычная на 10 т/сут и хорошая на 60 т/сут.
    state.wells = [
      { kind: 'ordinary', dailyTonnes: 10 },
      { kind: 'good', dailyTonnes: 60 },
    ];
    const d = computeDerived(config, [mult], state);
    // 70 т/сут / секунд в сутках, дальше — множители пассива.
    const base = 70 / config.oil.wells.secondsPerDay;
    expect(d.oilPerSecond).toBeCloseTo(base * Math.pow(1.5, Math.SQRT2), 6);
  });

  it('множитель с scope=tap не влияет на добычу скважин', () => {
    const mult = makeUpgrade({ id: 'm', type: 'multiplier', effect: { factor: 3, scope: 'tap' } });
    const state = withUpgrades({ m: 1 });
    state.wells = [{ kind: 'ordinary', dailyTonnes: 10 }];
    const d = computeDerived(config, [mult], state);
    expect(d.oilPerSecond).toBeCloseTo(10 / config.oil.wells.secondsPerDay, 6);
    expect(d.tapValue).toBeCloseTo(config.oil.tapTonnes * 3, 4);
  });

  it('налог снижается влиянием и не опускается ниже минимума', () => {
    // Без влияния — базовая ставка.
    expect(taxRateOf(config, 0)).toBeCloseTo(config.tax.baseRate, 6);
    // С ростом влияния ставка только падает.
    const low = taxRateOf(config, 100);
    const high = taxRateOf(config, 300);
    expect(low).toBeLessThan(config.tax.baseRate);
    expect(high).toBeLessThan(low);
    // Даже при огромном влиянии ниже минимума не уходит.
    expect(taxRateOf(config, 10000)).toBeCloseTo(config.tax.minRate, 6);
  });

  it('дружба с чиновниками снижает налог, но не отменяет его совсем', () => {
    const cut = makeUpgrade({ id: 'cut', type: 'taxCut', effect: { percent: 3 } });
    const state = withUpgrades({ cut: 2 });
    const d = computeDerived(config, [cut], state);
    // 2 уровня × 3 п.п. = 6 п.п. ниже базовой ставки.
    expect(d.taxRate).toBeCloseTo(config.tax.baseRate - 0.06, 6);
    expect(d.taxRate).toBeGreaterThanOrEqual(config.tax.minRate);
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

  it('налог не «прыгает»: временные буффы больше не меняют ставку', () => {
    const plain = computeDerived(config, [], withUpgrades());
    const buffed = computeDerived(config, [], withUpgrades(), [
      { id: 'buff', amount: 0.2, untilMs: 5000 },
    ]);
    // Ставка зависит только от влияния и чиновников, поэтому совпадает.
    expect(buffed.taxRate).toBeCloseTo(plain.taxRate, 9);
  });

  it('роскошь попадает в витрину и не даёт дохода', () => {
    const yacht = makeUpgrade({ id: 'y', type: 'luxury', effect: {} });
    const d = computeDerived(config, [yacht], withUpgrades({ y: 1 }));
    expect(d.luxuries).toContain('y');
    expect(d.tapValue).toBeCloseTo(config.oil.tapTonnes, 6);
  });
});

describe('условия победы', () => {
  it('требует денег и ключевых улучшений', () => {
    const state = withUpgrades();
    state.coins = config.winCost;
    const requirements = config.winRequirements;
    if (requirements.length === 0) {
      // Требований нет — достаточно денег.
      expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(true);
    } else {
      expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(false);
      for (const req of requirements) {
        if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
      }
      expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(true);
    }
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
    const small = eventPayout(def, { ...derived, grossPerSecond: 1, oilPerSecond: 0 }, 1, 0);
    const big = eventPayout(def, { ...derived, grossPerSecond: 1000, oilPerSecond: 0 }, 1, 0);
    expect(big).toBeGreaterThan(small);
  });

  it('платный розыгрыш возвращает множитель от цены', () => {
    const def = content.byId.get('p_crisis') as UpgradeDef;
    const payout = eventPayout(def, derived, 1, 1000);
    expect(payout).toBe(1000 * (def.effect.factor ?? 1));
  });

  it('экспорт продаёт нефть со склада по цене канала', () => {
    const def = content.byId.get('p_export') as UpgradeDef;
    const cheap = { ...derived, channels: { ...derived.channels, export: { ...derived.channels.export, price: 10 } } };
    const dear = { ...derived, channels: { ...derived.channels, export: { ...derived.channels.export, price: 20 } } };
    const tonnes = 100;
    expect(saleProceeds(def, dear, tonnes)).toBeGreaterThan(saleProceeds(def, cheap, tonnes));
    // Разовая акция не может продать больше, чем лежит в резервуарах.
    expect(exportTonnes(config, derived, 5)).toBeLessThanOrEqual(5);
  });

  it('каналы делят нефть по приоритету «дорогой сначала»', () => {
    const custom = {
      ...derived,
      channels: {
        contract: { rate: 1, price: 1, sold: 1 },
        export: { rate: 1, price: 10, sold: 1 },
        refine: { rate: 1, price: 100, sold: 1 },
      },
    };
    const sold = sellOil(custom, 3, 10, []);
    // Вся нефть ушла через самый дорогой канал.
    expect(sold.byChannel.refine).toBeCloseTo(3, 6);
    expect(sold.gross).toBeCloseTo(300, 6);
    expect(sold.oil).toBeCloseTo(0, 6);
  });

  it('безлимитные контракты продают всё, что осталось', () => {
    const custom = {
      ...derived,
      channels: {
        contract: { rate: 0, price: 1, sold: 0 },
        export: { rate: 0, price: 10, sold: 0 },
        refine: { rate: 0, price: 100, sold: 0 },
      },
    };
    const sold = sellOil(custom, 50, 1, ['contract']);
    expect(sold.oil).toBeCloseTo(0, 6);
    expect(sold.byChannel.contract).toBeCloseTo(50, 6);
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
