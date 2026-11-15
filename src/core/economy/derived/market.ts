/**
 * Рыночная модель: добыча, цены, мощности, распределение и валовая выручка.
 * Не изменяет состояние и не начисляет деньги.
 */
import type {
  Channel,
  ChannelRate,
  Content,
  DerivedStats,
  ExportMode,
  FlowKey,
  GameConfig,
  GameState,
  Product,
  RefineryStats,
  UpgradeDef,
  Well,
} from '../../types';
import { CHANNELS } from '../definitions';
import { refineryStatsOf } from '../refineries';
import { hasFullCrew, productCapacityOf, wellDeclineFactor, wellsDailyTonnes, wellsTonnesPerSecond } from '../production';
import { levelOf } from '../purchases';
import { oilFlowsOf } from '../sales';
import { collectUpgradeEffects, type UpgradeEffects } from './effects';

export interface MarketStats {
  crew: boolean;
  /** Множитель добычи от договоров о сбыте (REVIEW A5). */
  salesVolumeMultiplier: number;
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
  /** Физический максимум каждого направления с учётом остальных фиксированных заявок. */
  flowLimits: Record<FlowKey, number>;
  exportCapacityByMode: Record<ExportMode, number>;
  hasPipeline: boolean;
  productStorage: number;
  refineries: RefineryStats;
  flows: ReturnType<typeof oilFlowsOf>;
  grossPerSecond: number;
}
/** Рассчитывает добычу, цены, мощности рынков, потоки и валовую выручку. */
export function calculateMarket(
  config: GameConfig,
  state: GameState,
  effects: UpgradeEffects,
  upgrades: UpgradeDef[],
  content: Content | null,
): MarketStats {
  const crew = hasFullCrew(config, state);
  const crewMultiplier = crew ? 1 + config.oil.autoDrill.bonus : 1;
  // Контракты и экспортные договорённости открывают рынок для дополнительного
  // объёма добычи. Это рост реализуемых тонн, а не повышение цены за тонну.
  // Итоги двух направлений не складываются: добычу умножает больший из них,
  // а свой рынок расширяет каждый (см. `channels` и `capacities` ниже).
  // Механика задуманная и описана игроку: «Правила», строка панели
  // «множитель от договоров», docs/ECONOMY.md. Тест: tests/sales-volume.test.ts.
  const salesVolumeMultiplier = 1 + Math.max(
    effects.throughputBonus.contract,
    effects.throughputBonus.export,
  );
  const oilPerSecond =
    (
      wellsTonnesPerSecond(config, state) * effects.multPassive * crewMultiplier +
      effects.productionFlat * effects.multProduction
    ) *
    config.balance.passiveScale *
    salesVolumeMultiplier;

  // Мировая котировка остаётся базовой. Внутренний рынок получает только
  // внутреннюю надбавку; экспорт пересчитывается в нефтефаники по курсу.
  const oilPricePerTon = config.oil.basePricePerTon * state.worldPrice * effects.priceMultiplier;
  const exchangeRate = config.exchangeRate.initial * effects.exchangeRateMultiplier;
  const domesticOilPricePerTon = oilPricePerTon * effects.domesticPriceMultiplier;
  const exportOilPricePerTon = oilPricePerTon * exchangeRate * effects.exportPriceMultiplier;
  const channels = {} as Record<Channel, ChannelRate>;

  const productPriceDomestic = domesticOilPricePerTon * config.product.domesticPriceFactor;
  const productPriceExport = exportOilPricePerTon * config.product.exportPriceFactor;
  const crudePrice = (channel: 'contract' | 'export'): number =>
    (channel === 'export' ? exportOilPricePerTon : domesticOilPricePerTon) *
    config.oil.channels[channel].priceFactor *
    (1 + effects.priceBonus[channel]);
  const priceOf: Record<Channel, number> = {
    contract: crudePrice('contract'),
    export: crudePrice('export'),
    // После расчёта парка подставим максимальную предельную выгоду НПЗ.
    refine: 0,
  };

  for (const channel of CHANNELS) {
    const channelConfig = config.oil.channels[channel];
    const rate = Math.max(0, channelConfig.baseRate + effects.rateFlat[channel]) *
      (1 + effects.throughputBonus[channel]);
    const boostedRate = channel === 'export' ? rate * effects.exportMultiplier : rate;
    channels[channel] = { rate: boostedRate, price: priceOf[channel], sold: boostedRate };
  }

  const refineries = refineryStatsOf(upgrades, state, config.oil.refineryYield, channels.refine.rate);
  // Трубы и вспомогательное оборудование не перерабатывают нефть сами.
  if (refineries.plantCount === 0) channels.refine.rate = 0;
  channels.refine.sold = channels.refine.rate;
  const bestDepth = refineries.units.reduce((best, unit) => Math.max(best, unit.depth), 0);
  channels.refine.price = bestDepth * Math.max(productPriceDomestic, productPriceExport);

  const domesticPricePerTon = channels.contract.price;
  const exportPricePerTon = channels.export.price;
  const producedPerSecond = oilPerSecond;
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
    flowControl: state.flowControl,
    refineries: refineries.units,
  });

  const grossPerSecond =
    flows.domestic * channels.contract.price +
    flows.export * channels.export.price +
    flows.productsDomestic * productPriceDomestic +
    flows.productsExport * productPriceExport;

  const fixed = state.flowControl;
  const fixedOther = (exclude: Channel): number =>
    (['contract', 'export', 'refine'] as Channel[])
      .filter((channel) => channel !== exclude && fixed[channel].mode === 'fixed')
      .reduce((sum, channel) => sum + fixed[channel].value, 0);
  const flowLimits: Record<FlowKey, number> = {
    contract: Math.min(
      config.oil.channels.contract.unlimited ? Number.POSITIVE_INFINITY : capacities.domestic.crude,
      Math.max(0, producedPerSecond - fixedOther('contract')),
    ),
    export: Math.min(
      capacities.export.crude,
      Math.max(0, producedPerSecond - fixedOther('export')),
    ),
    refine: Math.min(
      flows.refineCapacity,
      Math.max(0, producedPerSecond - fixedOther('refine')),
    ),
    // «Логистика»: рынки нефтепродуктов настраиваются так же, как сырьё.
    productDomestic: capacities.domestic.products,
    productExport: capacities.export.products,
  };

  return {
    crew,
    salesVolumeMultiplier,
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
    refineries,
    flows,
    flowLimits,
    grossPerSecond,
  };
}

export interface MarketUpgradeContribution {
  id: string;
  level: number;
  rate: number;
}

export interface ContractUpgradeContribution {
  id: string;
  level: number;
  percent: number;
}

export interface CrudeStatsBreakdown {
  production: {
    oilPerSecond: number;
    wellsCount: number;
    wellsCurrentDaily: number;
    wellsLaunchDaily: number;
    declineFactor: number;
    crewMultiplier: number;
    equipmentMultiplier: number;
    equipmentFlat: number;
    salesVolumeMultiplier: number;
    countsByKind: Record<Well['kind'], number>;
  };
  domesticMarket: {
    crude: {
      used: number;
      total: number;
      free: number;
      unlimited: boolean;
      base: number;
      upgrades: number;
      multiplier: number;
      items: MarketUpgradeContribution[];
    };
    products: {
      used: number;
      total: number;
      free: number;
      base: number;
      upgrades: number;
      multiplier: number;
      items: MarketUpgradeContribution[];
    };
  };
  exportMarket: {
    crude: {
      used: number;
      total: number;
      free: number;
      base: number;
      upgrades: number;
      contractMultiplier: number;
      extraMultiplier: number;
      items: MarketUpgradeContribution[];
      modes: Record<ExportMode, { used: number; total: number }>;
    };
    products: {
      used: number;
      total: number;
      free: number;
      base: number;
      upgrades: number;
      contractMultiplier: number;
      extraMultiplier: number;
      items: MarketUpgradeContribution[];
    };
  };
  contracts: {
    multiplier: number;
    domesticBonus: number;
    exportBonus: number;
    leading: 'contract' | 'export' | 'tie' | 'none';
    domesticItems: ContractUpgradeContribution[];
    exportItems: ContractUpgradeContribution[];
  };
}

/** Сводка добычи, скважин, рынков сбыта и договоров для окна подробной статистики. */
export function crudeStatsBreakdown(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  derived: DerivedStats,
): CrudeStatsBreakdown {
  const effects = collectUpgradeEffects(upgrades, state);
  const declineFactor = wellDeclineFactor(config, state);
  const countsByKind: Record<Well['kind'], number> = { ordinary: 0, good: 0, unique: 0 };
  for (const well of state.wells) countsByKind[well.kind] += 1;

  const domesticBase = Math.max(0, config.oil.channels.contract.baseRate);
  const exportBase = Math.max(0, config.oil.channels.export.baseRate);
  const split = config.product.transportSplit;
  const domesticScale = 1 + effects.throughputBonus.contract;
  const exportContractScale = 1 + effects.throughputBonus.export;
  const exportExtraScale = effects.exportMultiplier;

  const domesticCrudeItems: MarketUpgradeContribution[] = [];
  const domesticProductsItems: MarketUpgradeContribution[] = [];
  const exportCrudeItems: MarketUpgradeContribution[] = [];
  const exportProductsItems: MarketUpgradeContribution[] = [];
  const domesticContractItems: ContractUpgradeContribution[] = [];
  const exportContractItems: ContractUpgradeContribution[] = [];

  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0 || def.type !== 'sell') continue;
    const channel = def.effect.channel ?? 'contract';
    const e = def.effect;
    if (e.value) {
      const crudeShare = e.channelSplit ? (e.channelSplit.crude ?? 0) : 1;
      const productsShare = e.channelSplit ? (e.channelSplit.products ?? 0) : 1;
      if (channel === 'contract') {
        if (crudeShare > 0) domesticCrudeItems.push({ id: def.id, level, rate: e.value * level * crudeShare });
        if (productsShare > 0) domesticProductsItems.push({ id: def.id, level, rate: e.value * level * productsShare });
      } else if (channel === 'export') {
        if (crudeShare > 0) exportCrudeItems.push({ id: def.id, level, rate: e.value * level * crudeShare });
        if (productsShare > 0) exportProductsItems.push({ id: def.id, level, rate: e.value * level * productsShare });
      }
    }
    if (e.percent) {
      const percent = e.percent * level;
      if (channel === 'contract') domesticContractItems.push({ id: def.id, level, percent });
      else if (channel === 'export') exportContractItems.push({ id: def.id, level, percent });
    }
  }

  const domesticBonus = effects.throughputBonus.contract;
  const exportBonus = effects.throughputBonus.export;
  const leading: CrudeStatsBreakdown['contracts']['leading'] =
    domesticBonus <= 0 && exportBonus <= 0 ? 'none' :
    Math.abs(domesticBonus - exportBonus) < 1e-9 ? 'tie' :
    domesticBonus > exportBonus ? 'contract' : 'export';

  const domCrudeTotal = derived.capacities.domestic.crude;
  const domProdTotal = derived.capacities.domestic.products;
  const expCrudeTotal = derived.capacities.export.crude;
  const expProdTotal = derived.capacities.export.products;

  return {
    production: {
      oilPerSecond: derived.oilPerSecond,
      wellsCount: state.wells.length,
      wellsCurrentDaily: wellsDailyTonnes(state, config),
      wellsLaunchDaily: wellsDailyTonnes(state),
      declineFactor,
      crewMultiplier: derived.autoDrill ? 1 + config.oil.autoDrill.bonus : 1,
      equipmentMultiplier: effects.multPassive,
      equipmentFlat: effects.productionFlat,
      salesVolumeMultiplier: derived.salesVolumeMultiplier,
      countsByKind,
    },
    domesticMarket: {
      crude: {
        used: derived.flows.domestic,
        total: domCrudeTotal,
        free: Number.isFinite(domCrudeTotal) ? Math.max(0, domCrudeTotal - derived.flows.domestic) : Number.POSITIVE_INFINITY,
        unlimited: Boolean(config.oil.channels.contract.unlimited),
        base: domesticBase * split.crude,
        upgrades: effects.rateByProduct.contract.crude,
        multiplier: domesticScale,
        items: domesticCrudeItems,
      },
      products: {
        used: derived.flows.productsDomestic,
        total: domProdTotal,
        free: Math.max(0, domProdTotal - derived.flows.productsDomestic),
        base: domesticBase * split.productDomestic,
        upgrades: effects.rateByProduct.contract.products,
        multiplier: domesticScale,
        items: domesticProductsItems,
      },
    },
    exportMarket: {
      crude: {
        used: derived.flows.export,
        total: expCrudeTotal,
        free: Math.max(0, expCrudeTotal - derived.flows.export),
        base: exportBase * split.crude,
        upgrades: effects.rateByProduct.export.crude,
        contractMultiplier: exportContractScale,
        extraMultiplier: exportExtraScale,
        items: exportCrudeItems,
        modes: {
          pipeline: { used: derived.flows.exportByMode.pipeline, total: derived.exportCapacityByMode.pipeline },
          rail: { used: derived.flows.exportByMode.rail, total: derived.exportCapacityByMode.rail },
          tanker: { used: derived.flows.exportByMode.tanker, total: derived.exportCapacityByMode.tanker },
        },
      },
      products: {
        used: derived.flows.productsExport,
        total: expProdTotal,
        free: Math.max(0, expProdTotal - derived.flows.productsExport),
        base: exportBase * split.productExport,
        upgrades: effects.rateByProduct.export.products,
        contractMultiplier: exportContractScale,
        extraMultiplier: exportExtraScale,
        items: exportProductsItems,
      },
    },
    contracts: {
      multiplier: derived.salesVolumeMultiplier,
      domesticBonus,
      exportBonus,
      leading,
      domesticItems: domesticContractItems,
      exportItems: exportContractItems,
    },
  };
}
