/**
 * Покупки: цены, пакетная доступность и условия разблокировки.
 * Только расчёты — состояние игры здесь не меняется.
 */
import type { GameConfig, GameState, UpgradeDef } from '../types';

export function levelOf(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/** Цена следующего уровня: baseCost · growth^level. */
export function costFor(config: GameConfig, def: UpgradeDef, level: number): number {
  if (def.baseCost <= 0) return 0;
  const growth = def.costGrowth ?? config.costGrowth;
  return Math.round(def.baseCost * Math.pow(growth, level));
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
export function isUnlocked(def: UpgradeDef, state: GameState, influence = 0): boolean {
  return unlockBlocker(def, state, influence) === null;
}

/** Чего не хватает для открытия покупки — для подсказки в интерфейсе. */
export function unlockBlocker(
  def: UpgradeDef,
  state: GameState,
  influence = 0,
):
  | { kind: 'balance'; value: number }
  | { kind: 'upgrade'; id: string; level: number }
  | { kind: 'influence'; value: number }
  | null {
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
  if (req.influence !== undefined && influence < req.influence) {
    return { kind: 'influence', value: req.influence };
  }
  return null;
}
