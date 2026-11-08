/**
 * Оценка собственности и награды за реприватизацию.
 * Цена скважины едина для оценки активов и стоимости месторождения.
 */
import type { AssetKind, GameConfig, GameState, ReprivatizationPrize, UpgradeDef } from '../types';
import { costFor, levelOf } from './purchases';
import { wellsDailyTonnes } from './production';

export function assetCountsOf(upgrades: UpgradeDef[], state: GameState): Record<AssetKind, number> {
  const counts: Record<AssetKind, number> = {
    refinery: 0,
    depot: 0,
    azs: 0,
    exportPipe: 0,
    refineryPipe: 0,
    crudeTank: 0,
    exportRail: 0,
    exportTanker: 0,
    gasPlant: 0,
    powerPlant: 0,
    productExport: 0,
  };
  for (const def of upgrades) {
    if (!def.assetKind) continue;
    counts[def.assetKind] += levelOf(state, def.id);
  }
  return counts;
}

export interface AssetValueLine {
  id: string;
  kind: 'upgrade' | 'wells' | 'luxury';
  name?: string;
  count: number;
  value: number;
}

/** Подробная оценка собственности; строки складываются в общую стоимость. */
export function assetValueBreakdownOf(config: GameConfig, upgrades: UpgradeDef[], state: GameState): AssetValueLine[] {
  const lines: AssetValueLine[] = [];
  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0 || def.type === 'luxury' || def.type === 'well' || def.type === 'win') continue;
    const growth = def.costGrowth ?? config.costGrowth;
    const value = costFor(config, def, 0) *
      ((Math.pow(growth, level) - 1) / Math.max(1e-9, growth - 1));
    lines.push({ id: def.id, kind: 'upgrade', name: def.name, count: level, value });
  }
  const wellsCount = (state.wells ?? []).length;
  const wellsValue = wellsDailyTonnes(state, config) * wellPricePerDailyTonne(config);
  if (wellsCount > 0) lines.push({ id: 'wells', kind: 'wells', count: wellsCount, value: wellsValue });
  const luxuryCount = upgrades.reduce((sum, def) =>
    def.type === 'luxury' ? sum + levelOf(state, def.id) : sum, 0);
  if (state.luxurySpent > 0) lines.push({ id: 'luxury', kind: 'luxury', count: luxuryCount, value: state.luxurySpent });
  return lines.sort((a, b) => b.value - a.value);
}

/** Общая стоимость собственности — сумма строк подробной расшифровки. */
export function assetsValueOf(config: GameConfig, upgrades: UpgradeDef[], state: GameState): number {
  const total = assetValueBreakdownOf(config, upgrades, state).reduce((sum, line) => sum + line.value, 0);
  return Math.max(0, Math.round(total));
}

/**
 * Реприватизация: сколько объектов достаётся и сколько это стоит.
 *
 * По требованию владельца игрок получает СЛУЧАЙНОЕ число месторождений
 * и скважин, но их суммарная стоимость обязана быть в 5–10 раз больше
 * потраченного на активацию. Поэтому сначала считаем бюджет = цена × множитель,
 * потом набираем объекты, пока бюджет не кончится.
 */
/**
 * Разброс множителя выгоды. Нижняя граница и верхняя — из требований
 * (5–10 раз дороже, чем заплатили), поэтому сделка всегда выгодна.
 */
export const REPRIVAT_PRIZE_MIN = 5;
export const REPRIVAT_PRIZE_MAX = 10;

/**
 * Рыночная стоимость одной тонны суточного дебита, ₦.
 *
 * И панель активов, и реприватизация используют базовую цену нефти: текущая
 * экспортная надбавка относится к каналу сбыта, а не к самой скважине.
 * Старый необязательный аргумент сохранён для совместимости вызовов, но
 * намеренно игнорируется.
 */
export function wellPricePerDailyTonne(config: GameConfig, _pricePerTon?: number): number {
  void _pricePerTon;
  return Math.max(1, config.oil.basePricePerTon * config.oil.wells.priceSeconds);
}

/**
 * Собирает приз реприватизации. `rand` — функция 0..1 (ГПСЧ игры),
 * чтобы результат был воспроизводимым в тестах.
 */
export function reprivatizationPrize(
  config: GameConfig,
  paid: number,
  pricePerTon: number,
  rand: () => number,
): ReprivatizationPrize {
  const factor = REPRIVAT_PRIZE_MIN + rand() * (REPRIVAT_PRIZE_MAX - REPRIVAT_PRIZE_MIN);
  const budget = Math.max(0, paid) * factor;
  const perTonne = wellPricePerDailyTonne(config, pricePerTon);
  /*
   * Сколько скважин достаётся покупателю.
   *
   * Требование заказчика: за одно отжатие приходит СЛУЧАЙНОЕ число скважин
   * от 5 до 50 — «месторождение», а не одна дырка в земле. Дебит при этом
   * всё равно считается от бюджета: дорогие скважины реже, дешёвые чаще,
   * иначе 50 скважин по тысяче тонн ломали бы баланс.
   */
  const countMin = Math.max(1, Math.round(config.oil.conquestWells?.min ?? 5));
  const countMax = Math.max(countMin, Math.round(config.oil.conquestWells?.max ?? 50));
  const count = countMin + Math.round(rand() * (countMax - countMin));
  // Сколько тонн в сутки «умещается» в бюджет: делим на всё месторождение.
  const totalTonnes = budget / perTonne;
  const weights: number[] = [];
  for (let i = 0; i < count; i++) weights.push(0.5 + rand());
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let dailyTonnes = 0;
  for (const weight of weights) {
    const share = (weight / weightSum) * totalTonnes;
    // Даже самая мелкая скважина месторождения что-то качает.
    dailyTonnes += Math.max(1, Math.round(share));
  }
  return {
    wells: count,
    dailyTonnes,
    marketValue: Math.round(totalTonnes * perTonne),
  };
}

/**
 * Множитель выплат банка: «Увеличение масштабов деятельности банка»
 * усиливает все операции с перезарядкой (транш, уход от налогов, отмывание).
 */
export function bankScaleOf(upgrades: UpgradeDef[], state: GameState): number {
  let scale = 1;
  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    const per = def.effect.bankScale;
    if (!per) continue;
    scale += per * level;
  }
  return scale;
}

