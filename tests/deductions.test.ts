/**
 * Налоговые вычеты и необлагаемые поступления (пункты 5–6 плана доработок).
 *
 * Демпфер, вывоз капитала, обратный акциз и вычеты НДПИ не входят в EBT:
 * налог на прибыль их не трогает, расходы тоже. В панели они стоят ниже
 * налога и прибавляются к чистой прибыли.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { computeDerived } from '../src/core/economy';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';
import type { GameState, UpgradeDef } from '../src/core/types';

const content = loadContent();
const { config } = content;

/** Покупка-пустышка: нужна только для проверки влияния в изоляции. */
function influenceCard(influence: number): UpgradeDef {
  return {
    id: 'test_influence',
    tab: 'political',
    group: 'favors',
    name: 'Тест: влияние',
    description: 'Проверочная покупка, в игре её нет.',
    icon: 'gov',
    type: 'passive',
    baseCost: 1,
    maxLevel: 1,
    effect: { influence },
  };
}

function derivedWith(
  state: GameState,
  levels: Record<string, number> = {},
  extra: UpgradeDef[] = [],
  coins = 0,
) {
  state.levels = { ...state.levels, ...levels };
  state.coins = coins;
  return computeDerived(config, [...content.upgrades, ...extra], state, [], content);
}

/** НПЗ и рынок нефтепродуктов внутри страны: без них обратного акциза нет. */
function refineryState(): GameState {
  const state = createInitialState(config, 7);
  state.wells = [{ kind: 'unique', dailyTonnes: 500 }];
  state.levels = { t_refinery: 1, t_productdom: 1 };
  return state;
}

describe('обратный акциз на нефтяное сырьё (для НПЗ)', () => {
  it('без НПЗ вычета нет, даже если топливо продаётся внутри', () => {
    const state = createInitialState(config, 8);
    state.wells = [{ kind: 'unique', dailyTonnes: 500 }];
    state.levels = { t_productdom: 1 };
    const derived = derivedWith(state);
    expect(derived.assetCounts.refinery).toBe(0);
    expect(derived.reverseExciseIncomePerSecond).toBe(0);
  });

  it('с НПЗ вычет равен доле выручки внутренних продаж и растёт с влиянием', () => {
    const base = derivedWith(refineryState());
    const rule = config.deductions.reverseExcise;
    expect(base.flows.productsDomestic).toBeGreaterThan(0);
    const revenue = base.flows.productsDomestic * base.productPriceDomestic;
    const share = base.influence / Math.max(1, config.influence.cap);
    expect(base.reverseExciseIncomePerSecond).toBeCloseTo(
      revenue * rule.domesticShare * (1 + rule.influenceGain * share),
      6,
    );
    expect(base.reverseExciseIncomePerSecond).toBeGreaterThan(0);

    const maxed = derivedWith(
      refineryState(),
      { test_influence: 1 },
      [influenceCard(config.influence.cap)],
    );
    expect(maxed.reverseExciseIncomePerSecond).toBeGreaterThan(
      base.reverseExciseIncomePerSecond,
    );
    expect(maxed.reverseExciseIncomePerSecond).toBeCloseTo(
      maxed.flows.productsDomestic * maxed.productPriceDomestic *
        rule.domesticShare * (1 + rule.influenceGain),
      6,
    );
  });

  it('вычет зависит от проданных внутри тонн: нулевая квота обнуляет его', () => {
    const state = refineryState();
    state.flowControl.productDomestic = { mode: 'fixed', value: 0 };
    state.flowControl.productExport = { mode: 'fixed', value: 0 };
    const derived = derivedWith(state);
    expect(derived.flows.productsDomestic).toBe(0);
    expect(derived.reverseExciseIncomePerSecond).toBe(0);
  });
});

describe('вычеты по НДПИ для сложных и истощённых месторождений', () => {
  it('считаются только по скважинам с текущим дебитом ниже порога', () => {
    const state = createInitialState(config, 9);
    const threshold = config.deductions.ndpi.dailyTonnesThreshold;
    state.wells = [
      { kind: 'ordinary', dailyTonnes: threshold - 1 },
      { kind: 'ordinary', dailyTonnes: threshold },
      { kind: 'good', dailyTonnes: 60 },
    ];
    const derived = derivedWith(state);
    expect(derived.lowRateWellCount).toBe(1);
    expect(derived.ndpiDeductionIncomePerSecond).toBeCloseTo(
      config.deductions.ndpi.perWellPerSecond,
      9,
    );
  });

  it('растут с влиянием до надбавки из конфига', () => {
    const state = createInitialState(config, 10);
    state.wells = [
      { kind: 'ordinary', dailyTonnes: 8 },
      { kind: 'ordinary', dailyTonnes: 9 },
    ];
    const rule = config.deductions.ndpi;
    const base = derivedWith(state);
    expect(base.lowRateWellCount).toBe(2);
    expect(base.ndpiDeductionIncomePerSecond).toBeCloseTo(
      2 * rule.perWellPerSecond, 9,
    );

    const maxed = derivedWith(
      structuredClone(state),
      { test_influence: 1 },
      [influenceCard(config.influence.cap)],
    );
    expect(maxed.ndpiDeductionIncomePerSecond).toBeCloseTo(
      2 * rule.perWellPerSecond * (1 + rule.influenceGain), 9,
    );
  });

  it('нет истощённых скважин — нет вычета', () => {
    const state = createInitialState(config, 11);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    const derived = derivedWith(state);
    expect(derived.lowRateWellCount).toBe(0);
    expect(derived.ndpiDeductionIncomePerSecond).toBe(0);
  });
});

describe('необлагаемые поступления в кассе', () => {
  it('демпфер, вывоз и вычеты не входят в EBT, но входят в чистую прибыль', () => {
    const state = createInitialState(config, 12);
    state.wells = [{ kind: 'ordinary', dailyTonnes: 8 }];
    state.levels = { p_fuel_damper: 1, g_capital_flight: 1 };
    state.capitalFlightStartedAtMs = 0;
    const derived = derivedWith(state);
    expect(derived.damperIncomePerSecond).toBeGreaterThanOrEqual(0);
    expect(derived.capitalFlightIncomePerSecond).toBeGreaterThan(0);
    expect(derived.untaxedIncomePerSecond).toBeCloseTo(
      derived.damperIncomePerSecond +
        derived.capitalFlightIncomePerSecond +
        derived.reverseExciseIncomePerSecond +
        derived.ndpiDeductionIncomePerSecond,
      9,
    );
    // EBT считается без необлагаемых поступлений, налог — с EBT.
    expect(derived.ebtPerSecond).toBeCloseTo(
      derived.grossPerSecond - derived.expensesPerSecond,
      6,
    );
    expect(derived.taxPaidPerSecond).toBeCloseTo(derived.ebtPerSecond * derived.taxRate, 6);
    expect(derived.netPerSecond).toBeCloseTo(
      derived.ebtPerSecond - derived.taxPaidPerSecond + derived.untaxedIncomePerSecond,
      6,
    );
    expect(derived.profitPerSecond).toBe(derived.netPerSecond);
  });

  it('вычет НДПИ начисляется на счёт до первой продажи и налогом не уменьшается', () => {
    const state = createInitialState(config, 13);
    state.wells = [{ kind: 'ordinary', dailyTonnes: 8 }];
    const game = new Game(content, state);
    const expected = game.derived().ndpiDeductionIncomePerSecond;
    expect(expected).toBeGreaterThan(0);
    game.update(1000);
    // Партия ещё не уехала: единственное поступление — необлагаемый вычет.
    expect(state.coins).toBeCloseTo(expected, 6);
    expect(state.totalEarned).toBeGreaterThanOrEqual(expected - 1e-9);
  });
});
