import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { allocateBatch, oilFlowsOf, totalCostFor } from '../src/core/economy';
import { Game } from '../src/core/game';
import { createInitialState, normalizeState } from '../src/core/state';
import type { FlowControls } from '../src/core/types';

const ids = ['r_depth_vacuum', 'r_depth_visbreaking', 'r_depth_fcc', 'r_depth_coking'];
const content = loadContent();
const AUTO: FlowControls = {
  contract: { mode: 'auto', value: 0 },
  export: { mode: 'auto', value: 0 },
  refine: { mode: 'auto', value: 0 },
  productDomestic: { mode: 'auto', value: 0 },
  productExport: { mode: 'auto', value: 0 },
};

function setup(levels: Record<string, number> = {}, input = 2700) {
  const local = structuredClone(content);
  const state = createInitialState(local.config, 2026);
  state.levels = { ...levels };
  state.wells = [{ kind: 'unique', dailyTonnes: input }];
  state.coins = 1e15;
  state.totalEarned = 1e15;
  // Изолируем переработку от двух направлений продажи сырья.
  state.flowControl.contract = { mode: 'fixed', value: 0 };
  state.flowControl.export = { mode: 'fixed', value: 0 };
  return { local, state, game: new Game(local, state) };
}

describe('глубина переработки отдельных заводов', () => {
  it('база и четыре последовательные модернизации заданы в данных', () => {
    expect(content.config.oil.refineryYield).toBe(0.55);
    const stages = ids.map((id) => content.byId.get(id));
    expect(stages.every(Boolean)).toBe(true);
    expect(stages.map((def) => def!.type)).toEqual(ids.map(() => 'refineryDepth'));
    expect(stages.map((def) => def!.effect.refineryDepth)).toEqual([0.65, 0.68, 0.82, 0.99]);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i]!.unlockAt?.upgrade).toBe(ids[i - 1]);
    }
  });

  it('без НПЗ даже ранее купленное вспомогательное оборудование не производит продукты', () => {
    const { game } = setup({ t_gasplant: 2, t_power: 1, r_alkyl: 2 });
    const derived = game.derived();
    expect(derived.refineries.plantCount).toBe(0);
    expect(derived.capacities.refine).toBe(0);
    expect(derived.flows.refined).toBe(0);
    expect(derived.flows.productsProduced).toBe(0);
  });

  it('суммирует мощности × глубину каждого завода, не завышая глубину остальных', () => {
    const { game } = setup({
      t_refinery: 2, p_refinery: 1,
      [ids[0]!]: 2, [ids[1]!]: 1, [ids[2]!]: 1, [ids[3]!]: 1,
    });
    const d = game.derived();
    expect(d.refineries.plantCount).toBe(3);
    expect(d.refineries.stages.map((stage) => stage.count)).toEqual([2, 1, 1, 1]);
    expect(d.refineries.units.map((unit) => unit.depth)).toEqual([0.99, 0.65, 0.55]);
    expect(d.refineries.averageDepth).toBeCloseTo((0.99 + 0.65 + 0.55) / 3, 10);
    expect(d.flows.refined).toBeCloseTo(2700, 8);
    expect(d.flows.productsProduced).toBeCloseTo(900 * 0.99 + 900 * 0.65 + 900 * 0.55, 8);
  });

  it('значение каждой ступени влияет на фактический выпуск, не только на надпись', () => {
    for (let i = 0; i < ids.length; i++) {
      const levels: Record<string, number> = { t_refinery: 1 };
      for (let stage = 0; stage <= i; stage++) levels[ids[stage]!] = 1;
      const { game, local } = setup(levels, 900);
      const before = game.derived().flows.productsProduced;
      const changed = structuredClone(local);
      const def = changed.byId.get(ids[i]!)!;
      delete def.effect.refineryDepth;
      const newGame = new Game(changed, structuredClone(game.state));
      expect(newGame.derived().flows.productsProduced, ids[i]).toBeLessThan(before);
    }
  });

  it('взвешивает разные мощности заводов по их собственной глубине', () => {
    const { game, local } = setup({ t_refinery: 1, p_refinery: 1, [ids[0]!]: 1 }, 1800);
    // Даже если в контенте появятся заводы разной мощности, умножать общий
    // поток на среднюю по числу заводов глубину будет неверно.
    local.byId.get('t_refinery')!.effect.value = 1200;
    local.byId.get('p_refinery')!.effect.value = 600;
    const d = game.derived();
    expect(d.refineries.units.map((unit) => unit.capacity)).toEqual([1200, 600]);
    expect(d.flows.refined).toBeCloseTo(1800, 8);
    expect(d.flows.productsProduced).toBeCloseTo(1200 * 0.65 + 600 * 0.55, 8);
    expect(d.flows.productsProduced).not.toBeCloseTo(1800 * d.refineries.averageDepth, 3);
  });

  it('при неполной загрузке сначала использует более глубокий завод, а не средний процент', () => {
    const { game } = setup({
      t_refinery: 2, p_refinery: 1,
      [ids[0]!]: 2, [ids[1]!]: 1, [ids[2]!]: 1, [ids[3]!]: 1,
    }, 1500);
    const d = game.derived();
    expect(d.flows.refined).toBeCloseTo(1500, 8);
    expect(d.flows.productsProduced).toBeCloseTo(900 * 0.99 + 600 * 0.65, 8);
    expect(d.flows.productsProduced).not.toBeCloseTo(1500 * d.refineries.averageDepth, 3);
  });

  it('реальная пятисекундная отгрузка продаёт сумму выпуска разных заводов, как и прогноз', () => {
    const { game, state, local } = setup({
      t_refinery: 2, p_refinery: 1,
      [ids[0]!]: 2, [ids[1]!]: 1, [ids[2]!]: 1, [ids[3]!]: 1,
    }, 1500);
    local.config.oil.baseCapacity = 1_000_000;
    local.config.oil.wells.decline.minFactor = 1;
    local.config.worldPrice.min = 1;
    local.config.worldPrice.max = 1;
    state.worldPrice = 1;
    const predicted = game.derived();
    expect(predicted.flows.productsProduced).toBeCloseTo(900 * 0.99 + 600 * 0.65, 8);
    game.update(5000);
    const sale = state.log.find((entry) => entry.kind === 'sold');
    expect(sale).toBeDefined();
    expect(sale!.money).toBeCloseTo(predicted.flows.productsProduced * 5 * predicted.productPriceDomestic, 5);
    expect(state.oil).toBeCloseTo(0, 8);
    expect(state.products).toBeCloseTo(0, 8);
  });

  it('дополнительная мощность распределяется между конкретными НПЗ, не увеличивая глубину', () => {
    const base = setup({ t_refinery: 2, [ids[0]!]: 1 }, 1_000_000).game.derived();
    const boosted = setup({ t_refinery: 2, [ids[0]!]: 1, r_alkyl: 1 }, 1_000_000).game.derived();
    expect(boosted.capacities.refine).toBeGreaterThan(base.capacities.refine);
    expect(boosted.refineries.units.map((unit) => unit.depth)).toEqual([0.65, 0.55]);
    expect(boosted.refineries.units.reduce((sum, unit) => sum + unit.capacity, 0))
      .toBeCloseTo(boosted.capacities.refine, 8);
    expect(boosted.refineries.averageDepth).toBeCloseTo(base.refineries.averageDepth, 10);
  });
});

describe('покупка модернизаций', () => {
  it('не покупает ступень без доступного завода и не обходит цепь даже в режиме разработчика', () => {
    const { game, state } = setup();
    game.unlockAllForDevelopment();
    for (const id of ids) {
      const before = state.coins;
      expect(game.checkBuy(id, 25)).toMatchObject({ ok: false, reason: 'noRefinerySlot', count: 0, affordable: 0 });
      expect(game.buy(id, 25)).toMatchObject({ ok: false, reason: 'noRefinerySlot' });
      expect(state.levels[id] ?? 0).toBe(0);
      expect(state.coins).toBe(before);
    }
  });

  it('пакет ограничен числом заводов и предыдущей ступенью, стоимость считается только за реальные уровни', () => {
    const { game, state, local } = setup({ t_refinery: 2, p_refinery: 1 });
    game.unlockAllForDevelopment();
    expect(game.buy(ids[0]!, 2).ok).toBe(true);
    const second = local.byId.get(ids[1]!)!;
    const check = game.checkBuy(ids[1]!, 25);
    expect(check).toMatchObject({ ok: true, count: 2, affordable: 2 });
    expect(check.cost).toBe(totalCostFor(local.config, second, 0, 2, game.derived().exchangeRate));
    expect(game.buy(ids[1]!, 25)).toMatchObject({ ok: true, level: 2, cost: check.cost });
    expect(game.checkBuy(ids[1]!)).toMatchObject({ ok: false, reason: 'noRefinerySlot', count: 0 });
    expect(game.buy(ids[2]!, 1).ok).toBe(true);
    expect(game.checkBuy(ids[3]!, 25)).toMatchObject({ ok: true, count: 1, affordable: 1 });
    expect(game.buy(ids[3]!, 25).ok).toBe(true);
    expect(ids.map((id) => state.levels[id] ?? 0)).toEqual([2, 2, 1, 1]);
    expect(game.buy(ids[0]!, 25)).toMatchObject({ ok: true, level: 3 });
    expect(game.checkBuy(ids[0]!)).toMatchObject({ ok: false, reason: 'noRefinerySlot' });
    expect(game.buy(ids[1]!, 25)).toMatchObject({ ok: true, level: 3 });
  });

  it('старый сейв читается, а повреждённые уровни приводятся к цепочке по числу заводов', () => {
    const local = structuredClone(content);
    const old = normalizeState({ levels: { t_refinery: 1 } }, local.config, local);
    expect(old.levels.t_refinery).toBe(1);
    for (const id of ids) expect(old.levels[id] ?? 0).toBe(0);
    const broken = normalizeState({
      levels: { t_refinery: 2, [ids[0]!]: 9, [ids[1]!]: 1, [ids[2]!]: 8, [ids[3]!]: 5 },
    }, local.config, local);
    expect(ids.map((id) => broken.levels[id] ?? 0)).toEqual([2, 1, 1, 1]);
  });
});

describe('маршрутизация с разной глубиной', () => {
  const capacities = {
    domestic: { crude: 0, products: 10000 },
    export: { crude: 10000, products: 10000 },
    refine: 2000,
  };
  const refineries = [{ capacity: 1000, depth: 0.99 }, { capacity: 1000, depth: 0.55 }];
  const prices = { crudeDomestic: 0, crudeExport: 1.5, productDomestic: 1, productExport: 2 };

  it('авто сравнивает предельную выгоду каждого завода, прогноз совпадает с партией', () => {
    const options = { refineries, prices, flowControl: AUTO, productStorage: 0, storageHorizonSeconds: 1 };
    const flows = oilFlowsOf(content.config, capacities, 1500, options);
    const batch = allocateBatch(content.config, capacities, 1500, 1, prices, 0, 0, AUTO, refineries);
    for (const plan of [flows, batch]) {
      expect(plan.refined).toBeCloseTo(1000, 8);
      expect(plan.export).toBeCloseTo(500, 8);
      expect(plan.productsExport).toBeCloseTo(990, 8);
    }
    expect(flows.productsProduced).toBeCloseTo(990, 8);
    expect(batch.products).toBeCloseTo(flows.productsProduced, 8);
  });

  it('малый дорогой рынок не захватывает лишнее сырьё, остаток идёт на экспорт', () => {
    const narrow = { ...capacities, export: { ...capacities.export, products: 99 } };
    const flows = oilFlowsOf(content.config, narrow, 500, {
      refineries, prices, flowControl: AUTO, productStorage: 0, storageHorizonSeconds: 1,
    });
    const batch = allocateBatch(content.config, narrow, 500, 1, prices, 0, 0, AUTO, refineries);
    expect(flows.refined).toBeCloseTo(100, 8);
    expect(flows.export).toBeCloseTo(400, 8);
    expect(flows.productsProduced).toBeCloseTo(99, 8);
    expect(batch.refined).toBeCloseTo(flows.refined, 8);
    expect(batch.export).toBeCloseTo(flows.export, 8);
    expect(batch.products).toBeCloseTo(flows.productsProduced, 8);
  });

  it('фиксированный поток тоже ограничен объёмом продуктов и заполняет лучший завод первым', () => {
    const fixed = { ...AUTO, refine: { mode: 'fixed', value: 1500 } } as FlowControls;
    const noExportProducts = { ...capacities, export: { ...capacities.export, products: 0 }, domestic: { crude: 0, products: 1100 } };
    const flows = oilFlowsOf(content.config, noExportProducts, 1500, {
      refineries, prices, flowControl: fixed, productStorage: 0, storageHorizonSeconds: 1,
    });
    const batch = allocateBatch(content.config, noExportProducts, 1500, 1, prices, 0, 0, fixed, refineries);
    expect(flows.refined).toBeCloseTo(1200, 8); // 990 + 110 = 1100 т продуктов
    expect(flows.productsProduced).toBeCloseTo(1100, 8);
    expect(flows.export).toBeCloseTo(300, 8);
    expect(batch.refined).toBeCloseTo(flows.refined, 8);
    expect(batch.products).toBeCloseTo(flows.productsProduced, 8);
  });
});
