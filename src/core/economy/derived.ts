/**
 * Сборка публичного снимка экономики.
 * Вычисления делегированы effects, market и financial-rates.
 */
import type { Content, DerivedStats, GameConfig, GameState, UpgradeDef } from '../types';
import { type TaxBuff } from './definitions';
import { levelOf } from './purchases';
import { oilCapacityOf } from './production';
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

  const effects = collectUpgradeEffects(config, upgrades, state);
  const market = calculateMarket(config, state, effects, content);
  const finance = calculateFinancialRates(config, state, effects, market.grossPerSecond);
  const winCost = winCostOf(config, upgrades);
  const oilCapacity = content
    ? oilCapacityOf(config, content, state)
    : config.oil.baseCapacity + effects.capacityBonus;

  return {
    tapValue: market.tapValue,
    tapRevenue: market.tapValue * market.oilPricePerTon,
    autoTapsPerSecond: effects.autoTaps,
    oilPerSecond: market.oilPerSecond,
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
    capacities: market.capacities,
    productPriceDomestic: market.productPriceDomestic,
    productPriceExport: market.productPriceExport,
    oil: state.oil,
    oilCapacity,
    oilPricePerTon: market.oilPricePerTon,
    domesticPricePerTon: market.domesticPricePerTon,
    exportPricePerTon: market.exportPricePerTon,
    profitPerSecond: finance.netPerSecond,
    assetsValue: assetsValueOf(config, upgrades, state),
    assetCounts: assetCountsOf(upgrades, state),
    grossPerSecond: market.grossPerSecond,
    netPerSecond: finance.netPerSecond,
    expensesPerSecond: finance.expensesPerSecond,
    finePerSecond: finance.finePerSecond,
    fineFactor: finance.fineFactor,
    ebtPerSecond: finance.ebtPerSecond,
    taxPaidPerSecond: finance.taxPerSecond,
    taxRate: finance.taxRate,
    costCutPercent: finance.costCutPercent,
    multiplier: effects.multTap * effects.multPassive,
    tapMultiplier: effects.multTap,
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

/** Свободная ёмкость сырьевых резервуаров. */
export function freeOilSpace(derived: DerivedStats): number {
  return Math.max(0, derived.oilCapacity - derived.oil);
}

/** Цена финальной покупки: сначала проверяется определение win, затем config. */
export function winCostOf(config: GameConfig, upgrades: UpgradeDef[]): number {
  const winDef = upgrades.find((upgrade) => upgrade.win);
  return winDef ? winDef.baseCost : config.winCost;
}

/** Проверяет все требования победы. */
export function isWinReady(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  coins: number,
  influence = 0,
): boolean {
  if (coins < winCostOf(config, upgrades)) return false;
  for (const requirement of config.winRequirements) {
    if (
      requirement.upgrade !== undefined &&
      levelOf(state, requirement.upgrade) < (requirement.level ?? 1)
    ) return false;
    if (requirement.balance !== undefined && state.totalEarned < requirement.balance) return false;
    if (requirement.influence !== undefined && influence < requirement.influence) return false;
  }
  return true;
}

/** База выплаты событий: одна секунда выручки плюс половина пассивной добычи. */
export function payoutBase(derived: DerivedStats): number {
  return Math.max(1, derived.grossPerSecond + derived.oilPerSecond * derived.oilPricePerTon * 0.5);
}

/** Сумма разовой или периодической выплаты покупки. */
export function eventPayout(
  def: UpgradeDef,
  derived: DerivedStats,
  level: number,
  paidCost: number,
): number {
  const effect = def.effect;
  if (effect.factor !== undefined && paidCost > 0) {
    return Math.max(1, Math.round(paidCost * Math.pow(effect.factor, Math.max(1, level))));
  }
  return Math.max(1, Math.round(payoutBase(derived) * (effect.value ?? 1)));
}

/** Нефть за один тап с небольшим случайным разбросом. */
export function tapReward(derived: DerivedStats, rngValue: number): number {
  return Math.max(0.1, derived.tapValue * (0.9 + rngValue * 0.2));
}

/** Чистые деньги за интервал: EBT минус налог на прибыль. */
export function netForInterval(derived: DerivedStats, dtSeconds: number): number {
  return Math.max(0, derived.ebtPerSecond * (1 - derived.taxRate) * dtSeconds);
}
