/**
 * Экономика игры. Здесь ТОЛЬКО чистые функции: на вход состояние и контент,
 * на выход числа. Никакого DOM, таймеров и localStorage — поэтому всё это
 * покрывается юнит-тестами и гоняется симулятором баланса.
 *
 * Формулы (ТЗ §5.1):
 *   tapValue   = (baseTap + Σ perTap·level) · Π(множители) · tapScale
 *   gross/s    = Σ passive·level · Π(множители) · priceMultiplier · passiveScale
 *   net/s      = max(0, gross·(1 − taxRate) − salaries − officials)
 */
import type { DerivedStats, GameConfig, GameState, UpgradeDef } from './types';

export interface TaxBuff {
  id: string;
  /** На сколько процентных пунктов снижается налог (0.02 = 2 п.п.). */
  amount: number;
  untilMs: number;
}

export function levelOf(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/** Цена следующего уровня: baseCost · growth^level. */
export function costFor(config: GameConfig, def: UpgradeDef, level: number): number {
  if (def.baseCost <= 0) return 0;
  return Math.round(def.baseCost * Math.pow(config.costGrowth, level));
}

/** Суммарная цена count уровней подряд, начиная с текущего level. */
export function totalCostFor(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  count: number,
): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += costFor(config, def, level + i);
  return sum;
}

/** Сколько уровней можно купить на coins (с учётом maxLevel и лимита за раз). */
export function affordableLevels(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  coins: number,
): number {
  if (level >= def.maxLevel) return 0;
  if (def.baseCost <= 0) return Math.min(1, config.maxBuyLevels, def.maxLevel - level);
  let count = 0;
  let spent = 0;
  while (level + count < def.maxLevel && count < config.maxBuyLevels) {
    const next = costFor(config, def, level + count);
    if (spent + next > coins) break;
    spent += next;
    count++;
  }
  return count;
}

/** Выполнены ли требования разблокировки (деньги здесь не учитываются). */
export function isUnlocked(def: UpgradeDef, state: GameState): boolean {
  return unlockBlocker(def, state) === null;
}

/** Чего не хватает для открытия покупки — для подсказки в интерфейсе. */
export function unlockBlocker(
  def: UpgradeDef,
  state: GameState,
): { kind: 'balance'; value: number } | { kind: 'upgrade'; id: string; level: number } | null {
  const req = def.unlockAt;
  if (!req) return null;
  if (req.balance !== undefined && state.totalEarned < req.balance) {
    return { kind: 'balance', value: req.balance };
  }
  if (req.upgrade !== undefined) {
    const need = req.level ?? 1;
    if (levelOf(state, req.upgrade) < need) {
      return { kind: 'upgrade', id: req.upgrade, level: need };
    }
  }
  return null;
}

const GROUP_STAFF = 'staff';
const GROUPS_OFFICIALS = new Set(['grants', 'taxes', 'deals', 'conquest', 'favors']);

/** Главная функция: считает все производные показатели империи. */
export function computeDerived(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  buffs: readonly TaxBuff[] = [],
): DerivedStats {
  let tapFlat = config.baseTapValue;
  let passiveFlat = 0;
  let multAll = 1;
  let multTap = 1;
  let multPassive = 1;
  let taxCutPoints = 0;
  let costCutFraction = 0;
  let priceMultiplier = 1;
  let exportMultiplier = 1;
  let autoTaps = 0;
  let salariesGrowth = 0;
  let taxAdd = 0;
  let staffLevels = 0;
  let officialLevels = 0;
  let totalLevels = 0;
  const luxuries: string[] = [];

  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    totalLevels += level;
    const e = def.effect;
    if (def.group === GROUP_STAFF) staffLevels += level;
    if (GROUPS_OFFICIALS.has(def.group)) officialLevels += level;

    switch (def.type) {
      case 'perTap':
        tapFlat += (e.value ?? 0) * level;
        break;
      case 'passive':
        passiveFlat += (e.value ?? 0) * level;
        if (e.costCut) costCutFraction += e.costCut * level;
        if (e.exportBonus) exportMultiplier += e.exportBonus * level;
        if (e.salaryAdd) salariesGrowth += e.salaryAdd * level;
        if (e.taxAdd) taxAdd += e.taxAdd * level;
        break;
      case 'multiplier': {
        const factor = Math.pow(e.factor ?? 1, level);
        const scope = e.scope ?? 'all';
        if (scope === 'all') {
          multTap *= factor;
          multPassive *= factor;
        } else if (scope === 'tap') {
          multTap *= factor;
        } else {
          multPassive *= factor;
        }
        break;
      }
      case 'taxCut':
        taxCutPoints += (e.percent ?? 0) * level;
        break;
      case 'costCut':
        costCutFraction += ((e.percent ?? 0) * level) / 100;
        break;
      case 'priceBoost':
        priceMultiplier *= Math.pow(e.factor ?? 1, level);
        break;
      case 'autoTap':
        autoTaps += (e.value ?? 0) * level;
        break;
      case 'luxury':
        luxuries.push(def.id);
        break;
      default:
        break;
    }
  }

  for (const buff of buffs) taxCutPoints += buff.amount * 100;

  const tapValue = Math.max(0.5, tapFlat * multTap * config.balance.tapScale);
  const passiveBase = passiveFlat * multPassive * config.balance.passiveScale;
  const grossPerSecond = passiveBase * priceMultiplier;
  const taxRate = Math.min(
    1,
    Math.max(config.tax.minRate, config.tax.baseRate - taxCutPoints / 100 + taxAdd),
  );
  const cutFactor = Math.max(
    config.expenses.minCutFactor,
    1 - Math.min(0.8, costCutFraction),
  );
  const salaries =
    (config.expenses.baseSalaries +
      config.expenses.salariesPerGross * grossPerSecond +
      config.expenses.levelRate * staffLevels +
      salariesGrowth * grossPerSecond) *
    cutFactor;
  const officials =
    (config.expenses.baseOfficials +
      config.expenses.officialsPerGross * grossPerSecond +
      config.expenses.levelRate * officialLevels) *
    cutFactor;

  const expensesPerSecond = salaries + officials;
  const netPerSecond = Math.max(0, grossPerSecond * (1 - taxRate) - expensesPerSecond);
  const winCost = winCostOf(config, upgrades);

  return {
    tapValue,
    autoTapsPerSecond: autoTaps,
    grossPerSecond,
    netPerSecond,
    expensesPerSecond,
    taxRate,
    costCutPercent: Math.round((1 - cutFactor) * 100),
    multiplier: multAll * multTap * multPassive,
    priceMultiplier,
    salaries,
    officials,
    exportMultiplier,
    totalLevels,
    luxuries,
    winCost,
    winReady: isWinReady(config, upgrades, state, state.coins),
    progress: Math.min(1, winCost > 0 ? state.coins / winCost : 0),
  };
}

/** Цена победы: из финальной покупки (win: true) или из config.winCost. */
export function winCostOf(config: GameConfig, upgrades: UpgradeDef[]): number {
  const winDef = upgrades.find((u) => u.win);
  return winDef ? winDef.baseCost : config.winCost;
}

/** Все условия победы (деньги + ключевые улучшения) выполнены? */
export function isWinReady(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  coins: number,
): boolean {
  if (coins < winCostOf(config, upgrades)) return false;
  for (const req of config.winRequirements) {
    if (req.upgrade !== undefined && levelOf(state, req.upgrade) < (req.level ?? 1)) return false;
    if (req.balance !== undefined && state.totalEarned < req.balance) return false;
  }
  return true;
}

/** База для выплат событий: «одна секунда текущего темпа плюс полсекунды пассива». */
export function payoutBase(derived: DerivedStats): number {
  return Math.max(1, derived.tapValue + derived.grossPerSecond * 0.5);
}

/**
 * Выплата разовой/периодической покупки в единицах «секунд дохода».
 * Для платных разовых покупок используется множитель цены (effect.factor),
 * иначе — фиксированное число секунд (effect.value).
 */
export function eventPayout(
  def: UpgradeDef,
  derived: DerivedStats,
  level: number,
  paidCost: number,
): number {
  const e = def.effect;
  if (e.factor !== undefined && paidCost > 0) {
    return Math.max(1, Math.round(paidCost * Math.pow(e.factor, Math.max(1, level))));
  }
  return Math.max(1, Math.round(payoutBase(derived) * (e.value ?? 1)));
}

/** Выплата за экспорт нефти: зависит от мировой цены и терминала. */
export function exportPayout(def: UpgradeDef, derived: DerivedStats, worldPrice: number): number {
  return Math.max(
    1,
    Math.round(payoutBase(derived) * (def.effect.value ?? 40) * worldPrice * derived.exportMultiplier),
  );
}

/** Доход за один тап с лёгким «разбросом», чтобы не было одинаковых цифр. */
export function tapReward(derived: DerivedStats, rngValue: number): number {
  return Math.max(0.5, derived.tapValue * (0.9 + rngValue * 0.2));
}

/** Итоговый прирост за интервал с учётом правила «не ниже нуля». */
export function netForInterval(derived: DerivedStats, dtSeconds: number): number {
  return Math.max(
    0,
    derived.grossPerSecond * (1 - derived.taxRate) * dtSeconds - derived.expensesPerSecond * dtSeconds,
  );
}
