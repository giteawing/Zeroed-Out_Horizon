/**
 * Сбыт: распределение нефти и нефтепродуктов между рынками.
 *
 * Здесь только планирование продаж: функции возвращают объёмы и остатки,
 * но не меняют GameState и не начисляют деньги.
 */
import type {
  Channel,
  ExportMode,
  GameConfig,
  FlowControls,
  OilFlows,
  Product,
  RefineryUnit,
} from '../types';
import { MAX_REFINERY_DEPTH } from './refineries';

export interface Market<Key extends string> {
  key: Key;
  price: number;
  capacity: number;
}

/**
 * Раздача товара по рынкам «сначала дороже»: рынки сортируются по цене,
 * каждый забирает доступную часть остатка. Так делятся нефтепродукты и
 * запас на складе; сырьё между экспортом, НПЗ и внутренним рынком делит
 * `routeCrude()` — там есть ручные заявки и сравнение по выручке с тонны.
 *
 * Входные capacity должны быть уже приведены к нужному временному интервалу.
 */
export function allocateByPrice<Key extends string>(
  volume: number,
  markets: readonly Market<Key>[],
): { byMarket: Record<Key, number>; remaining: number } {
  const byMarket = {} as Record<Key, number>;
  let remaining = Number.isFinite(volume) ? Math.max(0, volume) : 0;
  for (const market of markets) byMarket[market.key] = 0;
  for (const market of [...markets].sort((a, b) => b.price - a.price)) {
    const capacity = market.capacity === Number.POSITIVE_INFINITY
      ? remaining
      : Number.isFinite(market.capacity)
        ? Math.max(0, market.capacity)
        : 0;
    const taken = Math.min(remaining, capacity);
    byMarket[market.key] = taken;
    remaining -= taken;
  }
  return { byMarket, remaining };
}

/** Цены четырёх товарных рынков, ₦ за тонну. */
export interface MarketPrices {
  crudeDomestic: number;
  crudeExport: number;
  productDomestic: number;
  productExport: number;
}

type CrudeRoute = 'export' | 'refine' | 'domestic';

const ROUTE_CHANNELS: ReadonlyArray<{ key: CrudeRoute; channel: Channel }> = [
  { key: 'export', channel: 'export' },
  { key: 'refine', channel: 'refine' },
  { key: 'domestic', channel: 'contract' },
];

/** Сколько сырья и продуктов готовы принять рынки за рассчитываемый интервал. */
interface CrudeDemand {
  exportCrude: number;
  domesticCrude: number;
  /** НПЗ с учётом физической мощности и приёмки продуктов. */
  refine: number;
  refineries: readonly RefineryUnit[];
  /** Рынки продуктов уже освобождены от конкурирующего запаса. */
  productRoom: { export: number; domestic: number };
  productStorage: number;
}

/**
 * Переводит мощности заводов в объём за окно и ставит наиболее глубокий
 * первым. В старых вызовах с одной общей мощностью отсутствие списка означает
 * один условный НПЗ базовой глубины; игра передаёт именно свой парк (в том
 * числе пустой), поэтому оборудование не создаёт фиктивных заводов.
 */
function prepareRefineries(
  config: GameConfig,
  capacity: number,
  units: readonly RefineryUnit[] | undefined,
  span = 1,
): RefineryUnit[] {
  const source = units ?? [{ capacity, depth: config.oil.refineryYield }];
  return source.map((unit) => ({
    capacity: Number.isFinite(unit.capacity) ? Math.max(0, unit.capacity) * span : 0,
    depth: Number.isFinite(unit.depth) ? Math.min(MAX_REFINERY_DEPTH, Math.max(1e-9, unit.depth)) : config.oil.refineryYield,
  })).filter((unit) => unit.capacity > 0).sort((a, b) => b.depth - a.depth);
}

/** Максимум сырья по очереди заводов и общему месту для продуктов. */
function refineryCapacityFor(units: readonly RefineryUnit[], maxCrude: number, outlet: number): number {
  let crude = 0;
  let room = Math.max(0, outlet);
  for (const unit of units) {
    const accepted = Math.min(unit.capacity, Math.max(0, maxCrude - crude), room / unit.depth);
    crude += accepted;
    room = Math.max(0, room - accepted * unit.depth);
    if (room <= 0 || crude >= maxCrude) break;
  }
  return crude;
}

/**
 * Сначала исполняет фиксированные заявки. Автоматические каналы сравниваются
 * по предельной выручке: для следующего НПЗ это его собственная глубина ×
 * цена лучшего ещё свободного рынка продуктов. После заполнения завода или
 * рынка сравнение повторяется; работа на склад всегда последняя.
 * При равной цене порядок: экспорт, НПЗ, внутренний рынок.
 */
function routeCrude(
  volume: number,
  demand: CrudeDemand,
  prices: MarketPrices,
  controls?: FlowControls,
  scale = 1,
): { byMarket: Record<CrudeRoute, number>; remaining: number; productsProduced: number } {
  const room = (value: number): number =>
    value === Number.POSITIVE_INFINITY
      ? Number.MAX_SAFE_INTEGER
      : Number.isFinite(value) ? Math.max(0, value) : 0;
  const byMarket: Record<CrudeRoute, number> = { export: 0, refine: 0, domestic: 0 };
  const left: Record<CrudeRoute, number> = {
    export: room(demand.exportCrude),
    refine: room(demand.refine),
    domestic: room(demand.domesticCrude),
  };
  const plants = demand.refineries.map((unit) => ({ ...unit }));
  const productLeft = { export: room(demand.productRoom.export), domestic: room(demand.productRoom.domestic) };
  let storageLeft = room(demand.productStorage);
  let remaining = Number.isFinite(volume) ? Math.max(0, volume) : 0;
  let productsProduced = 0;
  const markets: Array<'export' | 'domestic'> = prices.productExport >= prices.productDomestic
    ? ['export', 'domestic'] : ['domestic', 'export'];
  const productPrice = (market: 'export' | 'domestic'): number =>
    market === 'export' ? prices.productExport : prices.productDomestic;

  const takeCrude = (key: Exclude<CrudeRoute, 'refine'>, limit: number): void => {
    const taken = Math.min(remaining, left[key], limit);
    if (!(taken > 0)) return;
    byMarket[key] += taken;
    left[key] -= taken;
    remaining -= taken;
  };
  const takeRefinery = (limit: number): void => {
    let allowed = limit;
    for (const plant of plants) {
      if (!(allowed > 0 && remaining > 0 && left.refine > 0)) break;
      const outlets = productLeft.export + productLeft.domestic + storageLeft;
      const taken = Math.min(allowed, remaining, left.refine, plant.capacity, outlets / plant.depth);
      if (!(taken > 0)) continue;
      plant.capacity -= taken;
      byMarket.refine += taken;
      left.refine -= taken;
      remaining -= taken;
      allowed -= taken;
      let products = taken * plant.depth;
      productsProduced += products;
      for (const market of markets) {
        const sold = Math.min(products, productLeft[market]);
        productLeft[market] = Math.max(0, productLeft[market] - sold);
        products -= sold;
      }
      storageLeft = Math.max(0, storageLeft - products);
    }
  };

  const automatic: CrudeRoute[] = [];
  for (const { key, channel } of ROUTE_CHANNELS) {
    const setting = controls?.[channel];
    if (!setting || setting.mode !== 'fixed') {
      automatic.push(key);
      continue;
    }
    const limit = Math.max(0, Number.isFinite(setting.value) ? setting.value * scale : 0);
    if (key === 'refine') takeRefinery(limit);
    else takeCrude(key, limit);
  }

  while (remaining > 0) {
    const steps: Array<{ key: CrudeRoute; price: number; limit: number; priority: number }> = [];
    if (automatic.includes('export') && left.export > 0) {
      steps.push({ key: 'export', price: prices.crudeExport, limit: left.export, priority: 0 });
    }
    if (automatic.includes('domestic') && left.domestic > 0) {
      steps.push({ key: 'domestic', price: prices.crudeDomestic, limit: left.domestic, priority: 2 });
    }
    if (automatic.includes('refine') && left.refine > 0) {
      const plant = plants.find((unit) => unit.capacity > 0);
      if (plant) {
        const market = markets.find((key) => productLeft[key] > 1e-9);
        if (market) {
          steps.push({
            key: 'refine', price: plant.depth * productPrice(market),
            limit: Math.min(plant.capacity, productLeft[market] / plant.depth), priority: 1,
          });
        } else if (storageLeft > 1e-9) {
          // Склад не приносит выручки сейчас, даже при нулевой цене сырья.
          steps.push({ key: 'refine', price: Number.NEGATIVE_INFINITY, limit: plant.capacity, priority: 3 });
        }
      }
    }
    if (steps.length === 0) break;
    steps.sort((a, b) => b.price - a.price || a.priority - b.priority);
    const step = steps[0]!;
    const before = remaining;
    if (step.key === 'refine') takeRefinery(step.limit);
    else takeCrude(step.key, step.limit);
    // Защита от накопленной погрешности числа с плавающей точкой.
    if (!(remaining < before)) break;
  }
  return { byMarket, remaining, productsProduced };
}

/**
 * Оценка потоков за секунду для панели.
 *
 * Продукты делятся между рынками по цене. Сырьё — по выручке с тонны, для
 * НПЗ это выход × цена продуктов (см. routeCrude). Ограничения безлимитных
 * каналов нормализуются до большого числа.
 */
export function oilFlowsOf(
  config: GameConfig,
  capacities: {
    domestic: Record<Product, number>;
    export: Record<Product, number>;
    refine: number;
  },
  produced: number,
  options: {
    pipeline?: number;
    productStorage?: number;
    /** Свободное место в нефтебазах на начало окна, тонн. */
    productStorageFree?: number;
    /** Нефтепродукты, уже лежащие на складах и конкурирующие за рынки. */
    productInventory?: number;
    /** Длительность окна пакетной отгрузки: ёмкость переводится в т/с. */
    storageHorizonSeconds?: number;
    modeShares?: Record<ExportMode, number>;
    /** Настройки маршрутизации сырой нефти из состояния игры. */
    flowControl?: FlowControls;
    /** Каждый НПЗ со своей мощностью и глубиной; пустой список означает отсутствие НПЗ. */
    refineries?: readonly RefineryUnit[];
    prices?: MarketPrices;
  } = {},
): OilFlows {
  const total = Math.max(0, produced);
  const safe = (value: number): number =>
    value === Number.POSITIVE_INFINITY
      ? Number.MAX_SAFE_INTEGER
      : Number.isFinite(value)
        ? Math.max(0, value)
        : 0;

  const prices = options.prices ?? {
    crudeDomestic: 1,
    crudeExport: 1,
    productDomestic: 1,
    productExport: 1,
  };

  const pipelineShare = Math.max(0, Math.min(1, options.pipeline ?? 0));
  const pipelineCapacity = safe(capacities.export.crude) * pipelineShare;

  const productCapacity = Math.max(0, options.productStorage ?? config.product.baseStorage);
  const productStorageFree = Math.max(0, options.productStorageFree ?? productCapacity);
  const storageHorizonSeconds = Math.max(
    0.001,
    options.storageHorizonSeconds ?? config.oil.shipDays * config.oil.wells.secondsPerDay,
  );
  const productStorageRate = productStorageFree / storageHorizonSeconds;
  // Старый складской запас занимает часть рыночной мощности раньше свежего
  // выхода НПЗ: повторно продавать его объём нельзя.
  const inventoryPlan = allocateByPrice(Math.max(0, options.productInventory ?? 0), [
    {
      key: 'export',
      price: prices.productExport,
      capacity: safe(capacities.export.products) * storageHorizonSeconds,
    },
    {
      key: 'domestic',
      price: prices.productDomestic,
      capacity: safe(capacities.domestic.products) * storageHorizonSeconds,
    },
  ]);
  const exportProductMarketRate = Math.max(
    0,
    safe(capacities.export.products) -
      inventoryPlan.byMarket.export / storageHorizonSeconds,
  );
  const domesticProductMarketRate = Math.max(
    0,
    safe(capacities.domestic.products) -
      inventoryPlan.byMarket.domestic / storageHorizonSeconds,
  );
  const productMarketRate = exportProductMarketRate + domesticProductMarketRate;
  // Отдельные мощности и глубины дают кусочно-линейный, а не средний выход.
  const units = prepareRefineries(config, safe(capacities.refine), options.refineries);
  const refineryCapacity = refineryCapacityFor(
    units,
    config.oil.channels.refine.unlimited ? Number.MAX_SAFE_INTEGER : safe(capacities.refine),
    productMarketRate + productStorageRate,
  );

  const crude = routeCrude(total, {
    exportCrude: config.oil.channels.export.unlimited
      ? Number.MAX_SAFE_INTEGER
      : safe(capacities.export.crude),
    domesticCrude: config.oil.channels.contract.unlimited
      ? Number.MAX_SAFE_INTEGER
      : safe(capacities.domestic.crude),
    refine: refineryCapacity,
    refineries: units,
    productRoom: { export: exportProductMarketRate, domestic: domesticProductMarketRate },
    productStorage: productStorageRate,
  }, prices, options.flowControl);

  const exportTonnes = crude.byMarket.export;
  const pipelineTonnes = Math.min(exportTonnes, pipelineCapacity);
  const refined = crude.byMarket.refine;
  const domestic = crude.byMarket.domestic;
  const stored = crude.remaining;

  const productsProduced = crude.productsProduced;
  const products = allocateByPrice(productsProduced, [
    { key: 'export', price: prices.productExport, capacity: exportProductMarketRate },
    { key: 'domestic', price: prices.productDomestic, capacity: domesticProductMarketRate },
  ]);
  const productsDomestic = products.byMarket.domestic;
  const productsExport = products.byMarket.export;

  // Накопление продуктов — поток в т/с. Ёмкость в тоннах распределяем
  // на время до следующей отгрузки, не сравнивая разные единицы измерения.
  const productsStored = Math.min(products.remaining, productStorageRate);
  const productsSpill = Math.max(0, products.remaining - productsStored);

  const shares = options.modeShares;
  const nonPipelineShare = shares ? shares.rail + shares.tanker : 0;
  const allModeShare = shares ? shares.pipeline + nonPipelineShare : 0;
  const exportByMode: Record<ExportMode, number> = shares && options.pipeline === undefined
    ? {
      // Без отдельного прямого потока pipeline это доли распределения всего
      // экспорта, а не резерв мощности трубы.
      pipeline: allModeShare > 1e-9 ? exportTonnes * shares.pipeline / allModeShare : 0,
      rail: allModeShare > 1e-9 ? exportTonnes * shares.rail / allModeShare : 0,
      tanker: allModeShare > 1e-9 ? exportTonnes * shares.tanker / allModeShare : 0,
    }
    : shares
      ? {
        pipeline: pipelineTonnes,
        rail: nonPipelineShare > 1e-9 ? Math.max(0, exportTonnes - pipelineTonnes) * shares.rail / nonPipelineShare : 0,
        tanker: nonPipelineShare > 1e-9 ? Math.max(0, exportTonnes - pipelineTonnes) * shares.tanker / nonPipelineShare : 0,
      }
      : { pipeline: pipelineTonnes, rail: 0, tanker: 0 };

  return {
    produced: total,
    domestic,
    export: exportTonnes,
    exportByMode,
    stored,
    refined,
    productsProduced,
    productsDomestic,
    productsExport,
    productsStored,
    productsSpill,
    backlog: stored,
    refineCapacity: refineryCapacity,
    domesticCapacity: safe(capacities.domestic.crude),
    exportCapacity: safe(capacities.export.crude),
    productCapacity,
  };
}

/**
 * Распределяет накопленную партию за заданное число секунд.
 * Это тот же алгоритм приоритета рынков, что и oilFlowsOf().
 */
export function allocateBatch(
  config: GameConfig,
  capacities: {
    domestic: Record<Product, number>;
    export: Record<Product, number>;
    refine: number;
  },
  batch: number,
  seconds = 1,
  prices: MarketPrices = { crudeDomestic: 1, crudeExport: 1, productDomestic: 1, productExport: 1 },
  productStorageFree = config.product.baseStorage,
  productStock = 0,
  flowControl?: FlowControls,
  refineries?: readonly RefineryUnit[],
): {
  domestic: number;
  export: number;
  refined: number;
  products: number;
  productsDomestic: number;
  productsExport: number;
  rest: number;
} {
  const span = Math.max(0, seconds);
  const limit = (value: number): number =>
    value === Number.POSITIVE_INFINITY
      ? Number.MAX_SAFE_INTEGER
      : Number.isFinite(value)
        ? Math.max(0, value) * span
        : 0;

  const productStockPlan = allocateByPrice(Math.max(0, productStock), [
    {
      key: 'export',
      price: prices.productExport,
      capacity: limit(capacities.export.products),
    },
    {
      key: 'domestic',
      price: prices.productDomestic,
      capacity: limit(capacities.domestic.products),
    },
  ]);
  // Складской запас продаётся раньше свежего выхода НПЗ и занимает рынок.
  const productRoom = {
    export: Math.max(0, limit(capacities.export.products) - productStockPlan.byMarket.export),
    domestic: Math.max(0, limit(capacities.domestic.products) - productStockPlan.byMarket.domestic),
  };
  const productMarketCapacity = productRoom.export + productRoom.domestic;
  const units = prepareRefineries(config, capacities.refine, refineries, span);
  const refineBatchCapacity = refineryCapacityFor(
    units,
    config.oil.channels.refine.unlimited ? Number.MAX_SAFE_INTEGER : limit(capacities.refine),
    productMarketCapacity + Math.max(0, productStorageFree),
  );

  const crude = routeCrude(batch, {
    exportCrude: config.oil.channels.export.unlimited
      ? Number.MAX_SAFE_INTEGER
      : limit(capacities.export.crude),
    domesticCrude: config.oil.channels.contract.unlimited
      ? Number.MAX_SAFE_INTEGER
      : limit(capacities.domestic.crude),
    refine: refineBatchCapacity,
    refineries: units,
    productRoom,
    productStorage: Math.max(0, productStorageFree),
  }, prices, flowControl, span);

  const products = crude.productsProduced;
  const productSale = allocateByPrice(products, [
    { key: 'export', price: prices.productExport, capacity: productRoom.export },
    { key: 'domestic', price: prices.productDomestic, capacity: productRoom.domestic },
  ]);

  return {
    domestic: crude.byMarket.domestic,
    export: crude.byMarket.export,
    refined: crude.byMarket.refine,
    products,
    productsDomestic: productSale.byMarket.domestic,
    productsExport: productSale.byMarket.export,
    rest: crude.remaining,
  };
}
