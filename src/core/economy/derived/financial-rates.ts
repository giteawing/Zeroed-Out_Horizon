/**
 * Финансовые темпы: операционные расходы, штрафы, EBT и налог.
 * Здесь рассчитывается темп в секунду, а не закрытие фактической продажи.
 */
import type { GameConfig, GameState } from '../../types';
import { fineFactorOf, taxRateOf } from '../production';
import type { UpgradeEffects } from './effects';

export interface FinancialRates {
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

/** Рассчитывает темп расходов и налога на базе фактически проданной нефти. */
export function calculateFinancialRates(
  config: GameConfig,
  state: GameState,
  effects: UpgradeEffects,
  grossPerSecond: number,
  additionalIncomePerSecond = 0,
): FinancialRates {
  const influence = Math.max(0, Math.round(effects.influenceFromLevels));
  const taxRate = Math.min(
    config.tax.baseRate,
    taxRateOf(config, influence, effects.taxCutPoints),
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
  const rawFinePerSecond =
    Math.max(0, state.spillCrudePerSecond) * config.fines.oilPerTon * fineFactor +
    Math.max(0, state.spillProductsPerSecond) * config.fines.productPerTon * fineFactor;
  const hasSpill = state.spillCrudePerSecond > 0 || state.spillProductsPerSecond > 0;
  const finePerSecond = hasSpill ? Math.max(1e-6, rawFinePerSecond) : 0;
  const expensesPerSecond = salaries + officials + finePerSecond;
  // Внешние выплаты не увеличивают эксплуатационные расходы, но входят в EBT.
  const ebtPerSecond = Math.max(0, grossPerSecond + Math.max(0, additionalIncomePerSecond) - expensesPerSecond);
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
