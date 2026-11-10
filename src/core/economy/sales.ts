/**
 * Сбыт: распределение нефти и нефтепродуктов между рынками.
 *
 * Здесь только планирование продаж: функции возвращают объёмы и остатки,
 * но не меняют GameState и не начисляют деньги.
 */
import type {
  Channel,
  DerivedStats,
  ExportMode,
  GameConfig,
  FlowControls,
  OilFlows,
  Product,
  UpgradeDef,
} from '../types';

export interface Market<Key extends string> {
  key: Key;
  price: number;
  capacity: number;
}

/**
 * Общий алгоритм для сырья и нефтепродуктов:
 * рынки сортируются по цене, каждый забирает доступную часть остатка.
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
  /**
   * Сколько сырья может взять НПЗ: его мощность, ограниченная приёмкой
   * продуктов (рынки и свободное место на нефтебазах).
   */
  refine: number;
  /** Сколько нефтепродуктов рынки примут сверх складского запаса. */
  productRoom: { export: number; domestic: number };
}

/**
 * Распределяет сырьё между экспортом, НПЗ и внутренним рынком.
 *
 * Сначала исполняются фиксированные заявки игрока. Остаток каналы в режиме
 * «Авто» делят по выручке с тонны сырья:
 *
 * - экспорт и внутренний рынок — цена сырья;
 * - НПЗ — выход продуктов × цена рынка, который эти продукты примет.
 *   Рынков продуктов два, поэтому у переработки две ступени со своей ценой
 *   и своим объёмом: тесный дорогой рынок не тянет на НПЗ всю нефть;
 * - переработка на склад выручки сейчас не даёт и идёт последней: только
 *   тем сырьём, которое больше некуда продать.
 *
 * При равной выручке порядок: экспорт, НПЗ, внутренний рынок.
 */
function routeCrude(
  config: GameConfig,
  volume: number,
  demand: CrudeDemand,
  prices: MarketPrices,
  controls?: FlowControls,
  scale = 1,
): { byMarket: Record<CrudeRoute, number>; remaining: number } {
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
  let remaining = Number.isFinite(volume) ? Math.max(0, volume) : 0;

  const take = (key: CrudeRoute, limit: number): void => {
    const taken = Math.min(remaining, left[key], limit);
    if (!(taken > 0)) return;
    byMarket[key] += taken;
    left[key] -= taken;
    remaining -= taken;
  };

  // Фиксированные заявки выполняются первыми; при нехватке добычи ничего не
  // отправляем сверх доступного объёма. Лимит мощности применяется отдельно.
  const automatic: CrudeRoute[] = [];
  for (const { key, channel } of ROUTE_CHANNELS) {
    const setting = controls?.[channel];
    if (!setting || setting.mode !== 'fixed') {
      automatic.push(key);
      continue;
    }
    take(key, Math.max(0, Number.isFinite(setting.value) ? setting.value * scale : 0));
  }

  const refineryYield = Math.max(1e-9, config.oil.refineryYield);
  const steps: Array<{ key: CrudeRoute; price: number; limit: number }> = [];
  for (const key of automatic) {
    if (key === 'export') {
      steps.push({ key, price: prices.crudeExport, limit: Number.POSITIVE_INFINITY });
    } else if (key === 'domestic') {
      steps.push({ key, price: prices.crudeDomestic, limit: Number.POSITIVE_INFINITY });
    } else {
      steps.push({
        key,
        price: refineryYield * prices.productExport,
        limit: room(demand.productRoom.export) / refineryYield,
      });
      steps.push({
        key,
        price: refineryYield * prices.productDomestic,
        limit: room(demand.productRoom.domestic) / refineryYield,
      });
    }
  }
  // Сортировка устойчива: при равной выручке сохраняется порядок каналов.
  steps.sort((a, b) => b.price - a.price);
  for (const step of steps) take(step.key, step.limit);
  // Оставшаяся мощность НПЗ — это работа на склад.
  if (automatic.includes('refine')) take('refine', Number.POSITIVE_INFINITY);

  return { byMarket, remaining };
}

/** Объём нефти для разовой экспортной акции. */
export function exportTonnes(config: GameConfig, derived: DerivedStats, oil: number): number {
  const want = derived.channels.export.rate * config.oil.exportBurstSeconds;
  return Math.min(oil, Math.max(0, want));
}

/** Валовая выручка разовой продажи через выбранный канал. */
export function saleProceeds(
  def: Pick<UpgradeDef, 'effect'>,
  derived: DerivedStats,
  tonnes: number,
): number {
  const channel = def.effect.burstChannel ?? 'export';
  const rate = derived.channels[channel];
  return Math.max(0, tonnes * rate.price);
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
  // Не перерабатываем сырьё, если продукты нельзя продать или разместить.
  const refineryCapacity = Math.min(
    config.oil.channels.refine.unlimited ? Number.MAX_SAFE_INTEGER : safe(capacities.refine),
    (productMarketRate + productStorageRate) / Math.max(1e-9, config.oil.refineryYield),
  );

  const crude = routeCrude(config, total, {
    exportCrude: config.oil.channels.export.unlimited
      ? Number.MAX_SAFE_INTEGER
      : safe(capacities.export.crude),
    domesticCrude: config.oil.channels.contract.unlimited
      ? Number.MAX_SAFE_INTEGER
      : safe(capacities.domestic.crude),
    refine: config.oil.channels.refine.unlimited ? Number.MAX_SAFE_INTEGER : refineryCapacity,
    productRoom: { export: exportProductMarketRate, domestic: domesticProductMarketRate },
  }, prices, options.flowControl);

  const exportTonnes = crude.byMarket.export;
  const pipelineTonnes = Math.min(exportTonnes, pipelineCapacity);
  const refined = crude.byMarket.refine;
  const domestic = crude.byMarket.domestic;
  const stored = crude.remaining;

  const productsProduced = refined * config.oil.refineryYield;
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
  const refineBatchCapacity = Math.min(
    config.oil.channels.refine.unlimited
      ? Number.MAX_SAFE_INTEGER
      : limit(capacities.refine),
    (productMarketCapacity + Math.max(0, productStorageFree)) /
      Math.max(1e-9, config.oil.refineryYield),
  );

  const crude = routeCrude(config, batch, {
    exportCrude: config.oil.channels.export.unlimited
      ? Number.MAX_SAFE_INTEGER
      : limit(capacities.export.crude),
    domesticCrude: config.oil.channels.contract.unlimited
      ? Number.MAX_SAFE_INTEGER
      : limit(capacities.domestic.crude),
    refine: refineBatchCapacity,
    productRoom,
  }, prices, flowControl, span);

  const products = crude.byMarket.refine * config.oil.refineryYield;
  const productSale = allocateByPrice(products, [
    { key: 'export', price: prices.productExport, capacity: limit(capacities.export.products) },
    { key: 'domestic', price: prices.productDomestic, capacity: limit(capacities.domestic.products) },
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

/** Продажа имеющегося запаса по каналам; деньги считаются по фактическому объёму. */
export function sellOil(
  derived: DerivedStats,
  oil: number,
  dtSeconds: number,
  unlimited: Channel[] = ['contract'],
): { oil: number; gross: number; sold: number; byChannel: Record<Channel, number> } {
  const plan = allocateByPrice(Math.max(0, oil), (['contract', 'export', 'refine'] as Channel[]).map((channel) => ({
    key: channel,
    price: derived.channels[channel].price,
    capacity: unlimited.includes(channel)
      ? Number.POSITIVE_INFINITY
      : derived.channels[channel].rate * Math.max(0, dtSeconds),
  })));
  const byChannel = plan.byMarket;
  const sold = Object.values(byChannel).reduce((sum, tonnes) => sum + tonnes, 0);
  const gross = (Object.keys(byChannel) as Channel[]).reduce(
    (sum, channel) => sum + byChannel[channel] * derived.channels[channel].price,
    0,
  );
  return { oil: plan.remaining, gross, sold, byChannel };
}
