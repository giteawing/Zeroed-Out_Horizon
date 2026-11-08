/**
 * Сбор эффектов приобретённых улучшений.
 * Только складывает уровни и бонусы; добычу и деньги здесь не рассчитываем.
 */
import type { Channel, ExportMode, GameConfig, GameState, Product, UpgradeDef } from '../../types';
import { PRODUCTS, exportModeOf } from '../definitions';
import { levelOf } from '../purchases';

const GROUPS_OFFICIALS = new Set(['grants', 'taxes', 'deals', 'conquest', 'favors', 'pmc']);
const GROUPS_STAFF = new Set(['staff', 'crew']);
const GROUPS_INFLUENCE = new Set(['grants', 'taxes', 'deals', 'conquest', 'favors', 'pmc', 'media']);

export interface UpgradeEffects {
  tapFlat: number;
  multTap: number;
  multPassive: number;
  taxCutPoints: number;
  costCutFraction: number;
  priceMultiplier: number;
  domesticPriceMultiplier: number;
  exportPriceMultiplier: number;
  exchangeRateMultiplier: number;
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
  fuelDamperEnabled: boolean;
  capitalFlightPerSecond: number;
  capitalFlightGrowthPerMinute: number;
  luxuries: string[];
  rateFlat: Record<Channel, number>;
  throughputBonus: Record<Channel, number>;
  priceBonus: Record<Channel, number>;
  rateByProduct: Record<Channel, Record<Product, number>>;
  exportRateByMode: Record<ExportMode, number>;
}
/** Суммирует эффекты покупок, не рассчитывая добычу, рынки или деньги. */
export function collectUpgradeEffects(
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
    domesticPriceMultiplier: 1,
    exportPriceMultiplier: 1,
    exchangeRateMultiplier: 1,
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
    fuelDamperEnabled: false,
    capitalFlightPerSecond: 0,
    capitalFlightGrowthPerMinute: 0,
    luxuries: [],
    rateFlat: { contract: 0, export: 0, refine: 0 },
    throughputBonus: { contract: 0, export: 0, refine: 0 },
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
    if (effect.fuelDamper) result.fuelDamperEnabled = true;

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
        if (effect.capitalFlightPerSecond) {
          result.capitalFlightPerSecond += effect.capitalFlightPerSecond * level;
          result.capitalFlightGrowthPerMinute += (effect.capitalFlightGrowthPerMinute ?? 0) * level;
        }
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
        if (effect.costCut) result.costCutFraction += effect.costCut * level;
        // Контракты и логистика увеличивают пропускную способность, а не цену за тонну.
        if (effect.percent) result.throughputBonus[channel] += (effect.percent / 100) * level;
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
        if (effect.domesticPriceMultiplier && effect.domesticPriceMultiplier > 0) {
          result.domesticPriceMultiplier *= Math.pow(effect.domesticPriceMultiplier, level);
        }
        if (effect.exportPriceMultiplier && effect.exportPriceMultiplier > 0) {
          result.exportPriceMultiplier *= Math.pow(effect.exportPriceMultiplier, level);
        }
        if (effect.exchangeRateDevaluation && effect.exchangeRateDevaluation > 0) {
          result.exchangeRateMultiplier *= Math.pow(1 + effect.exchangeRateDevaluation, level);
        }
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
