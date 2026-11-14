/** Парк НПЗ: ступени модернизации назначаются отдельным заводам. */
import type { GameState, RefineryStats, UpgradeDef } from '../types';
import { levelOf } from './purchases';

/** Физический предел глубины — даже повреждённый сейв его не обходит. */
export const MAX_REFINERY_DEPTH = 0.99;

/** Карточки идут в порядке цепочки из контента; загрузчик проверяет порядок. */
export function refineryStagesOf(upgrades: readonly UpgradeDef[]): UpgradeDef[] {
  return upgrades.filter((def) => def.type === 'refineryDepth');
}

/** Количество построенных или отжатых заводов, не труб и оборудования. */
export function refineryCountOf(upgrades: readonly UpgradeDef[], state: GameState): number {
  return upgrades.reduce((sum, def) => def.assetKind === 'refinery'
    ? sum + Math.max(0, Math.floor(levelOf(state, def.id))) : sum, 0);
}

/**
 * Одна ступень каждого купленного уровня ставится на один завод с предыдущей
 * ступенью. Уровни задают вложенные множества: первые N заводов получают
 * ступень 1, первые M ≤ N из них — ступень 2 и т. д. При этом не требуется
 * менять формат сохранения: в существующих levels уже хранятся все счётчики.
 *
 * Дополнительная пропускная способность труб, оборудования и других покупок
 * распределяется пропорционально номинальной мощности построенных НПЗ;
 * без единого НПЗ она простаивает. Проценты пропускной способности влияют
 * только на capacity, а не на depth.
 */
export function refineryStatsOf(
  upgrades: readonly UpgradeDef[],
  state: GameState,
  baseDepth: number,
  totalCapacity: number,
): RefineryStats {
  const units: RefineryStats['units'] = [];
  const base = Math.min(MAX_REFINERY_DEPTH, Math.max(0, baseDepth));
  for (const def of upgrades) {
    if (def.assetKind !== 'refinery') continue;
    const count = Math.max(0, Math.floor(levelOf(state, def.id)));
    for (let i = 0; i < count; i++) {
      units.push({ capacity: Math.max(0, def.effect.value ?? 0), depth: base });
    }
  }
  let eligible = units.length;
  let previousDepth = base;
  const stages = refineryStagesOf(upgrades).map((def) => {
    const count = Math.min(eligible, Math.max(0, Math.floor(levelOf(state, def.id))));
    // На случай повреждённого контента: глубина не уменьшается и не превышает 99%.
    const depth = Math.min(MAX_REFINERY_DEPTH, Math.max(previousDepth, def.effect.refineryDepth ?? previousDepth));
    for (let i = 0; i < count; i++) units[i]!.depth = depth;
    eligible = count;
    previousDepth = depth;
    return { id: def.id, count, depth };
  });
  const nominal = units.reduce((sum, unit) => sum + unit.capacity, 0);
  const capacity = Math.max(0, totalCapacity);
  for (const unit of units) {
    unit.capacity = nominal > 0 ? capacity * unit.capacity / nominal : capacity / units.length;
  }
  const averageDepth = units.length > 0
    ? units.reduce((sum, unit) => sum + unit.depth, 0) / units.length
    : 0;
  return { plantCount: units.length, stages, averageDepth, units };
}
