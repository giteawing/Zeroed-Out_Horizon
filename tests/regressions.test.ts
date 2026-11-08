import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { Game } from '../src/core/game';
import {
  assetsValueOf,
  computeDerived,
  totalCostFor,
  worldPriceAt,
  wellPricePerDailyTonne,
} from '../src/core/economy';
import { createInitialState, normalizeState } from '../src/core/state';
import { decide, estimatedGain } from '../src/core/simulator';
import type { Content, GameEvent } from '../src/core/types';

const original = loadContent();
function freshContent(): Content {
  return structuredClone(original);
}

function rich(content: Content, amount = 1e15) {
  const state = createInitialState(content.config, 12345);
  state.coins = amount;
  state.totalEarned = amount;
  return state;
}

function freezeWorldPrice(content: Content): void {
  content.config.worldPrice.min = 1;
  content.config.worldPrice.max = 1;
  content.config.worldPrice.startPrice = 1;
}

describe('регрессии пакетной покупки', () => {
  it('при count=5 и одном оставшемся уровне списывает и выдаёт только один', () => {
    const content = freshContent();
    const state = rich(content);
    const game = new Game(content, state);
    const before = state.coins;
    const check = game.checkBuy('l_boat', 5);
    expect(check.count).toBe(1);
    const result = game.buy('l_boat', 5);
    expect(result.ok).toBe(true);
    expect(result.level).toBe(1);
    expect(result.cost).toBe(check.cost);
    expect(before - state.coins).toBe(check.cost);
    expect(game.buy('l_boat', 5).reason).toBe('maxLevel');

    const restored = normalizeState(
      JSON.parse(JSON.stringify(game.snapshot())), content.config, content,
    );
    expect(restored.levels.l_boat).toBe(1);
  });

  it('ограничивает пакет остатком до maxLevel и не теряет уровни после сохранения', () => {
    const content = freshContent();
    const state = rich(content);
    state.levels.t_well = 43;
    const game = new Game(content, state);
    const wellsBefore = state.wells.length;
    const check = game.checkBuy('t_well', 5);
    expect(check.count).toBe(2);
    const before = state.coins;
    const result = game.buy('t_well', 5);
    expect(result.ok).toBe(true);
    expect(result.level).toBe(45);
    expect(result.cost).toBe(check.cost);
    expect(before - state.coins).toBe(check.cost);
    expect(state.wells.length).toBe(wellsBefore + 2);
    expect(game.checkBuy('t_well', 5).reason).toBe('maxLevel');

    const restored = normalizeState(
      JSON.parse(JSON.stringify(game.snapshot())), content.config, content,
    );
    expect(restored.levels.t_well).toBe(45);
    expect(restored.wells).toHaveLength(2);
  });

  it('affordable и фактическое списание учитывают одну и ту же conquest-скидку', () => {
    const content = freshContent();
    const state = rich(content);
    state.levels = {
      p_gov: 10,
      p_parliament: 10,
      pmc_vet: 1,
      pmc_chvk: 1,
      pmc_airbase: 1,
    };
    const game = new Game(content, state);
    const def = content.byId.get('p_refinery')!;
    const check = game.checkBuy(def.id, 3);
    expect(check.unlocked).toBe(true);
    expect(check.count).toBe(3);
    expect(check.affordable).toBeGreaterThanOrEqual(3);
    expect(check.cost).toBeLessThan(totalCostFor(content.config, def, 0, 3));
    const before = state.coins;
    const result = game.buy(def.id, 3);
    expect(result.ok).toBe(true);
    expect(result.cost).toBe(check.cost);
    expect(before - state.coins).toBe(check.cost);
    expect(state.levels[def.id]).toBe(3);
  });
});

describe('единая финансовая модель продаж', () => {
  it('труба и обычная отгрузка одинакового объёма платят одинаковые налоги и расходы', () => {
    const run = (mode: 'pipeline' | 'rail') => {
      const content = freshContent();
      freezeWorldPrice(content);
      content.config.oil.baseCapacity = 1_000_000;
      content.config.oil.channels.contract.baseRate = 0;
      content.config.oil.channels.contract.unlimited = false;
      content.byId.get('t_pipeline')!.effect.exportMode = mode;
      const state = rich(content, 0);
      state.wells = [{ kind: 'good', dailyTonnes: 1000 }];
      state.levels.t_pipeline = 1;
      const game = new Game(content, state);
      game.update(5000);
      return { state, derived: game.derived() };
    };
    const pipe = run('pipeline');
    const batch = run('rail');
    expect(pipe.derived.hasPipeline).toBe(true);
    expect(batch.derived.hasPipeline).toBe(false);
    expect(pipe.state.totalSold).toBeGreaterThan(0);
    expect(pipe.state.totalSold).toBeCloseTo(batch.state.totalSold, 6);
    expect(pipe.state.coins).toBeGreaterThan(0);
    expect(Math.abs(pipe.state.coins - batch.state.coins) / batch.state.coins).toBeLessThan(0.01);
    expect(pipe.state.expensesAccrued).toBeCloseTo(0, 6);
    expect(batch.state.expensesAccrued).toBeCloseTo(0, 6);
  });

  it('остатки нефтепродуктов используют EBT и налог на прибыль, а не налог с оборота', () => {
    const content = freshContent();
    freezeWorldPrice(content);
    content.config.oil.channels.contract.unlimited = false;
    content.config.oil.channels.contract.baseRate = 1000;
    const state = rich(content, 0);
    state.products = 1;
    const game = new Game(content, state);
    const derived = game.derived();
    const gross = derived.productPriceDomestic;
    const expenses = (derived.salaries + derived.officials) * 0.05;
    const expected = Math.max(0, gross - expenses) * (1 - derived.taxRate);
    game.update(50);
    expect(state.products).toBe(0);
    expect(state.coins).toBeCloseTo(expected, 6);
  });

  it('p_export при отсутствии экспорта использует контрактный fallback', () => {
    const content = freshContent();
    const state = rich(content, 1e9);
    state.oil = 400;
    const game = new Game(content, state);
    const result = game.buy('p_export');
    expect(result.ok).toBe(true);
    const sale = state.log.find((entry) => entry.kind === 'sold')!;
    expect(sale.channel).toBe('contract');
    expect(sale.tonnes).toBeCloseTo(200, 6);
    expect(sale.price).toBeCloseTo(game.derived().channels.contract.price, 6);
    expect(result.payouts[0].amount).toBeCloseTo(
      sale.money! * (1 - game.derived().taxRate), 6,
    );
  });

  it('p_export при наличии экспорта продаёт через него в пределах мощности', () => {
    const content = freshContent();
    const state = rich(content, 1e9);
    state.levels.x_cistern = 1;
    state.oil = 400;
    const game = new Game(content, state);
    expect(game.buy('p_export').ok).toBe(true);
    const sale = state.log.find((entry) => entry.kind === 'sold')!;
    expect(sale.channel).toBe('export');
    expect(sale.tonnes).toBeCloseTo(200, 6);
    expect(sale.price).toBeCloseTo(game.derived().channels.export.price, 6);
  });

  it('p_export различает безлимитный канал и нулевую ограниченную мощность', () => {
    const content = freshContent();
    content.config.oil.channels.export.unlimited = true;
    content.config.oil.channels.export.baseRate = 0;
    const state = rich(content, 1e9);
    state.oil = 400;
    const game = new Game(content, state);
    expect(game.buy('p_export').ok).toBe(true);
    const sale = state.log.find((entry) => entry.kind === 'sold')!;
    expect(sale.channel).toBe('export');
    expect(sale.tonnes).toBeCloseTo(200, 6);
  });

  it('разлитые продукты не увеличивают выручку и чистую прибыль', () => {
    const content = freshContent();
    content.config.oil.channels.contract.unlimited = false;
    content.config.oil.channels.contract.baseRate = 100;
    const derive = (dailyTonnes: number) => {
      const state = createInitialState(content.config, 1);
      state.levels.t_refinery = 1;
      state.wells = [{ kind: 'unique', dailyTonnes }];
      return computeDerived(content.config, content.upgrades, state, [], content);
    };
    const crowded = derive(10_000);
    const moreCrowded = derive(20_000);
    expect(crowded.flows.productsSpill).toBeGreaterThan(0);
    expect(moreCrowded.flows.productsSpill).toBeCloseTo(crowded.flows.productsSpill, 6);
    expect(moreCrowded.grossPerSecond).toBeCloseTo(crowded.grossPerSecond, 6);
    expect(moreCrowded.netPerSecond).toBeCloseTo(crowded.netPerSecond, 6);
    expect(crowded.grossPerSecond).toBeCloseTo(
      crowded.flows.domestic * crowded.domesticPricePerTon +
        crowded.flows.export * crowded.exportPricePerTon +
        crowded.flows.productsDomestic * crowded.productPriceDomestic +
        crowded.flows.productsExport * crowded.productPriceExport,
      6,
    );
  });
});

describe('сырьё, мощности и игровое время', () => {
  it('безлимитные контракты принимают добычу выше 9000 т/с без переполнения', () => {
    const content = freshContent();
    const state = rich(content, 0);
    state.wells = [{ kind: 'unique', dailyTonnes: 20_000 }];
    const game = new Game(content, state);
    game.update(1000);
    expect(content.config.oil.channels.contract.unlimited).toBe(true);
    expect(state.totalSold).toBeGreaterThan(19_000);
    expect(state.oil).toBeLessThanOrEqual(game.derived().oilCapacity);
    expect(state.log.some((entry) => entry.kind === 'spill' && entry.spill === 'crude')).toBe(false);
  });

  it('ручной тап не создаёт время и мощность рынка для срочной отгрузки', () => {
    const content = freshContent();
    content.config.oil.channels.contract.unlimited = false;
    content.config.oil.channels.contract.baseRate = 10;
    const state = rich(content, 0);
    state.oil = 499;
    const game = new Game(content, state);
    game.tap();
    expect(state.shipTimerMs).toBe(0);
    expect(state.totalSold).toBe(0);
    game.update(1000);
    // За реальную секунду рынок получил только свои 0,6 × 10 × 0,05 т
    // на первой срочной отгрузке; пятисекундный рейс ещё не наступил.
    expect(state.shipTimerMs).toBe(950);
    expect(state.totalSold).toBeCloseTo(0.3, 6);
  });

  it('итог за 10 секунд не зависит от update(10000), update(250) и update(100)', () => {
    const run = (stepMs: number) => {
      const content = freshContent();
      freezeWorldPrice(content);
      const state = rich(content, 0);
      state.wells = [{ kind: 'unique', dailyTonnes: 600 }];
      const game = new Game(content, state);
      for (let elapsed = 0; elapsed < 10_000; elapsed += stepMs) game.update(stepMs);
      return state;
    };
    const big = run(10_000);
    const medium = run(250);
    const small = run(100);
    expect(big.totalSold).toBeCloseTo(medium.totalSold, 6);
    expect(big.totalSold).toBeCloseTo(small.totalSold, 6);
    expect(Math.abs(big.oil - medium.oil) / medium.oil).toBeLessThan(0.001);
    expect(Math.abs(big.oil - small.oil) / small.oil).toBeLessThan(0.001);
    expect(Math.abs(big.coins - medium.coins) / medium.coins).toBeLessThan(0.01);
    expect(Math.abs(big.coins - small.coins) / small.coins).toBeLessThan(0.01);
  });

  it('штраф от ручного переполнения не теряется до следующего финансового шага', () => {
    const content = freshContent();
    content.config.oil.channels.contract.unlimited = false;
    content.config.oil.channels.contract.baseRate = 0;
    const state = rich(content, 0);
    state.oil = 499;
    const game = new Game(content, state);
    game.tap();
    expect(state.log.some((entry) => entry.kind === 'spill')).toBe(true);
    expect(state.expensesAccrued).toBeGreaterThan(0);
    const restored = normalizeState(
      JSON.parse(JSON.stringify(game.snapshot())), content.config, content,
    );
    expect(restored.expensesAccrued).toBeGreaterThan(0);
    expect(restored.spillCrudePerSecond).toBeGreaterThan(0);
    expect(state.coins).toBe(0);
  });

  it('загрузка сейва не возвращает трубе уже израсходованную мощность', () => {
    const content = freshContent();
    freezeWorldPrice(content);
    content.config.oil.baseCapacity = 1_000_000;
    content.config.oil.channels.contract.baseRate = 0;
    content.config.oil.channels.contract.unlimited = false;
    const make = () => {
      const state = rich(content, 0);
      state.wells = [{ kind: 'unique', dailyTonnes: 20_000 }];
      state.levels.t_pipeline = 1;
      return { game: new Game(content, state), state };
    };
    const continuous = make();
    const reloaded = make();
    continuous.game.update(1000);
    reloaded.game.update(1000);
    const restored = normalizeState(
      JSON.parse(JSON.stringify(reloaded.game.snapshot())), content.config, content,
    );
    const loadedGame = new Game(content, restored);
    const persistedPipe = restored.pipeSoldSinceShip;
    continuous.game.update(4000);
    loadedGame.update(4000);
    expect(persistedPipe).toBeGreaterThan(0);
    expect(restored.totalSold).toBeCloseTo(continuous.state.totalSold, 6);
    expect(restored.oil).toBeCloseTo(continuous.state.oil, 6);
    expect(restored.coins).toBeCloseTo(continuous.state.coins, 6);
  });

  it('загруженная сырьём труба не уменьшает экспорт нефтепродуктов танкерами', () => {
    const run = (mode: 'pipeline' | 'rail') => {
      const content = freshContent();
      freezeWorldPrice(content);
      content.config.oil.baseCapacity = 1_000_000;
      content.config.oil.channels.contract.baseRate = 0;
      content.config.oil.channels.contract.unlimited = false;
      content.byId.get('t_pipeline')!.effect.exportMode = mode;
      const state = rich(content, 0);
      state.wells = [{ kind: 'unique', dailyTonnes: 50_000 }];
      state.levels = { t_pipeline: 1, t_refinery: 16, t_productport: 1 };
      const game = new Game(content, state);
      const events: GameEvent[] = [];
      game.on((event) => events.push(event));
      game.update(5000);
      const productSpill = events.reduce((sum, event) =>
        event.type === 'spill' && event.kind === 'products' ? sum + event.tonnes : sum, 0);
      return { state, productSpill };
    };
    const pipe = run('pipeline');
    const rail = run('rail');
    expect(pipe.state.totalSold).toBeCloseTo(rail.state.totalSold, 6);
    expect(pipe.productSpill).toBeCloseTo(0, 6);
    expect(rail.productSpill).toBeCloseTo(0, 6);
    expect(pipe.state.products).toBeCloseTo(rail.state.products, 6);
    expect(Math.abs(pipe.state.coins - rail.state.coins) / rail.state.coins).toBeLessThan(0.01);
  });
});

describe('устойчивость времени и состояния движка', () => {
  it('сохранение RNG не меняет фазу мировой цены', () => {
    const content = freshContent();
    const firstState = createInitialState(content.config, 912345);
    const secondState = createInitialState(content.config, 912345);
    const first = new Game(content, firstState);
    const second = new Game(content, secondState);

    first.tap();
    second.tap();
    first.snapshot();
    first.update(2500);
    second.update(2500);

    expect(firstState.rngSeed).not.toBe(firstState.worldPriceSeed);
    expect(firstState.worldPrice).toBeCloseTo(secondState.worldPrice, 12);
  });

  it('пустые окна трубопровода закрываются до следующей партии', () => {
    const content = freshContent();
    freezeWorldPrice(content);
    content.config.oil.baseCapacity = 500;
    content.config.oil.channels.contract.baseRate = 0;
    content.config.oil.channels.contract.unlimited = false;
    content.config.oil.channels.export.baseRate = 0;
    const state = rich(content, 0);
    state.wells = [{ kind: 'unique', dailyTonnes: 16_200 }];
    state.levels.t_pipeline = 1;
    const game = new Game(content, state);

    game.update(60_000);
    expect(state.oil).toBeCloseTo(0, 5);
    expect(state.shipTimerMs).toBeCloseTo(0, 5);
    expect(state.pipeSoldSinceShip).toBeCloseTo(0, 5);

    state.wells = [];
    state.oil = game.derived().oilCapacity;
    game.invalidate();
    const before = state.totalSold;
    game.update(5000);

    expect(state.totalSold).toBeGreaterThan(before);
    expect(state.oil).toBeLessThan(game.derived().oilCapacity);
  });

  it('reset очищает временные накопители и устанавливает новый seed', () => {
    const content = freshContent();
    const oldState = rich(content, 0);
    oldState.wells = [{ kind: 'good', dailyTonnes: 900 }];
    const game = new Game(content, oldState);
    game.update(5000);
    expect(game.revenuePerSecond()).toBeGreaterThan(0);

    const fresh = createInitialState(content.config, 456789);
    game.reset(fresh);
    const reference = new Game(content, createInitialState(content.config, 456789));

    expect(game.state).toBe(fresh);
    expect(game.revenuePerSecond()).toBe(0);
    expect(game.tap()).toBeCloseTo(reference.tap(), 12);
  });

  it('начисление денег сразу обновляет DerivedStats.progress', () => {
    const content = freshContent();
    const state = createInitialState(content.config, 7);
    const game = new Game(content, state);
    const before = game.derived().progress;
    game.applyOffline(1, content.config.winCost / 2);
    expect(game.derived().progress).toBeGreaterThan(before);
  });  it('обновляет мировую цену только на границе целой секунды', () => {
    const content = freshContent();
    const state = createInitialState(content.config, 998877);
    const game = new Game(content, state);
    const initial = state.worldPrice;
    game.update(900);
    expect(state.worldPrice).toBe(initial);
    game.update(100);
    expect(state.worldPrice).toBeCloseTo(
      worldPriceAt(content.config.worldPrice, state.worldPriceSeed, 1000), 12,
    );
    const atOneSecond = state.worldPrice;
    game.update(900);
    expect(state.worldPrice).toBe(atOneSecond);
  });

  it('топливный демпфер платит только разницу цен нефтепродуктов по внутренним продажам', () => {
    const content = freshContent();
    const state = rich(content, 0);
    state.wells = [{ kind: 'good', dailyTonnes: 100 }];
    state.levels.t_refinery = 1;
    state.levels.p_fuel_damper = 1;
    const game = new Game(content, state);
    const derived = game.derived();
    const expected = Math.max(0, derived.productPriceExport - derived.productPriceDomestic) * derived.flows.productsDomestic;
    expect(derived.flows.productsDomestic).toBeGreaterThan(0);
    expect(derived.damperIncomePerSecond).toBeCloseTo(expected, 8);
    expect(derived.grossPerSecond).toBeCloseTo(
      derived.flows.domestic * derived.domesticPricePerTon +
        derived.flows.export * derived.exportPricePerTon +
        derived.flows.productsDomestic * derived.productPriceDomestic +
        derived.flows.productsExport * derived.productPriceExport + expected + derived.investmentIncomePerSecond,
      6,
    );
  });

  it('инвестиционный доход начисляется на текущий остаток счёта', () => {
    const content = freshContent();
    const state = rich(content, 100_000);
    const game = new Game(content, state);
    const before = state.coins;
    const derived = game.derived();
    expect(derived.investmentRatePercent).toBeGreaterThanOrEqual(1);
    expect(derived.investmentRatePercent).toBeLessThanOrEqual(20);
    expect(derived.investmentIncomePerSecond).toBeGreaterThan(0);
    game.update(1000);
    expect(state.coins).toBeGreaterThan(before);
  });

  it('вывоз капитала стартует с 5 млрд/с, растёт на 1% в минуту и не добавляет расходов', () => {
    const content = freshContent();
    const state = rich(content, 1e12);
    const game = new Game(content, state);
    const beforeExpenses = game.derived().expensesPerSecond;
    const result = game.buy('g_capital_flight');
    expect(result.ok).toBe(true);
    expect(state.capitalFlightStartedAtMs).toBe(0);
    const started = game.derived();
    expect(started.capitalFlightIncomePerSecond).toBe(5e9);
    expect(started.expensesPerSecond).toBeCloseTo(beforeExpenses, 9);
    game.update(60_000);
    const afterMinute = game.derived();
    expect(afterMinute.capitalFlightIncomePerSecond).toBeCloseTo(5.05e9, 2);
    expect(afterMinute.expensesPerSecond).toBeCloseTo(beforeExpenses, 9);
    // Триллион был потрачен при покупке; важно, что после неё касса начала пополняться.
    expect(state.coins).toBeGreaterThan(0);
  });

  it('суммирует ёмкости хранилищ и пропускную способность по внутреннему и экспортным направлениям', () => {
    const content = freshContent();
    const state = rich(content, 0);
    state.levels = { t_depot: 2, t_pipeline: 1, t_rail: 1, t_terminal: 1, t_refinery: 1 };
    const game = new Game(content, state);
    const derived = game.derived();
    expect(derived.totalStorageCapacity).toBeCloseTo(derived.oilCapacity + derived.productCapacity, 9);
    expect(derived.domesticThroughputCapacity).toBeGreaterThan(0);
    expect(derived.exportThroughputCapacity).toBeCloseTo(
      derived.exportCapacityByMode.pipeline + derived.exportCapacityByMode.rail + derived.exportCapacityByMode.tanker, 9,
    );
    expect(derived.refineryThroughputCapacity).toBeGreaterThan(0);
    expect(derived.exportCapacityByMode.pipeline).toBeGreaterThan(0);
    expect(derived.exportCapacityByMode.rail).toBeGreaterThan(0);
    expect(derived.exportCapacityByMode.tanker).toBeGreaterThan(0);
  });

});

describe('победа, события и единая оценка активов', () => {
  it('после победы playtime и wonAtMs заморожены для обеих побед', () => {
    const content = freshContent();
    const state = rich(content, content.config.winCost);
    for (const req of content.config.winRequirements) {
      if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
    }
    state.playtimeMs = 5000;
    state.clockMs = 9000;
    const game = new Game(content, state);
    expect(game.buy('win_pump').ok).toBe(true);
    expect(state.wonAtMs).toBe(5000);
    game.update(60_000);
    expect(state.playtimeMs).toBe(5000);
    expect(state.wonAtMs).toBe(5000);

    const forcedState = rich(content);
    forcedState.playtimeMs = 7000;
    forcedState.clockMs = 9000;
    const forced = new Game(content, forcedState);
    expect(forced.forceWin()).toBe(true);
    forced.update(60_000);
    expect(forcedState.wonAtMs).toBe(7000);
    expect(forcedState.playtimeMs).toBe(7000);
  });

  it('25 одновременных гэмбла дают ровно 25 результатов и не теряются', () => {
    const content = freshContent();
    const state = rich(content, 0);
    state.gambles = Array.from({ length: 25 }, () => ({
      id: 'p_crisis', amount: 100, factor: 2, resolveAt: 0,
    }));
    const game = new Game(content, state);
    const events: GameEvent[] = [];
    game.on((event) => events.push(event));
    game.update(50);
    expect(events.filter((event) => event.type === 'gambleResult')).toHaveLength(20);
    expect(state.gambles).toHaveLength(5);
    game.update(50);
    expect(events.filter((event) => event.type === 'gambleResult')).toHaveLength(25);
    expect(state.gambles).toHaveLength(0);
  });

  it('панель активов и реприватизация используют одну цену суточного дебита', () => {
    const content = freshContent();
    const state = createInitialState(content.config, 1);
    state.wells = [{ kind: 'good', dailyTonnes: 100 }];
    const unitValue = wellPricePerDailyTonne(content.config);
    expect(unitValue).toBe(
      content.config.oil.basePricePerTon * content.config.oil.wells.priceSeconds,
    );
    expect(assetsValueOf(content.config, content.upgrades, state)).toBe(100 * unitValue);
  });
});


describe('симулятор использует правила живой игры', () => {
  it('учитывает влияние для p_reprivatize и p_refinery', () => {
    const content = freshContent();
    const ids = [
      'p_reprivatize', 'p_refinery', 'p_gov', 'p_parliament',
      'pmc_vet', 'pmc_chvk', 'pmc_airbase',
    ];
    content.upgrades = content.upgrades.filter((def) => ids.includes(def.id));
    content.byId = new Map(content.upgrades.map((def) => [def.id, def]));
    const state = rich(content);
    state.levels = {
      p_gov: 10,
      p_parliament: 10,
      pmc_vet: 1,
      pmc_chvk: 1,
      pmc_airbase: 1,
    };
    const game = new Game(content, state);
    expect(game.checkBuy('p_reprivatize').unlocked).toBe(true);
    expect(game.checkBuy('p_refinery').unlocked).toBe(true);
    const purchased = new Set<string>();
    decide(game, content, purchased);
    expect(purchased.has('p_reprivatize')).toBe(true);
    expect(purchased.has('p_refinery')).toBe(true);
  });

  it('не применяет tap-множитель к оценке скважин и читает пассивный отдельно', () => {
    const content = freshContent();
    const tapMultiplier = structuredClone(content.byId.get('t_smart')!);
    tapMultiplier.id = 'test_tap_multiplier';
    tapMultiplier.effect = { factor: 2, scope: 'tap' };
    const passiveMultiplier = structuredClone(tapMultiplier);
    passiveMultiplier.id = 'test_passive_multiplier';
    passiveMultiplier.effect = { factor: 2, scope: 'passive' };
    content.upgrades.push(tapMultiplier, passiveMultiplier);
    content.byId.set(tapMultiplier.id, tapMultiplier);
    content.byId.set(passiveMultiplier.id, passiveMultiplier);
    const state = rich(content);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    const game = new Game(content, state);
    const well = content.byId.get('t_well')!;
    const cost = well.baseCost;
    const plain = estimatedGain(game, well, cost);
    state.levels.test_tap_multiplier = 1;
    game.invalidate();
    expect(estimatedGain(game, well, cost)).toBeCloseTo(plain, 5);
    state.levels.test_passive_multiplier = 1;
    game.invalidate();
    expect(estimatedGain(game, well, cost)).toBeGreaterThan(plain);
  });
});
