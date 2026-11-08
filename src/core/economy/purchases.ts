/**
 * Покупки: цены, пакетная доступность и условия разблокировки.
 * Только расчёты — состояние игры здесь не меняется.
 */
import type { GameConfig, GameState, UpgradeDef } from '../types';

export function levelOf(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/**
 * Сжимает денежные значения по общей кривой:
 * значения до anchor не меняются, поздние цены растут степенно.
 * Это сохраняет стартовую экономику и делает финальные покупки достижимыми.
 */
export function adjustCurrencyCost(config: GameConfig, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const anchor = Math.max(1, config.currencyCostCurve?.anchor ?? 100_000);
  const exponent = Math.min(1, Math.max(0.01, config.currencyCostCurve?.exponent ?? 1));
  if (value <= anchor) return Math.round(value);
  return Math.max(1, Math.round(anchor * Math.pow(value / anchor, exponent)));
}

/** Строительный CAPEX дорожает при девальвации; политические услуги не индексируются. */
export function constructionCostMultiplier(
  config: GameConfig,
  def: UpgradeDef,
  exchangeRate = config.exchangeRate.initial,
): number {
  const isCapitalAsset = Boolean(def.assetKind) || def.type === 'well' || def.type === 'field';
  if (!isCapitalAsset) return 1;
  const elasticity = Math.max(0, config.exchangeRate.constructionCostElasticity);
  return Math.pow(Math.max(config.exchangeRate.initial, exchangeRate), elasticity);
}

/** Цена следующего уровня: nominal baseCost · growth^level, общая кривая и индекс CAPEX. */
export function costFor(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  if (def.baseCost <= 0) return 0;
  const growth = def.costGrowth ?? config.costGrowth;
  const curved = adjustCurrencyCost(config, def.baseCost * Math.pow(growth, level));
  return Math.round(curved * constructionCostMultiplier(config, def, exchangeRate));
}

/** Суммарная цена count уровней подряд, начиная с текущего level. */
export function totalCostFor(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  count: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += costFor(config, def, level + i, exchangeRate);
  return sum;
}

/** Сколько уровней можно купить на coins (с учётом maxLevel и лимита за раз). */
export function affordableLevels(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  coins: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  if (level >= def.maxLevel) return 0;
  if (def.baseCost <= 0) return Math.min(1, config.maxBuyLevels, def.maxLevel - level);
  let count = 0;
  let spent = 0;
  while (level + count < def.maxLevel && count < config.maxBuyLevels) {
    const next = costFor(config, def, level + count, exchangeRate);
    if (spent + next > coins) break;
    spent += next;
    count++;
  }
  return count;
}

/** Выполнены ли требования разблокировки (деньги здесь не учитываются). */
export function isUnlocked(
  def: UpgradeDef,
  state: GameState,
  influence = 0,
  config?: GameConfig,
): boolean {
  return unlockBlocker(def, state, influence, config) === null;
}

/** Чего не хватает для открытия покупки — для подсказки в интерфейсе. */
export function unlockBlocker(
  def: UpgradeDef,
  state: GameState,
  influence = 0,
  config?: GameConfig,
):
  | { kind: 'balance'; value: number }
  | { kind: 'upgrade'; id: string; level: number }
  | { kind: 'influence'; value: number }
  | null {
  const req = def.unlockAt;
  if (!req) return null;
  if (req.balance !== undefined) {
    const requiredBalance = config ? adjustCurrencyCost(config, req.balance) : req.balance;
    if (state.totalEarned < requiredBalance) {
      return { kind: 'balance', value: requiredBalance };
    }
  }
  if (req.upgrade !== undefined) {
    const need = req.level ?? 1;
    if (levelOf(state, req.upgrade) < need) {
      return { kind: 'upgrade', id: req.upgrade, level: need };
    }
  }
  if (req.influence !== undefined && influence < req.influence) {
    return { kind: 'influence', value: req.influence };
  }
  return null;
}
