/**
 * Рыночная модель: добыча, цены, мощности, распределение и валовая выручка.
 * Не изменяет состояние и не начисляет деньги.
 */
import type {
  Channel,
  ChannelRate,
  Content,
  ExportMode,
  GameConfig,
  GameState,
  Product,
} from '../../types';
import { CHANNELS } from '../definitions';
import { hasFullCrew, productCapacityOf, wellsTonnesPerSecond } from '../production';
import { oilFlowsOf } from '../sales';
import type { UpgradeEffects } from './effects';

export interface MarketStats {
  tapValue: number;
  crew: boolean;
  oilPerSecond: number;
  oilPricePerTon: number;
  exchangeRate: number;
  channels: Record<Channel, ChannelRate>;
  domesticPricePerTon: number;
  exportPricePerTon: number;
  productPriceDomestic: number;
  productPriceExport: number;
  capacities: {
    domestic: Record<Product, number>;
    export: Record<Product, number>;
    refine: number;
  };
  exportCapacityByMode: Record<ExportMode, number>;
  hasPipeline: boolean;
  productStorage: number;
  flows: ReturnType<typeof oilFlowsOf>;
  grossPerSecond: number;
}
/** Рассчитывает добычу, цены, мощности рынков, потоки и валовую выручку. */
export function calculateMarket(
  config: GameConfig,
  state: GameState,
  effects: UpgradeEffects,
  content: Content | null,
): MarketStats {
  const tapValue = Math.max(0.1, effects.tapFlat * effects.multTap * config.balance.tapScale);
  const crew = hasFullCrew(config, state);
  const crewMultiplier = crew ? 1 + config.oil.autoDrill.bonus : 1;
  // Контракты и экспортные договорённости открывают рынок для дополнительного
  // объёма добычи. Это рост реализуемых тонн, а не повышение цены за тонну.
  const salesVolumeMultiplier = 1 + Math.max(
    effects.throughputBonus.contract,
    effects.throughputBonus.export,
  );
  const rawOilPerSecond =
    wellsTonnesPerSecond(config, state) *
    effects.multPassive *
    config.balance.passiveScale *
    crewMultiplier *
    salesVolumeMultiplier;
  // Защита экономики от экстремальных комбинаций апгрейдов и старых сейвов.
  const productionLimit = Math.max(0, config.oil.maxProductionPerSecond);
  const oilPerSecond = Math.min(productionLimit, rawOilPerSecond);

  // Мировая котировка остаётся базовой. Внутренний рынок получает только
  // внутреннюю надбавку; экспорт пересчитывается в нефтефантики по курсу.
  const oilPricePerTon = config.oil.basePricePerTon * state.worldPrice * effects.priceMultiplier;
  const exchangeRate = config.exchangeRate.initial * effects.exchangeRateMultiplier;
  const domesticOilPricePerTon = oilPricePerTon * effects.domesticPriceMultiplier;
  const exportOilPricePerTon = oilPricePerTon * exchangeRate * effects.exportPriceMultiplier;
  const channels = {} as Record<Channel, ChannelRate>;

  for (const channel of CHANNELS) {
    const channelConfig = config.oil.channels[channel];
    const rate = Math.max(0, channelConfig.baseRate + effects.rateFlat[channel]) *
      (1 + effects.throughputBonus[channel]);
    const channelOilPrice = channel === 'export' ? exportOilPricePerTon : domesticOilPricePerTon;
    const price = channelOilPrice * channelConfig.priceFactor * (1 + effects.priceBonus[channel]);
    const boostedRate = channel === 'export' ? rate * effects.exportMultiplier : rate;
    channels[channel] = { rate: boostedRate, price, sold: boostedRate };
  }

  const domesticPricePerTon = channels.contract.price;
  const exportPricePerTon = channels.export.price;
  const producedPerSecond = Math.min(
    productionLimit,
    oilPerSecond + tapValue * effects.autoTaps,
  );
  const split = config.product.transportSplit;

  // Базовая мощность распределяется по transportSplit; бонусы покупок уже
  // размечены по товарам и прибавляются только к назначенному рынку.
  // Базовая мощность — отдельная величина. Не вычитаем из неё бонусы,
  // потому что одна покупка может расширять оба товарных потока.
  const domesticBase = Math.max(0, config.oil.channels.contract.baseRate);
  const exportBase = Math.max(0, config.oil.channels.export.baseRate);
  const domesticScale = 1 + effects.throughputBonus.contract;
  const exportScale = (1 + effects.throughputBonus.export) * effects.exportMultiplier;

  const capacities = {
    domestic: {
      crude: config.oil.channels.contract.unlimited
        ? Number.POSITIVE_INFINITY
        : (domesticBase * split.crude + effects.rateByProduct.contract.crude) * domesticScale,
      products: (domesticBase * split.productDomestic + effects.rateByProduct.contract.products) * domesticScale,
    },
    export: {
      crude: (exportBase * split.crude + effects.rateByProduct.export.crude) * exportScale,
      products: (exportBase * split.productExport + effects.rateByProduct.export.products) * exportScale,
    },
    refine: channels.refine.rate,
  };

  // Способы доставки нормируются только на мощность вывоза сырой нефти.
  // Наливные терминалы продуктов не создают фиктивные танкеры для нефти.
  const rawModes = effects.exportRateByMode.pipeline +
    effects.exportRateByMode.rail + effects.exportRateByMode.tanker;
  const modeScale = rawModes > 1e-9 ? capacities.export.crude / rawModes : 0;
  const exportCapacityByMode: Record<ExportMode, number> = {
    pipeline: effects.exportRateByMode.pipeline * modeScale,
    rail: effects.exportRateByMode.rail * modeScale,
    tanker: effects.exportRateByMode.tanker * modeScale,
  };
  const pipelineShare = capacities.export.crude > 0
    ? exportCapacityByMode.pipeline / capacities.export.crude
    : 0;
  const hasPipeline = exportCapacityByMode.pipeline > 0;

  const productStorage = content
    ? productCapacityOf(config, content, state)
    : config.product.baseStorage;
  const productPriceDomestic = domesticOilPricePerTon * config.product.domesticPriceFactor;
  const productPriceExport = exportOilPricePerTon * config.product.exportPriceFactor;

  // Пакетная отгрузка использует мощности за весь закрываемый интервал
  // (Game.tickShipping → allocateBatch), а не только оставшееся время
  // до его границы. Иначе старый запас преждевременно блокирует НПЗ
  // в конце каждого окна, хотя рынок ещё способен принять свежий выпуск.
  const shipmentWindowSeconds = Math.max(
    0.001,
    config.oil.shipDays * config.oil.wells.secondsPerDay,
  );
  const productStorageFree = Math.max(0, productStorage - state.products);
  const flows = oilFlowsOf(config, capacities, producedPerSecond, {
    prices: {
      crudeDomestic: channels.contract.price,
      crudeExport: channels.export.price,
      productDomestic: productPriceDomestic,
      productExport: productPriceExport,
    },
    pipeline: pipelineShare,
    productStorage,
    productStorageFree,
    productInventory: state.products,
    storageHorizonSeconds: shipmentWindowSeconds,
    modeShares: exportCapacityByMode,
  });

  const grossPerSecond =
    flows.domestic * channels.contract.price +
    flows.export * channels.export.price +
    flows.productsDomestic * productPriceDomestic +
    flows.productsExport * productPriceExport;

  return {
    tapValue,
    crew,
    oilPerSecond,
    oilPricePerTon,
    exchangeRate,
    channels,
    domesticPricePerTon,
    exportPricePerTon,
    productPriceDomestic,
    productPriceExport,
    capacities,
    exportCapacityByMode,
    hasPipeline,
    productStorage,
    flows,
    grossPerSecond,
  };
}
