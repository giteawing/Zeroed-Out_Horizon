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
  OilFlows,
  Product,
  UpgradeDef,
} from '../types';

interface Market<Key extends string> {
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
function allocateByPrice<Key extends string>(
  volume: number,
  markets: readonly Market<Key>[],
): { byMarket: Record<Key, number>; remaining: number } {
  const byMarket = {} as Record<Key, number>;
  let remaining = volume;

  for (const market of [...markets].sort((a, b) => b.price - a.price)) {
    const taken = Math.min(remaining, market.capacity);
    byMarket[market.key] = taken;
    remaining -= taken;
  }

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
  const bonus = 1 + (def.effect.exportBonus ?? 0);
  return Math.max(0, tonnes * rate.price * bonus);
}

/**
 * Оценка потоков за секунду для панели.
 *
 * Приоритет сырья и продуктов одинаков: выше цена — раньше рынок получает
 * объём. Ограничения безлимитных каналов нормализуются до большого числа.
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
    modeShares?: Record<ExportMode, number>;
    prices?: {
      crudeDomestic: number;
      crudeExport: number;
      productDomestic: number;
      productExport: number;
    };
  } = {},
): OilFlows {
  const total = Math.max(0, produced);
  const safe = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, value) : Number.MAX_SAFE_INTEGER;

  const prices = options.prices ?? {
    crudeDomestic: 1,
    crudeExport: 1,
    productDomestic: 1,
    productExport: 1,
  };

  // НПЗ участвует в сравнении по цене получаемых нефтепродуктов.
  const refinePrice =
    prices.crudeExport *
    (config.oil.channels.refine.priceFactor /
      Math.max(1e-9, config.oil.channels.export.priceFactor));

  const crude = allocateByPrice(total, [
    {
      key: 'export',
      price: prices.crudeExport,
      capacity: config.oil.channels.export.unlimited
        ? Number.MAX_SAFE_INTEGER
        : safe(capacities.export.crude),
    },
    {
      key: 'refine',
      price: refinePrice,
      capacity: config.oil.channels.refine.unlimited
        ? Number.MAX_SAFE_INTEGER
        : safe(capacities.refine),
    },
    {
      key: 'domestic',
      price: prices.crudeDomestic,
      capacity: config.oil.channels.contract.unlimited
        ? Number.MAX_SAFE_INTEGER
        : safe(capacities.domestic.crude),
    },
  ]);

  const exportTonnes = crude.byMarket.export;
  const refined = crude.byMarket.refine;
  const domestic = crude.byMarket.domestic;
  const stored = crude.remaining;

  const productsProduced = refined * config.oil.refineryYield;
  const products = allocateByPrice(productsProduced, [
    { key: 'export', price: prices.productExport, capacity: safe(capacities.export.products) },
    { key: 'domestic', price: prices.productDomestic, capacity: safe(capacities.domestic.products) },
  ]);
  const productsDomestic = products.byMarket.domestic;
  const productsExport = products.byMarket.export;

  // Не проданные продукты хранятся в нефтебазах; превышение становится разливом.
  const productCapacity = Math.max(0, options.productStorage ?? config.product.baseStorage);
  const productsStored = Math.min(products.remaining, productCapacity);
  const productsSpill = products.remaining - productsStored;

  const shares = options.modeShares;
  const shareSum = shares
    ? Math.max(1e-9, shares.pipeline + shares.rail + shares.tanker)
    : 0;
  const exportByMode: Record<ExportMode, number> = shares && shareSum > 1
    ? {
      pipeline: exportTonnes * (shares.pipeline / shareSum),
      rail: exportTonnes * (shares.rail / shareSum),
      tanker: exportTonnes * (shares.tanker / shareSum),
    }
    : {
      pipeline: exportTonnes * Math.max(0, Math.min(1, options.pipeline ?? 0)),
      rail: 0,
      tanker: 0,
    };

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
    refineCapacity: safe(capacities.refine),
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
  prices: {
    crudeDomestic: number;
    crudeExport: number;
    productDomestic: number;
    productExport: number;
  } = { crudeDomestic: 1, crudeExport: 1, productDomestic: 1, productExport: 1 },
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
    Number.isFinite(value) ? Math.max(0, value) * span : Number.MAX_SAFE_INTEGER;

  const refinePrice =
    prices.crudeExport *
    (config.oil.channels.refine.priceFactor /
      Math.max(1e-9, config.oil.channels.export.priceFactor));

  const crude = allocateByPrice(batch, [
    {
      key: 'export',
      price: prices.crudeExport,
      capacity: config.oil.channels.export.unlimited
        ? Number.MAX_SAFE_INTEGER
        : limit(capacities.export.crude),
    },
    {
      key: 'refine',
      price: refinePrice,
      capacity: config.oil.channels.refine.unlimited
        ? Number.MAX_SAFE_INTEGER
        : limit(capacities.refine),
    },
    {
      key: 'domestic',
      price: prices.crudeDomestic,
      capacity: config.oil.channels.contract.unlimited
        ? Number.MAX_SAFE_INTEGER
        : limit(capacities.domestic.crude),
    },
  ]);

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
  const byChannel: Record<Channel, number> = { contract: 0, export: 0, refine: 0 };
  const order: Channel[] = ['refine', 'export', 'contract'];
  let left = oil;
  let gross = 0;
  let sold = 0;

  for (const channel of order) {
    if (left <= 0) break;
    const rate = derived.channels[channel];
    const available = unlimited.includes(channel) ? left : rate.rate * dtSeconds;
    const taken = Math.min(left, available);
    if (taken <= 0) continue;
    byChannel[channel] += taken;
    left -= taken;
    sold += taken;
    gross += taken * rate.price;
  }

  return { oil: left, gross, sold, byChannel };
}
