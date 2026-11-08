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
  const oilPerSecond =
    wellsTonnesPerSecond(config, state) *
    effects.multPassive *
    config.balance.passiveScale *
    crewMultiplier *
    salesVolumeMultiplier;

  const oilPricePerTon = config.oil.basePricePerTon * state.worldPrice * effects.priceMultiplier;
  const channels = {} as Record<Channel, ChannelRate>;

  for (const channel of CHANNELS) {
    const channelConfig = config.oil.channels[channel];
    const rate = Math.max(0, channelConfig.baseRate + effects.rateFlat[channel]) *
      (1 + effects.throughputBonus[channel]);
    const price = oilPricePerTon * channelConfig.priceFactor * (1 + effects.priceBonus[channel]);
    const boostedRate = channel === 'export' ? rate * effects.exportMultiplier : rate;
    channels[channel] = { rate: boostedRate, price, sold: boostedRate };
  }

  const domesticPricePerTon = channels.contract.price;
  const exportPricePerTon = channels.export.price;
  const producedPerSecond = oilPerSecond + tapValue * effects.autoTaps;
  const split = config.product.transportSplit;

  // Базовая мощность распределяется по transportSplit; бонусы покупок уже
  // размечены по товарам и прибавляются только к назначенному рынку.
  const domesticBase = Math.max(
    0,
    channels.contract.rate -
      effects.rateByProduct.contract.crude -
      effects.rateByProduct.contract.products,
  );
  const exportBase = Math.max(
    0,
    channels.export.rate -
      effects.rateByProduct.export.crude -
      effects.rateByProduct.export.products,
  );

  const capacities = {
    domestic: {
      crude: config.oil.channels.contract.unlimited
        ? Number.POSITIVE_INFINITY
        : domesticBase * split.crude + effects.rateByProduct.contract.crude,
      products: domesticBase * split.productDomestic + effects.rateByProduct.contract.products,
    },
    export: {
      crude: exportBase * split.crude + effects.rateByProduct.export.crude,
      products: exportBase * split.productExport + effects.rateByProduct.export.products,
    },
    refine: channels.refine.rate,
  };

  const pipelineShare = channels.export.rate > 0
    ? effects.exportRateByMode.pipeline / channels.export.rate
    : 0;
  const hasPipeline = effects.exportRateByMode.pipeline > 0;
  const rawModes = Math.max(
    1e-9,
    effects.exportRateByMode.pipeline +
      effects.exportRateByMode.rail +
      effects.exportRateByMode.tanker,
  );
  const modeScale = channels.export.rate / rawModes;
  const exportCapacityByMode: Record<ExportMode, number> = {
    pipeline: effects.exportRateByMode.pipeline * modeScale,
    rail: effects.exportRateByMode.rail * modeScale,
    tanker: effects.exportRateByMode.tanker * modeScale,
  };

  const productStorage = content
    ? productCapacityOf(config, content, state)
    : config.product.baseStorage;
  const productPriceDomestic = oilPricePerTon * config.product.domesticPriceFactor;
  const productPriceExport = oilPricePerTon * config.product.exportPriceFactor;

  const flows = oilFlowsOf(config, capacities, producedPerSecond, {
    prices: {
      crudeDomestic: channels.contract.price,
      crudeExport: channels.export.price,
      productDomestic: productPriceDomestic,
      productExport: productPriceExport,
    },
    pipeline: pipelineShare,
    productStorage,
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
