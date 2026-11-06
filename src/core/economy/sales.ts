/**
 * Сбыт: распределение нефти и нефтепродуктов между рынками.
 * Функции планируют продажи, но не меняют состояние и не начисляют деньги.
 */
import type { Channel, DerivedStats, ExportMode, GameConfig, OilFlows, Product, UpgradeDef } from '../types';

export function exportTonnes(config: GameConfig, derived: DerivedStats, oil: number): number {
  const want = derived.channels.export.rate * config.oil.exportBurstSeconds;
  return Math.min(oil, Math.max(0, want));
}

/** Деньги за продажу тонн через канал (с учётом мировой цены и терминалов). */
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

/** Распределяет фактическую добычу между рынками по доступной мощности и цене. */

export function oilFlowsOf(
  config: GameConfig,
  capacities: {
    domestic: Record<Product, number>;
    export: Record<Product, number>;
    refine: number;
  },
  produced: number,
  /** Цены и доли, от которых зависит, куда уйдёт товар. */
  options: {
    pipeline?: number;
    productStorage?: number;
    modeShares?: Record<ExportMode, number>;
    /** Цены за тонну: по ним выбирается более выгодный рынок. */
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

  /*
   * «Поставки автоматически перераспределяются на более выгодные рынки».
   *
   * Раньше порядок был жёстко зашит (экспорт → переработка → внутренний), и
   * при падении экспортных цен игрок молча получал меньше денег. Теперь
   * каналы сортируются по цене: где дороже — тот и забирает первым, а
   * заполненный канал отдаёт остаток следующему.
   */
  const prices = options.prices ?? {
    crudeDomestic: 1,
    crudeExport: 1,
    productDomestic: 1,
    productExport: 1,
  };

  // Сырая нефть: рынок + переработка (НПЗ платит своей ценой за тонну).
  const crudeMarkets = [
    { key: 'export' as const, price: prices.crudeExport, capacity: config.oil.channels.export.unlimited ? Number.POSITIVE_INFINITY : safe(capacities.export.crude) },
    { key: 'refine' as const, price: prices.crudeExport, capacity: config.oil.channels.refine.unlimited ? Number.POSITIVE_INFINITY : safe(capacities.refine) },
    { key: 'domestic' as const, price: prices.crudeDomestic, capacity: config.oil.channels.contract.unlimited ? Number.POSITIVE_INFINITY : safe(capacities.domestic.crude) },
  ];
  // Переработка не «покупает» сырьё по цене экспорта: её выгода — продукты,
  // поэтому в сравнении цен она участвует ценой переработки (refine.priceFactor).
  crudeMarkets[1].price = prices.crudeExport * (config.oil.channels.refine.priceFactor /
    Math.max(1e-9, config.oil.channels.export.priceFactor));
  crudeMarkets.sort((a, b) => b.price - a.price);

  let rest = total;
  const crudeByMarket: Record<'domestic' | 'export' | 'refine', number> = {
    domestic: 0,
    export: 0,
    refine: 0,
  };
  for (const market of crudeMarkets) {
    const take = Math.min(rest, market.capacity);
    crudeByMarket[market.key] = take;
    rest -= take;
  }
  const exportTonnes = crudeByMarket.export;
  const refined = crudeByMarket.refine;
  const domestic = crudeByMarket.domestic;
  // Остаток — это не «пропащая» нефть, а та, что легла в резервуары.
  const stored = rest;

  /*
   * Нефтепродукты: те же два рынка, тоже по цене. Переработка здесь не
   * участвует — продукты уже произведены.
   */
  const productsProduced = refined * config.oil.refineryYield;
  const productMarkets = [
    { key: 'export' as const, price: prices.productExport, capacity: safe(capacities.export.products) },
    { key: 'domestic' as const, price: prices.productDomestic, capacity: safe(capacities.domestic.products) },
  ].sort((a, b) => b.price - a.price);

  let productRest = productsProduced;
  const productsByMarket: Record<'domestic' | 'export', number> = { domestic: 0, export: 0 };
  for (const market of productMarkets) {
    const take = Math.min(productRest, market.capacity);
    productsByMarket[market.key] = take;
    productRest -= take;
  }
  const productsDomestic = productsByMarket.domestic;
  const productsExport = productsByMarket.export;
  /*
   * Остаток не продаётся — он лежит на нефтебазах и ждёт свободного рынка.
   * Если места на складе нет, лишнее разливается и штрафуется; выручки нет.
   */
  const storeRoom = Math.max(0, options.productStorage ?? config.product.baseStorage);
  const productsStored = Math.min(productRest, storeRoom);
  const productsSpill = productRest - productsStored;

  /*
   * Разбивка экспорта по видам транспорта. Доли берём из фактических
   * мощностей построек (труба, поезда, танкеры), поэтому сумма всегда равна
   * exportTonnes, а строки в панели сходятся с общим экспортом.
   */
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
    // Остаток остаётся в резервуарах: его видно игроку, он не «сгорает».
    backlog: stored,
    refineCapacity: safe(capacities.refine),
    domesticCapacity: safe(capacities.domestic.crude),
    exportCapacity: safe(capacities.export.crude),
    productCapacity: Math.max(0, options.productStorage ?? config.product.baseStorage),
  };
}

/**
 * Разложить партию нефти по мощностям каналов.
 *
 * Одна и та же функция считает и таблицу в интерфейсе, и реальную отправку
 * партии в движке, поэтому цифры на экране всегда совпадают с деньгами.
 * `seconds` — за сколько секунд накопилась партия: за это время канал
 * успевает принять `мощность · seconds` тонн.
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
  /** Цены за тонну: по ним выбирается, какой рынок выгоднее. */
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

  /*
   * Тот же приоритет, что и в таблице: поставки идут на более выгодный рынок,
   * а заполненный канал отдаёт остаток следующему. Порядок не зашит —
   * считается из текущих цен, поэтому и деньги, и экран ведут себя одинаково.
   */
  const refinePrice = prices.crudeExport * (config.oil.channels.refine.priceFactor /
    Math.max(1e-9, config.oil.channels.export.priceFactor));
  const crudeMarkets = [
    { key: 'export' as const, price: prices.crudeExport, capacity: config.oil.channels.export.unlimited ? Number.POSITIVE_INFINITY : limit(capacities.export.crude) },
    { key: 'refine' as const, price: refinePrice, capacity: config.oil.channels.refine.unlimited ? Number.POSITIVE_INFINITY : limit(capacities.refine) },
    { key: 'domestic' as const, price: prices.crudeDomestic, capacity: config.oil.channels.contract.unlimited ? Number.POSITIVE_INFINITY : limit(capacities.domestic.crude) },
  ].sort((a, b) => b.price - a.price);

  let left = batch;
  const crude: Record<'domestic' | 'export' | 'refine', number> = { domestic: 0, export: 0, refine: 0 };
  for (const market of crudeMarkets) {
    const take = Math.min(left, market.capacity);
    crude[market.key] = take;
    left -= take;
  }

  const products = crude.refine * config.oil.refineryYield;
  const productMarkets = [
    { key: 'export' as const, price: prices.productExport, capacity: limit(capacities.export.products) },
    { key: 'domestic' as const, price: prices.productDomestic, capacity: limit(capacities.domestic.products) },
  ].sort((a, b) => b.price - a.price);

  let productLeft = products;
  const sold: Record<'domestic' | 'export', number> = { domestic: 0, export: 0 };
  for (const market of productMarkets) {
    const take = Math.min(productLeft, market.capacity);
    sold[market.key] = take;
    productLeft -= take;
  }

  return {
    domestic: crude.domestic,
    export: crude.export,
    refined: crude.refine,
    products,
    productsDomestic: sold.domestic,
    productsExport: sold.export,
    rest: left,
  };
}

/**
 * Сколько нефти реально можно продать за dt секунд при текущем запасе.
 * Возвращает по каналам: тонны и деньги. Каналы делят запас по приоритету
 * «дорогой сначала» — так игроку выгодно строить НПЗ.
 */
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
    // Контракты «на разлив» берут всё, что не забрали дорогие каналы.
    const want = unlimited.includes(channel) ? left : rate.rate * dtSeconds;
    const take = Math.min(left, want);
    if (take <= 0) continue;
    byChannel[channel] += take;
    left -= take;
    sold += take;
    gross += take * rate.price;
  }
  return { oil: left, gross, sold, byChannel };
}
