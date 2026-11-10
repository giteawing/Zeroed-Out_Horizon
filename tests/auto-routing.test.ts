import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { allocateBatch, oilFlowsOf } from '../src/core/economy';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';
import type { Channel, Content, FlowControls, GameConfig, GameState } from '../src/core/types';

/*
 * REVIEW A3 / AUDIT F01. Режим «Авто» обещает игроку распределить сырьё
 * «по выгодности». Раньше переработка сравнивалась с экспортом по условной
 * цене «экспорт сырья × 2,6»: она по построению выше экспортной, поэтому НПЗ
 * получал нефть первым при любых ценах, даже когда тонна сырья за границей
 * стоила дороже, чем полученные из неё продукты.
 *
 * Выгода тонны сырья на НПЗ — это выход продуктов × цена того рынка, который
 * их реально примет. Тесты ниже сравнивают план «Авто» с лучшей возможной
 * выручкой, посчитанной независимо.
 */

const original = loadContent();
const config: GameConfig = original.config;
const YIELD = config.oil.refineryYield;

interface Prices {
  crudeDomestic: number;
  crudeExport: number;
  productDomestic: number;
  productExport: number;
}

interface Case {
  volume: number;
  exportCrude: number;
  domesticCrude: number;
  refinery: number;
  exportProducts: number;
  domesticProducts: number;
  /** Свободное место на нефтебазах, тонн. */
  storage: number;
  /** Продукты, уже лежащие на нефтебазах, тонн. */
  stock: number;
  prices: Prices;
}

function capacitiesOf(c: Case) {
  return {
    domestic: { crude: c.domesticCrude, products: c.domesticProducts },
    export: { crude: c.exportCrude, products: c.exportProducts },
    refine: c.refinery,
  };
}

/** Прогноз потоков за секунду: окно хранения в одну секунду, чтобы тонны совпали с т/с. */
function forecast(c: Case, flowControl?: FlowControls) {
  return oilFlowsOf(config, capacitiesOf(c), c.volume, {
    prices: c.prices,
    productStorage: c.storage + c.stock,
    productStorageFree: c.storage,
    productInventory: c.stock,
    storageHorizonSeconds: 1,
    flowControl,
  });
}

function batch(c: Case, flowControl?: FlowControls) {
  return allocateBatch(
    config, capacitiesOf(c), c.volume, 1, c.prices, c.storage, c.stock, flowControl,
  );
}

/** Два рынка, более дорогой получает объём первым. Возвращает выручку. */
function sellToTwo(
  volume: number,
  first: { price: number; room: number },
  second: { price: number; room: number },
): number {
  const [high, low] = first.price >= second.price ? [first, second] : [second, first];
  const toHigh = Math.min(volume, high.room);
  const toLow = Math.min(volume - toHigh, low.room);
  return toHigh * high.price + toLow * low.price;
}

/** Сколько продуктов рынки примут сверх складского запаса: запас продаётся первым. */
function productRoomsOf(c: Case): { export: number; domestic: number } {
  const exportFirst = c.prices.productExport >= c.prices.productDomestic;
  const first = exportFirst ? c.exportProducts : c.domesticProducts;
  const second = exportFirst ? c.domesticProducts : c.exportProducts;
  const toFirst = Math.min(c.stock, first);
  const toSecond = Math.min(c.stock - toFirst, second);
  return exportFirst
    ? { export: first - toFirst, domestic: second - toSecond }
    : { export: second - toSecond, domestic: first - toFirst };
}

/**
 * Лучшая выручка окна, посчитанная без распределителя.
 *
 * Выручка как функция объёма переработки вогнута и кусочно-линейна, поэтому
 * максимум лежит в одной из точек излома: там, где заполняется рынок
 * продуктов или рынок сырья. Перебираем все такие точки.
 */
function bestRevenue(c: Case): number {
  const rooms = productRoomsOf(c);
  const refineLimit = Math.min(
    c.volume,
    c.refinery,
    (rooms.export + rooms.domestic + c.storage) / YIELD,
  );
  const revenueAt = (refined: number): number =>
    sellToTwo(
      refined * YIELD,
      { price: c.prices.productExport, room: rooms.export },
      { price: c.prices.productDomestic, room: rooms.domestic },
    ) +
    sellToTwo(
      c.volume - refined,
      { price: c.prices.crudeExport, room: c.exportCrude },
      { price: c.prices.crudeDomestic, room: c.domesticCrude },
    );
  const breakpoints = [
    0,
    rooms.export / YIELD,
    rooms.domestic / YIELD,
    (rooms.export + rooms.domestic) / YIELD,
    refineLimit,
    c.volume - c.exportCrude,
    c.volume - c.domesticCrude,
    c.volume - c.exportCrude - c.domesticCrude,
  ];
  let best = 0;
  for (const point of breakpoints) {
    best = Math.max(best, revenueAt(Math.min(refineLimit, Math.max(0, point))));
  }
  return best;
}

function revenueOfFlows(c: Case, flows: {
  export: number; domestic: number; productsExport: number; productsDomestic: number;
}): number {
  return flows.export * c.prices.crudeExport +
    flows.domestic * c.prices.crudeDomestic +
    flows.productsExport * c.prices.productExport +
    flows.productsDomestic * c.prices.productDomestic;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Случайный расклад: мощности часто нулевые или малые, цены разного порядка. */
function randomCase(random: () => number, withStock: boolean): Case {
  const amount = (scale: number): number => {
    const roll = random();
    if (roll < 0.15) return 0;
    if (roll < 0.3) return Math.round(random() * scale * 0.05);
    return Math.round(random() * scale);
  };
  const price = (): number => {
    const roll = random();
    if (roll < 0.1) return 1;
    return Math.round((0.2 + random() * 6) * 100) / 100;
  };
  return {
    volume: 1 + Math.round(random() * 1000),
    exportCrude: amount(900),
    domesticCrude: amount(900),
    refinery: amount(900),
    exportProducts: amount(600),
    domesticProducts: amount(600),
    storage: random() < 0.5 ? 0 : amount(300),
    stock: withStock && random() < 0.6 ? amount(400) : 0,
    prices: {
      crudeDomestic: price(),
      crudeExport: price(),
      productDomestic: price(),
      productExport: price(),
    },
  };
}

const AUTO: FlowControls = {
  contract: { mode: 'auto', value: 0 },
  export: { mode: 'auto', value: 0 },
  refine: { mode: 'auto', value: 0 },
};

function describeCase(c: Case): string {
  return JSON.stringify(c);
}

describe('«Авто» считает выгоду переработки по цене продуктов (REVIEW A3)', () => {
  // Пример из ревизии: сильная девальвация, продукты можно продать только
  // внутри страны. Тонна сырья за границей — 2,65; на НПЗ — 0,85 × 1,8 = 1,53.
  const devaluation: Case = {
    volume: 100,
    exportCrude: 1000,
    domesticCrude: 0,
    refinery: 1000,
    exportProducts: 0,
    domesticProducts: 1000,
    storage: 0,
    stock: 0,
    prices: { crudeDomestic: 1, crudeExport: 2.65, productDomestic: 1.8, productExport: 0 },
  };

  it('прогноз: при дорогом экспорте сырьё идёт за границу, а не на НПЗ', () => {
    const flows = forecast(devaluation);
    expect(flows.export).toBeCloseTo(100, 9);
    expect(flows.refined).toBe(0);
    expect(flows.productsDomestic).toBe(0);
  });

  it('отгрузка партии: при дорогом экспорте сырьё идёт за границу, а не на НПЗ', () => {
    const plan = batch(devaluation);
    expect(plan.export).toBeCloseTo(100, 9);
    expect(plan.refined).toBe(0);
    expect(plan.products).toBe(0);
  });

  it('когда продукты дороже, НПЗ по-прежнему первый', () => {
    // Те же мощности, но экспорт сырья дешевле: 1,2 против 1,53 с тонны на НПЗ.
    const cheapExport: Case = {
      ...devaluation,
      prices: { ...devaluation.prices, crudeExport: 1.2 },
    };
    const flows = forecast(cheapExport);
    expect(flows.refined).toBeCloseTo(100, 9);
    expect(flows.export).toBe(0);
    expect(flows.productsDomestic).toBeCloseTo(100 * YIELD, 9);
    const plan = batch(cheapExport);
    expect(plan.refined).toBeCloseTo(100, 9);
    expect(plan.export).toBe(0);
  });

  it('выход НПЗ входит в сравнение: равные цены сырья и продуктов — сырьё выгоднее', () => {
    // Тонна сырья стоит 1, а из неё выходит 0,85 т продуктов по той же цене.
    const equal: Case = {
      ...devaluation,
      domesticCrude: 0,
      prices: { crudeDomestic: 1, crudeExport: 1, productDomestic: 1, productExport: 1 },
    };
    expect(YIELD).toBeLessThan(1);
    expect(forecast(equal).export).toBeCloseTo(100, 9);
    expect(forecast(equal).refined).toBe(0);
    expect(batch(equal).export).toBeCloseTo(100, 9);
    expect(batch(equal).refined).toBe(0);
  });

  it('дорогой, но тесный рынок продуктов не тянет на НПЗ всю нефть', () => {
    // Экспорт продуктов дорогой (6,89), но примет лишь 17 т. Остальные
    // продукты стоили бы 1,8 внутри страны: 1,53 с тонны сырья против 2,65.
    const narrow: Case = {
      volume: 600,
      exportCrude: 400,
      domesticCrude: 0,
      refinery: 1000,
      exportProducts: 17,
      domesticProducts: 1000,
      storage: 0,
      stock: 0,
      prices: { crudeDomestic: 1, crudeExport: 2.65, productDomestic: 1.8, productExport: 6.89 },
    };
    const forExportProducts = 17 / YIELD;
    for (const plan of [forecast(narrow), batch(narrow)]) {
      // 1) НПЗ — ровно под дорогой рынок продуктов; 2) экспорт сырья до упора;
      // 3) остаток — снова на НПЗ, уже ради внутреннего рынка.
      expect(plan.export).toBeCloseTo(400, 9);
      expect(plan.refined).toBeCloseTo(200, 9);
      expect(plan.refined).toBeGreaterThan(forExportProducts);
      expect(plan.productsExport).toBeCloseTo(17, 9);
      expect(plan.productsDomestic).toBeCloseTo(200 * YIELD - 17, 9);
    }
    // Нефти мало: её хватает на дорогие продукты и экспорт, до внутреннего рынка не доходит.
    const scarce = { ...narrow, volume: 300 };
    expect(forecast(scarce).refined).toBeCloseTo(forExportProducts, 9);
    expect(forecast(scarce).export).toBeCloseTo(300 - forExportProducts, 9);
    expect(forecast(scarce).productsDomestic).toBeCloseTo(0, 9);
    expect(batch(scarce).refined).toBeCloseTo(forExportProducts, 9);
    expect(batch(scarce).export).toBeCloseTo(300 - forExportProducts, 9);
  });

  it('на склад НПЗ работает в последнюю очередь', () => {
    // Рынки продуктов закрыты, есть только нефтебаза. Продукты со склада
    // выручки сейчас не дают, поэтому сырьё сначала продаётся.
    const storageOnly: Case = {
      volume: 100,
      exportCrude: 80,
      domesticCrude: 0,
      refinery: 1000,
      exportProducts: 0,
      domesticProducts: 0,
      storage: 17,
      stock: 0,
      prices: { crudeDomestic: 0.35, crudeExport: 1, productDomestic: 1.8, productExport: 2.6 },
    };
    const flows = forecast(storageOnly);
    expect(flows.export).toBeCloseTo(80, 9);
    // Остаток, который некуда продать, перерабатывается, пока есть место.
    expect(flows.refined).toBeCloseTo(20, 9);
    expect(flows.productsStored).toBeCloseTo(17, 9);
    expect(flows.productsSpill).toBe(0);
    expect(flows.stored).toBeCloseTo(0, 9);
    const plan = batch(storageOnly);
    expect(plan.export).toBeCloseTo(80, 9);
    expect(plan.refined).toBeCloseTo(20, 9);

    // Экспорт принимает всё — на склад не уходит ничего.
    const wideExport = { ...storageOnly, exportCrude: 500 };
    expect(forecast(wideExport).export).toBeCloseTo(100, 9);
    expect(forecast(wideExport).refined).toBe(0);
    expect(batch(wideExport).refined).toBe(0);

    // Даже самый дешёвый рынок сырья идёт раньше склада.
    const cheapDomestic = { ...storageOnly, exportCrude: 0, domesticCrude: 500 };
    expect(forecast(cheapDomestic).domestic).toBeCloseTo(100, 9);
    expect(forecast(cheapDomestic).refined).toBe(0);
    expect(batch(cheapDomestic).refined).toBe(0);
  });

  it('складской запас занимает рынок продуктов: НПЗ не считает это место своим', () => {
    // Внутренний рынок продуктов примет 50 т, и 50 т уже лежат на складе.
    // Свежим продуктам места нет, значит и выгоды от переработки нет.
    const stocked: Case = {
      volume: 100,
      exportCrude: 1000,
      domesticCrude: 0,
      refinery: 1000,
      exportProducts: 0,
      domesticProducts: 50,
      storage: 0,
      stock: 50,
      prices: { crudeDomestic: 0.35, crudeExport: 1, productDomestic: 1.8, productExport: 2.6 },
    };
    expect(forecast(stocked).refined).toBe(0);
    expect(forecast(stocked).export).toBeCloseTo(100, 9);
    expect(batch(stocked).refined).toBe(0);
    // Без запаса те же 50 т продуктов выгоднее экспорта сырья (1,53 против 1).
    const empty = { ...stocked, stock: 0 };
    expect(forecast(empty).refined).toBeCloseTo(50 / YIELD, 9);
    expect(batch(empty).refined).toBeCloseTo(50 / YIELD, 9);
  });
});

describe('план «Авто» даёт наибольшую выручку окна', () => {
  const ROUNDS = 1500;

  it('прогноз потоков не уступает ни одному другому раскладу', () => {
    const random = mulberry32(20261110);
    let refineLost = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const c = randomCase(random, round % 2 === 1);
      const flows = forecast(c, AUTO);
      const best = bestRevenue(c);
      const actual = revenueOfFlows(c, flows);
      const slack = 1e-9 * Math.max(1, best);
      expect(actual, `выручка ниже лучшей: ${describeCase(c)}`).toBeGreaterThanOrEqual(best - slack);
      expect(actual, `выручка выше возможной: ${describeCase(c)}`).toBeLessThanOrEqual(best + slack);
      if (flows.refined < Math.min(c.volume, flows.refineCapacity) - 1e-9) refineLost++;
    }
    // Проверка не вырождена: во многих раскладах НПЗ получает не всё, что мог бы взять.
    expect(refineLost).toBeGreaterThan(ROUNDS / 10);
  });

  it('отгрузка партии не уступает ни одному другому раскладу', () => {
    const random = mulberry32(777);
    for (let round = 0; round < ROUNDS; round++) {
      // Без складского запаса: allocateBatch возвращает раскладку только свежих продуктов.
      const c = randomCase(random, false);
      const plan = batch(c, AUTO);
      const best = bestRevenue(c);
      const actual = revenueOfFlows(c, plan);
      const slack = 1e-9 * Math.max(1, best);
      expect(actual, `выручка ниже лучшей: ${describeCase(c)}`).toBeGreaterThanOrEqual(best - slack);
      expect(actual, `выручка выше возможной: ${describeCase(c)}`).toBeLessThanOrEqual(best + slack);
    }
  });

  it('мощности и сохранение массы не нарушаются', () => {
    const random = mulberry32(31337);
    for (let round = 0; round < ROUNDS; round++) {
      const c = randomCase(random, round % 2 === 0);
      const flows = forecast(c, AUTO);
      const label = describeCase(c);
      expect(flows.export, label).toBeLessThanOrEqual(c.exportCrude + 1e-9);
      expect(flows.domestic, label).toBeLessThanOrEqual(c.domesticCrude + 1e-9);
      expect(flows.refined, label).toBeLessThanOrEqual(c.refinery + 1e-9);
      expect(flows.export + flows.domestic + flows.refined + flows.stored, label)
        .toBeCloseTo(c.volume, 6);
      expect(flows.productsProduced, label).toBeCloseTo(flows.refined * YIELD, 9);
      const rooms = productRoomsOf(c);
      expect(flows.productsExport, label).toBeLessThanOrEqual(rooms.export + 1e-9);
      expect(flows.productsDomestic, label).toBeLessThanOrEqual(rooms.domestic + 1e-9);
      // Всё произведённое либо продано, либо лежит на складе: НПЗ не льёт продукты на землю.
      expect(flows.productsExport + flows.productsDomestic + flows.productsStored, label)
        .toBeCloseTo(flows.productsProduced, 6);
      expect(flows.productsStored, label).toBeLessThanOrEqual(c.storage + 1e-9);
      expect(flows.productsSpill, label).toBeLessThan(1e-9);
    }
  });

  it('прогноз и отгрузка делят сырьё одинаково', () => {
    const random = mulberry32(4242);
    const modes: Array<'auto' | 'fixed'> = ['auto', 'fixed'];
    for (let round = 0; round < ROUNDS; round++) {
      const c = randomCase(random, round % 2 === 0);
      // В трети раскладов часть каналов закреплена вручную.
      const controls: FlowControls = { ...AUTO };
      if (round % 3 === 0) {
        for (const channel of ['contract', 'export', 'refine'] as Channel[]) {
          const mode = modes[Math.floor(random() * 2)]!;
          controls[channel] = mode === 'fixed'
            ? { mode, value: Math.round(random() * 400) }
            : { mode, value: 0 };
        }
      }
      const flows = forecast(c, controls);
      const plan = batch(c, controls);
      const label = `${describeCase(c)} ${JSON.stringify(controls)}`;
      expect(plan.export, label).toBeCloseTo(flows.export, 6);
      expect(plan.refined, label).toBeCloseTo(flows.refined, 6);
      expect(plan.domestic, label).toBeCloseTo(flows.domestic, 6);
      expect(plan.rest, label).toBeCloseTo(flows.stored, 6);
    }
  });
});

describe('ручные заявки сильнее выгоды', () => {
  const base: Case = {
    volume: 500,
    exportCrude: 300,
    domesticCrude: 300,
    refinery: 300,
    exportProducts: 0,
    domesticProducts: 1000,
    storage: 0,
    stock: 0,
    prices: { crudeDomestic: 0.35, crudeExport: 2.65, productDomestic: 1.8, productExport: 0 },
  };

  it('закреплённая переработка исполняется, даже если экспорт выгоднее', () => {
    const controls: FlowControls = { ...AUTO, refine: { mode: 'fixed', value: 120 } };
    for (const plan of [forecast(base, controls), batch(base, controls)]) {
      expect(plan.refined).toBeCloseTo(120, 9);
      // Остаток делится по выгоде: экспорт до упора, потом внутренний рынок.
      expect(plan.export).toBeCloseTo(300, 9);
      expect(plan.domestic).toBeCloseTo(80, 9);
    }
  });

  it('закреплённый ноль закрывает канал, остальные делят объём по выгоде', () => {
    const controls: FlowControls = { ...AUTO, export: { mode: 'fixed', value: 0 } };
    for (const plan of [forecast(base, controls), batch(base, controls)]) {
      expect(plan.export).toBe(0);
      // Без экспорта тонна на НПЗ (1,53) дороже внутреннего рынка сырья (0,35).
      expect(plan.refined).toBeCloseTo(300, 9);
      expect(plan.domestic).toBeCloseTo(200, 9);
    }
  });

  it('закреплённая заявка не превышает мощность НПЗ и приёмку продуктов', () => {
    const controls: FlowControls = { ...AUTO, refine: { mode: 'fixed', value: 10_000 } };
    const tight = { ...base, domesticProducts: 85 };
    for (const plan of [forecast(tight, controls), batch(tight, controls)]) {
      expect(plan.refined).toBeCloseTo(100, 9);
    }
  });
});

/** Игра с НПЗ, экспортом сырья по железной дороге и заданным уровнем девальвации. */
function refineryGame(devaluationLevel: number, extraLevels: Record<string, number> = {}): {
  content: Content;
  state: GameState;
  game: Game;
} {
  const content = structuredClone(original);
  // Цена и дебит не плавают: сравниваем только маршруты.
  content.config.worldPrice.min = 1;
  content.config.worldPrice.max = 1;
  content.config.worldPrice.startPrice = 1;
  content.config.oil.wells.decline.minFactor = 1;
  content.config.oil.baseCapacity = 10_000_000;
  const state = createInitialState(content.config, 2026);
  state.wells = [{ kind: 'unique', dailyTonnes: 1_500 }];
  state.levels = {
    t_refinery: 16,
    x_cistern: 25,
    p_devalue_currency: devaluationLevel,
    ...extraLevels,
  };
  return { content, state, game: new Game(content, state) };
}

function earnedIn(game: Game, state: GameState, seconds: number): number {
  const before = state.totalEarned;
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 250) game.update(250);
  return state.totalEarned - before;
}

describe('«Авто» в игре: девальвация и маршруты', () => {
  it('в сценарии хватает мощности и на экспорт, и на НПЗ', () => {
    const { game } = refineryGame(20);
    const derived = game.derived();
    expect(derived.oilPerSecond).toBeGreaterThan(1000);
    expect(derived.capacities.export.crude).toBeGreaterThan(derived.oilPerSecond);
    expect(derived.capacities.refine).toBeGreaterThan(derived.oilPerSecond);
    expect(derived.capacities.export.products).toBe(0);
    expect(derived.capacities.domestic.products).toBeGreaterThan(derived.oilPerSecond * YIELD);
    // Девальвация на 20 уровнях: экспорт сырья дороже продуктов внутри страны с учётом выхода.
    expect(derived.exportPricePerTon).toBeGreaterThan(derived.productPriceDomestic * YIELD);
  });

  it('после девальвации вся нефть идёт на экспорт, а не на НПЗ', () => {
    const { game } = refineryGame(20);
    const flows = game.derived().flows;
    expect(flows.export).toBeCloseTo(flows.produced, 6);
    expect(flows.refined).toBe(0);
  });

  it('без девальвации та же империя перерабатывает всю нефть', () => {
    const { game } = refineryGame(0);
    const derived = game.derived();
    expect(derived.exportPricePerTon).toBeLessThan(derived.productPriceDomestic * YIELD);
    expect(derived.flows.refined).toBeCloseTo(derived.flows.produced, 6);
    expect(derived.flows.export).toBe(0);
  });

  it('порог переключения — там, где экспорт тонны сырья обгоняет продукты из неё', () => {
    let switched = -1;
    for (let level = 0; level <= 20; level++) {
      const { game } = refineryGame(level);
      const derived = game.derived();
      const exportBetter = derived.exportPricePerTon > derived.productPriceDomestic * YIELD;
      expect(derived.flows.export > 0, `уровень ${level}`).toBe(exportBetter);
      expect(derived.flows.refined > 0, `уровень ${level}`).toBe(!exportBetter);
      if (exportBetter && switched < 0) switched = level;
    }
    // 1,05^9 ≈ 1,55 — первый курс выше 0,85 × 1,8 = 1,53.
    expect(switched).toBe(9);
  });

  it('экспортный терминал продуктов возвращает нефть на НПЗ', () => {
    // Продукты за границей — 2,6 × курс: с тонны сырья больше, чем экспорт сырья.
    const { game } = refineryGame(20, { t_productport: 1 });
    const derived = game.derived();
    expect(derived.capacities.export.products).toBeGreaterThan(derived.oilPerSecond * YIELD);
    expect(derived.flows.refined).toBeCloseTo(derived.flows.produced, 6);
    expect(derived.flows.productsExport).toBeCloseTo(derived.flows.produced * YIELD, 6);
    expect(derived.flows.export).toBe(0);
  });

  it('за минуту «Авто» зарабатывает не меньше любой ручной настройки', () => {
    const auto = refineryGame(20);
    const autoEarned = earnedIn(auto.game, auto.state, 60);
    expect(autoEarned).toBeGreaterThan(0);

    const produced = auto.game.derived().oilPerSecond;
    const manual: Array<Partial<Record<Channel, number>>> = [
      { refine: 0 },
      { export: 0 },
      { refine: produced },
      { refine: produced / 2 },
      { export: produced / 3, refine: produced / 3 },
      { contract: produced / 4 },
    ];
    for (const setting of manual) {
      const other = refineryGame(20);
      for (const [channel, value] of Object.entries(setting) as Array<[Channel, number]>) {
        expect(other.game.setFlowControl(channel, { mode: 'fixed', value })).toBe(true);
      }
      const earned = earnedIn(other.game, other.state, 60);
      expect(
        autoEarned,
        `ручная настройка ${JSON.stringify(setting)} принесла ${earned}, «Авто» — ${autoEarned}`,
      ).toBeGreaterThanOrEqual(earned * (1 - 1e-9));
    }
    // «Всё на экспорт» вручную — это и есть выбор «Авто».
    const allExport = refineryGame(20);
    allExport.game.setFlowControl('refine', { mode: 'fixed', value: 0 });
    expect(earnedIn(allExport.game, allExport.state, 60)).toBeCloseTo(autoEarned, 3);
  });

  it('прогноз выручки совпадает с кассой и до, и после переключения маршрута', () => {
    for (const level of [0, 8, 9, 20]) {
      const { game, state } = refineryGame(level);
      const expected = game.derived().netPerSecond;
      const actual = earnedIn(game, state, 20) / 20;
      expect(Math.abs(actual - expected) / Math.max(1, Math.abs(expected)), `уровень ${level}`)
        .toBeLessThan(0.01);
    }
  });
});

describe('у переработки нет условной цены (REVIEW A3)', () => {
  it('цена канала переработки — выручка с тонны сырья по лучшей цене продуктов', () => {
    for (const levels of [
      {},
      { p_domestic_cartel: 1 },
      { p_export_cartel: 1, p_devalue_currency: 4 },
      { p_devalue_currency: 20 },
    ] as Array<Record<string, number>>) {
      const { game } = refineryGame(0, levels);
      const derived = game.derived();
      const best = Math.max(derived.productPriceDomestic, derived.productPriceExport);
      expect(derived.channels.refine.price, JSON.stringify(levels)).toBeCloseTo(YIELD * best, 9);
    }
    // Без девальвации продукты дороже за границей только из-за множителя цены,
    // после неё — ещё и из-за курса: число следует за игрой, а не за конфигом.
    const calm = refineryGame(0).game.derived();
    const devalued = refineryGame(20).game.derived();
    expect(devalued.channels.refine.price).toBeGreaterThan(calm.channels.refine.price * 2);
  });

  it('в конфиге нет множителя цены переработки: он ни на что не влияет', () => {
    expect(Object.keys(config.oil.channels.refine).sort()).toEqual(['baseRate']);
  });
});

