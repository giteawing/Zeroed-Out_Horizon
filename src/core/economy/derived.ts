/**
 * Производные показатели экономики.
 *
 * Последовательность расчёта:
 * 1. collectUpgradeEffects — суммирует эффекты купленных улучшений.
 * 2. calculateMarket — рассчитывает добычу, цены, мощности и сбыт.
 * 3. calculateFinancialRates — рассчитывает расходы, EBT, налог и net.
 * 4. computeDerived — собирает единый снимок для Game, UI и симулятора.
 *
 * Функции здесь чистые: не меняют GameState и не начисляют деньги.
 */
import type {
  Channel,
  ChannelRate,
  Content,
  DerivedStats,
  ExportMode,
  GameConfig,
  GameState,
  Product,
  UpgradeDef,
} from '../types';
import { CHANNELS, PRODUCTS, exportModeOf, type TaxBuff } from './definitions';
import { levelOf } from './purchases';
import {
  fineFactorOf,
  hasFullCrew,
  oilCapacityOf,
  productCapacityOf,
  taxRateOf,
  wellsTonnesPerSecond,
} from './production';
import { assetCountsOf, assetsValueOf } from './assets';
import { oilFlowsOf } from './sales';

const GROUPS_OFFICIALS = new Set(['grants', 'taxes', 'deals', 'conquest', 'favors', 'pmc']);
const GROUPS_STAFF = new Set(['staff', 'crew']);
const GROUPS_INFLUENCE = new Set(['grants', 'taxes', 'deals', 'conquest', 'favors', 'pmc']);

interface UpgradeEffects {
  tapFlat: number;
  multTap: number;
  multPassive: number;
  taxCutPoints: number;
  costCutFraction: number;
  priceMultiplier: number;
  exportMultiplier: number;
  autoTaps: number;
  salariesGrowth: number;
  taxAdd: number;
  staffLevels: number;
  officialLevels: number;
  totalLevels: number;
  influenceFromLevels: number;
  conquestCut: number;
  capacityBonus: number;
  luxuries: string[];
  rateFlat: Record<Channel, number>;
  priceBonus: Record<Channel, number>;
  rateByProduct: Record<Channel, Record<Product, number>>;
  exportRateByMode: Record<ExportMode, number>;
}

interface MarketStats {
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

interface FinancialRates {
  influence: number;
  taxRate: number;
  costCutPercent: number;
  salaries: number;
  officials: number;
  finePerSecond: number;
  fineFactor: number;
  expensesPerSecond: number;
  ebtPerSecond: number;
  taxPerSecond: number;
  netPerSecond: number;
}

/** Суммирует эффекты покупок, не рассчитывая добычу, рынки или деньги. */
function collectUpgradeEffects(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
): UpgradeEffects {
  const result: UpgradeEffects = {
    tapFlat: config.oil.tapTonnes,
    multTap: 1,
    multPassive: 1,
    taxCutPoints: 0,
    costCutFraction: 0,
    priceMultiplier: 1,
    exportMultiplier: 1,
    autoTaps: 0,
    salariesGrowth: 0,
    taxAdd: 0,
    staffLevels: 0,
    officialLevels: 0,
    totalLevels: 0,
    influenceFromLevels: 0,
    conquestCut: 0,
    capacityBonus: 0,
    luxuries: [],
    rateFlat: { contract: 0, export: 0, refine: 0 },
    priceBonus: { contract: 0, export: 0, refine: 0 },
    rateByProduct: {
      contract: { crude: 0, products: 0 },
      export: { crude: 0, products: 0 },
      refine: { crude: 0, products: 0 },
    },
    exportRateByMode: { pipeline: 0, rail: 0, tanker: 0 },
  };

  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0) continue;

    result.totalLevels += level;
    const effect = def.effect;

    if (GROUPS_STAFF.has(def.group)) result.staffLevels += level;
    if (GROUPS_OFFICIALS.has(def.group)) result.officialLevels += level;
    if (GROUPS_INFLUENCE.has(def.group)) {
      const perLevel = config.influence.perGroup[def.group] ?? 1;
      result.influenceFromLevels += perLevel * level;
      result.conquestCut += (perLevel * level) / 2000;
    }

    if (effect.influence) result.influenceFromLevels += effect.influence * level;
    if (effect.conquestCut) result.conquestCut += effect.conquestCut * level;

    switch (def.type) {
      case 'perTap':
        result.tapFlat += (effect.value ?? 0) * level;
        break;
      case 'passive':
        if (effect.costCut) result.costCutFraction += effect.costCut * level;
        if (effect.exportBonus) result.exportMultiplier += effect.exportBonus * level;
        if (effect.salaryAdd) result.salariesGrowth += effect.salaryAdd * level;
        if (effect.taxAdd) result.taxAdd += effect.taxAdd * level;
        break;
      case 'storage':
        result.capacityBonus += (effect.value ?? 0) * level;
        break;
      case 'sell': {
        const channel = effect.channel ?? 'contract';
        if (effect.value) {
          result.rateFlat[channel] += effect.value * level;
          for (const product of PRODUCTS) {
            const share = effect.channelSplit ? (effect.channelSplit[product] ?? 0) : 1;
            if (share > 0) result.rateByProduct[channel][product] += effect.value * level * share;
          }
          if (channel === 'export') {
            result.exportRateByMode[exportModeOf(def)] += effect.value * level;
          }
        }
        if (effect.percent) result.priceBonus[channel] += (effect.percent / 100) * level;
        if (effect.costCut) result.costCutFraction += effect.costCut * level;
        break;
      }
      case 'multiplier': {
        const factor = Math.pow(effect.factor ?? 1, Math.sqrt(level));
        const scope = effect.scope ?? 'all';
        if (scope === 'all' || scope === 'tap') result.multTap *= factor;
        if (scope === 'all' || scope === 'passive') result.multPassive *= factor;
        break;
      }
      case 'taxCut':
        result.taxCutPoints += (effect.percent ?? 0) * level;
        break;
      case 'costCut':
        result.costCutFraction += ((effect.percent ?? 0) * level) / 100;
        break;
      case 'priceBoost':
        result.priceMultiplier *= Math.pow(effect.factor ?? 1, level);
        break;
      case 'autoTap':
        result.autoTaps += (effect.value ?? 0) * level;
        break;
      case 'luxury':
        result.luxuries.push(def.id);
        break;
      default:
        break;
    }
  }
  return result;
}

/** Рассчитывает добычу, цены, мощности рынков, потоки и валовую выручку. */
function calculateMarket(
  config: GameConfig,
  state: GameState,
  effects: UpgradeEffects,
  content: Content | null,
): MarketStats {
  const tapValue = Math.max(0.1, effects.tapFlat * effects.multTap * config.balance.tapScale);
  const crew = hasFullCrew(config, state);
  const crewMultiplier = crew ? 1 + config.oil.autoDrill.bonus : 1;
  const oilPerSecond =
    wellsTonnesPerSecond(config, state) *
    effects.multPassive *
    config.balance.passiveScale *
    crewMultiplier;

  const oilPricePerTon = config.oil.basePricePerTon * state.worldPrice * effects.priceMultiplier;
  const channels = {} as Record<Channel, ChannelRate>;

  for (const channel of CHANNELS) {
    const channelConfig = config.oil.channels[channel];
    const rate = Math.max(0, channelConfig.baseRate + effects.rateFlat[channel]);
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

/** Рассчитывает темп расходов и налога на базе фактически проданной нефти. */
function calculateFinancialRates(
  config: GameConfig,
  state: GameState,
  effects: UpgradeEffects,
  grossPerSecond: number,
): FinancialRates {
  const influence = Math.min(config.influence.cap, Math.round(effects.influenceFromLevels));
  const taxRate = Math.min(
    config.tax.baseRate,
    taxRateOf(config, influence, effects.taxCutPoints + effects.taxAdd * 100),
  );
  const costCutFactor = Math.max(
    config.expenses.minCutFactor,
    1 - Math.min(0.8, effects.costCutFraction),
  );

  const cappedLevelCost = (levels: number) =>
    Math.min(config.expenses.levelRate * levels, grossPerSecond * 0.08);
  const rawSalaries = (
    config.expenses.baseSalaries +
    config.expenses.salariesPerGross * grossPerSecond +
    cappedLevelCost(effects.staffLevels) +
    effects.salariesGrowth * grossPerSecond
  ) * costCutFactor;
  const rawOfficials = (
    config.expenses.baseOfficials +
    config.expenses.officialsPerGross * grossPerSecond +
    cappedLevelCost(effects.officialLevels)
  ) * costCutFactor;

  const overhead = rawSalaries + rawOfficials;
  const overheadCap = grossPerSecond * 0.2;
  const cappedOverhead = overheadCap > 0 && overhead > overheadCap ? overheadCap : overhead;
  const overheadScale = overhead > 0 ? cappedOverhead / overhead : 1;
  const salaries = rawSalaries * overheadScale;
  const officials = rawOfficials * overheadScale;

  const fineFactor = fineFactorOf(config, influence);
  const finePerSecond =
    Math.max(0, state.spillCrudePerSecond) * config.fines.oilPerTon * fineFactor +
    Math.max(0, state.spillProductsPerSecond) * config.fines.productPerTon * fineFactor;
  const expensesPerSecond = salaries + officials + finePerSecond;
  const ebtPerSecond = Math.max(0, grossPerSecond - expensesPerSecond);
  const taxPerSecond = ebtPerSecond * taxRate;
  const netPerSecond = Math.max(0, ebtPerSecond - taxPerSecond);

  return {
    influence,
    taxRate,
    costCutPercent: Math.round((1 - costCutFactor) * 100),
    salaries,
    officials,
    finePerSecond,
    fineFactor,
    expensesPerSecond,
    ebtPerSecond,
    taxPerSecond,
    netPerSecond,
  };
}

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
