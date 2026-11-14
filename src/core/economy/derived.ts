/**
 * Сборка публичного снимка экономики.
 * Вычисления делегированы effects, market и financial-rates.
 */
import type { AssetKind, Content, DerivedStats, GameConfig, GameState, UpgradeDef } from '../types';
import {
  INVESTMENT_RATE_MAX_PERCENT,
  INVESTMENT_RATE_MIN_PERCENT,
  INVESTMENT_YEAR_DAYS,
  type TaxBuff,
} from './definitions';
import { adjustCurrencyCost, levelOf, winRequirementBlocker } from './purchases';
import { lowRateWellCount, oilCapacityOf } from './production';
import { assetCountsOf, assetsValueOf } from './assets';
import { collectUpgradeEffects } from './derived/effects';
import { calculateMarket } from './derived/market';
import { calculateFinancialRates } from './derived/financial-rates';

/** Публичная точка входа: объединяет эффекты, рынок и финансовые показатели. */
export function computeDerived(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  buffs: readonly TaxBuff[] = [],
  content: Content | null = null,
): DerivedStats {
  // Временные TaxBuff намеренно не участвуют в ставке налога.
  void buffs;

  const effects = collectUpgradeEffects(upgrades, state);
  const market = calculateMarket(config, state, effects, upgrades, content);
  // Демпфер компенсирует разницу цен нефтепродуктов, проданных внутри страны.
  const damperIncomePerSecond = effects.fuelDamperEnabled
    ? Math.max(0, market.productPriceExport - market.productPriceDomestic) * market.flows.productsDomestic
    : 0;
  const capitalFlightElapsedMinutes = state.capitalFlightStartedAtMs === null
    ? 0
    : Math.max(0, state.clockMs - state.capitalFlightStartedAtMs) / 60_000;
  const capitalFlightIncomePerSecond = effects.capitalFlightPerSecond > 0 && state.capitalFlightStartedAtMs !== null
    ? effects.capitalFlightPerSecond * (1 + capitalFlightElapsedMinutes * effects.capitalFlightGrowthPerMinute)
    : 0;
  // Влияние одинаково для ставки по счёту и для налоговых вычетов.
  const baseFinance = calculateFinancialRates(config, state, effects, market.grossPerSecond, 0);
  const influenceShare = Math.min(1, Math.max(0, baseFinance.influence / Math.max(1, config.influence.cap)));
  // Годовая ставка зависит от влияния (INVESTMENT_RATE_*); начисление ежедневно.
  // Игровой день занимает config.oil.wells.secondsPerDay реальных секунд.
  const investmentRatePercent = INVESTMENT_RATE_MIN_PERCENT +
    (INVESTMENT_RATE_MAX_PERCENT - INVESTMENT_RATE_MIN_PERCENT) * influenceShare;
  const investmentIncomePerSecond = Math.max(0, state.coins) *
    (investmentRatePercent / 100) /
    (INVESTMENT_YEAR_DAYS * Math.max(1e-6, config.oil.wells.secondsPerDay));
  // Проценты на остаток облагаются налогом, как и продажи.
  const finance = calculateFinancialRates(
    config, state, effects, market.grossPerSecond, investmentIncomePerSecond,
  );
  const assetCounts = assetCountsOf(upgrades, state);
  /*
   * Налоговые вычеты — не покупки, а правила: пока есть НПЗ или истощённые
   * скважины, вычет начисляется сам. Оба растут с влиянием и приходят мимо
   * налога на прибыль: в панели они стоят ниже налога и прибавляются к
   * чистой прибыли.
   */
  const reverseExcise = config.deductions?.reverseExcise;
  const reverseExciseIncomePerSecond = reverseExcise && assetCounts.refinery > 0
    ? market.flows.productsDomestic * market.productPriceDomestic *
      Math.max(0, reverseExcise.domesticShare) *
      (1 + Math.max(0, reverseExcise.influenceGain) * influenceShare)
    : 0;
  const ndpi = config.deductions?.ndpi;
  const lowRateWells = lowRateWellCount(config, state);
  const ndpiDeductionIncomePerSecond = ndpi
    ? lowRateWells * Math.max(0, ndpi.perWellPerSecond) *
      (1 + Math.max(0, ndpi.influenceGain) * influenceShare)
    : 0;
  const untaxedIncomePerSecond =
    damperIncomePerSecond +
    capitalFlightIncomePerSecond +
    reverseExciseIncomePerSecond +
    ndpiDeductionIncomePerSecond;
  const netPerSecond = finance.netPerSecond + untaxedIncomePerSecond;
  const assetThroughputByKind: Partial<Record<AssetKind, number>> = {};
  for (const def of upgrades) {
    if (!def.assetKind || def.type !== 'sell') continue;
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    assetThroughputByKind[def.assetKind] = (assetThroughputByKind[def.assetKind] ?? 0) + (def.effect.value ?? 0) * level;
  }
  const winCost = winCostOf(config, upgrades);
  const oilCapacity = content
    ? oilCapacityOf(config, content, state)
    : config.oil.baseCapacity + effects.capacityBonus;
  const productStorageFree = Math.max(0, market.productStorage - state.products);
  const productStorageSecondsToFull = productStorageFree <= 1e-9
    ? 0
    : market.flows.productsStored > 1e-9
      ? productStorageFree / market.flows.productsStored
      : Number.POSITIVE_INFINITY;

  return {
    refineries: market.refineries,
    oilPerSecond: market.oilPerSecond,
    flowLimits: market.flowLimits,
    sellPerSecond:
      market.flows.domestic +
      market.flows.export +
      market.flows.productsDomestic +
      market.flows.productsExport,
    salesByChannel: {
      contract: market.flows.domestic,
      export: market.flows.export + market.flows.productsExport,
      refine: market.flows.refined,
    },
    flows: market.flows,
    exportCapacityByMode: market.exportCapacityByMode,
    hasPipeline: market.hasPipeline,
    productCapacity: market.productStorage,
    productStorageSecondsToFull,
    capacities: market.capacities,
    productPriceDomestic: market.productPriceDomestic,
    productPriceExport: market.productPriceExport,
    exchangeRate: market.exchangeRate,
    oil: state.oil,
    oilCapacity,
    oilPricePerTon: market.oilPricePerTon,
    domesticPricePerTon: market.domesticPricePerTon,
    exportPricePerTon: market.exportPricePerTon,
    profitPerSecond: netPerSecond,
    assetsValue: assetsValueOf(config, upgrades, state, market.exchangeRate),
    assetCounts,
    assetThroughputByKind,
    grossPerSecond: market.grossPerSecond + investmentIncomePerSecond,
    damperIncomePerSecond,
    capitalFlightIncomePerSecond,
    reverseExciseIncomePerSecond,
    ndpiDeductionIncomePerSecond,
    lowRateWellCount: lowRateWells,
    untaxedIncomePerSecond,
    investmentRatePercent,
    investmentIncomePerSecond,
    crudeExportIncomePerSecond: market.flows.export * market.channels.export.price,
    productsExportIncomePerSecond: market.flows.productsExport * market.productPriceExport,
    crudeDomesticIncomePerSecond: market.flows.domestic * market.channels.contract.price,
    productsDomesticIncomePerSecond: market.flows.productsDomestic * market.productPriceDomestic,
    totalStorageCapacity: oilCapacity + market.productStorage,
    domesticThroughputCapacity: market.channels.contract.rate,
    exportThroughputCapacity: market.exportCapacityByMode.pipeline + market.exportCapacityByMode.rail + market.exportCapacityByMode.tanker,
    refineryThroughputCapacity: market.channels.refine.rate,
    netPerSecond,
    expensesPerSecond: finance.expensesPerSecond,
    finePerSecond: finance.finePerSecond,
    fineFactor: finance.fineFactor,
    ebtPerSecond: finance.ebtPerSecond,
    taxPaidPerSecond: finance.taxPerSecond,
    taxRate: finance.taxRate,
    costCutPercent: finance.costCutPercent,
    salesVolumeMultiplier: market.salesVolumeMultiplier,
    productionCapped: market.productionCapped,
    multiplier: effects.multProduction * effects.multPassive,
    productionMultiplier: effects.multProduction,
    passiveMultiplier: effects.multPassive,
    priceMultiplier: effects.priceMultiplier,
    salaries: finance.salaries,
    officials: finance.officials,
    exportMultiplier: effects.exportMultiplier,
    influence: finance.influence,
    conquestCut: Math.min(0.75, effects.conquestCut),
    autoDrill: market.crew,
    totalLevels: effects.totalLevels,
    luxuries: effects.luxuries,
    channels: market.channels,
    winCost,
    winReady: isWinReady(config, upgrades, state, state.coins, finance.influence),
    progress: Math.min(1, winCost > 0 ? state.coins / winCost : 0),
  };
}

/** Цена финальной покупки: сначала проверяется определение win, затем config. */
export function winCostOf(config: GameConfig, upgrades: UpgradeDef[]): number {
  const winDef = upgrades.find((upgrade) => upgrade.win);
  return adjustCurrencyCost(config, winDef ? winDef.baseCost : config.winCost);
}

/** Финал доступен: хватает денег и выполнены все условия `winRequirements`. */
export function isWinReady(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  coins: number,
  influence = 0,
): boolean {
  return coins >= winCostOf(config, upgrades) &&
    winRequirementBlocker(config, state, influence) === null;
}

/** База выплаты событий: одна секунда выручки плюс половина пассивной добычи. */
export function payoutBase(derived: DerivedStats): number {
  return Math.max(1, derived.grossPerSecond + derived.oilPerSecond * derived.oilPricePerTon * 0.5);
}

/**
 * Сумма разовой или периодической выплаты покупки.
 * Выигрыш ставки сюда не относится: его считает `Game` (ставка × `factor`).
 */
export function eventPayout(
  def: UpgradeDef,
  derived: DerivedStats,
  level: number,
): number {
  const effect = def.effect;
  if (def.type === 'periodic') {
    // Округляем выплату одного уровня один раз, затем масштабируем уровень.
    const perLevel = Math.max(1, Math.round(payoutBase(derived) * (effect.value ?? 1)));
    return perLevel * Math.max(1, level);
  }
  return Math.max(1, Math.round(payoutBase(derived) * (effect.value ?? 1)));
}
