/**
 * Оценка собственности и награды за реприватизацию.
 * Цена скважины едина для оценки активов и стоимости месторождения.
 */
import type { AssetKind, GameConfig, GameState, ReprivatizationPrize, UpgradeDef } from '../types';
import { levelOf, ownedLevelsCost } from './purchases';
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
    equipment: 0,
    media: 0,
    facility: 0,
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

/**
 * Только явно классифицированная собственность. Политические действия,
 * взятки, найм, договоры, финансовые операции и прочие эффекты не активы;
 * скважины и роскошь оцениваются отдельными строками.
 */
function isValuedAsset(def: UpgradeDef): boolean {
  return Boolean(def.assetKind) && def.type !== 'luxury' && def.type !== 'well' && def.type !== 'win';
}

/** Стоимость всех скважин: суточный дебит по цене тонны дебита. */
function wellsValueOf(config: GameConfig, state: GameState, exchangeRate: number): number {
  return wellsDailyTonnes(state, config) * wellPricePerDailyTonne(config, undefined, exchangeRate);
}

/** Подробная оценка собственности; строки складываются в общую стоимость. */
export function assetValueBreakdownOf(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  exchangeRate = config.exchangeRate.initial,
): AssetValueLine[] {
  const lines: AssetValueLine[] = [];
  for (const def of upgrades) {
    if (!isValuedAsset(def)) continue;
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    // Сумма цен всех купленных уровней; она запомнена и не пересчитывается.
    const value = ownedLevelsCost(config, def, level, exchangeRate);
    lines.push({ id: def.id, kind: 'upgrade', name: def.name, count: level, value });
  }
  const wellsCount = (state.wells ?? []).length;
  if (wellsCount > 0) {
    lines.push({ id: 'wells', kind: 'wells', count: wellsCount, value: wellsValueOf(config, state, exchangeRate) });
  }
  if (state.luxurySpent > 0) {
    const luxuryCount = upgrades.reduce((sum, def) =>
      def.type === 'luxury' ? sum + levelOf(state, def.id) : sum, 0);
    lines.push({ id: 'luxury', kind: 'luxury', count: luxuryCount, value: state.luxurySpent });
  }
  return lines.sort((a, b) => b.value - a.value);
}

/**
 * Общая стоимость собственности — сумма строк подробной расшифровки.
 *
 * Считается в каждом `computeDerived`, поэтому строки с подписями здесь не
 * создаются: берутся те же значения и складываются в том же порядке, по
 * убыванию. Порядок менять нельзя: от него зависят младшие разряды суммы.
 * Равенство с расшифровкой закреплено в tests/core-speed.test.ts.
 */
export function assetsValueOf(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  exchangeRate = config.exchangeRate.initial,
): number {
  const values: number[] = [];
  for (const def of upgrades) {
    if (!isValuedAsset(def)) continue;
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    values.push(ownedLevelsCost(config, def, level, exchangeRate));
  }
  if ((state.wells ?? []).length > 0) values.push(wellsValueOf(config, state, exchangeRate));
  if (state.luxurySpent > 0) values.push(state.luxurySpent);
  values.sort((a, b) => b - a);
  let total = 0;
  for (const value of values) total += value;
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
export function wellPricePerDailyTonne(
  config: GameConfig,
  _pricePerTon?: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  void _pricePerTon;
  const capexIndex = Math.pow(
    Math.max(config.exchangeRate.initial, exchangeRate),
    Math.max(0, config.exchangeRate.constructionCostElasticity),
  );
  return Math.max(1, config.oil.basePricePerTon * config.oil.wells.priceSeconds * capexIndex);
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
  exchangeRate = config.exchangeRate.initial,
): ReprivatizationPrize {
  const factor = REPRIVAT_PRIZE_MIN + rand() * (REPRIVAT_PRIZE_MAX - REPRIVAT_PRIZE_MIN);
  const budget = Math.max(0, paid) * factor;
  const perTonne = wellPricePerDailyTonne(config, pricePerTon, exchangeRate);
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
  const dailyTonnes = Math.max(count, Math.round(totalTonnes));
  const weights: number[] = [];
  for (let i = 0; i < count; i++) weights.push(0.5 + rand());
  const weightSum = weights.reduce((a, b) => a + b, 0);

  // Сначала гарантируем по одной тонне на скважину, затем распределяем
  // остаток пропорционально весам методом наибольших остатков.
  const distributable = dailyTonnes - count;
  const quotas = weights.map((weight) => (weight / weightSum) * distributable);
  const shares = quotas.map((quota) => 1 + Math.floor(quota));
  const floorSum = quotas.reduce((sum, quota) => sum + Math.floor(quota), 0);
  const remainder = distributable - floorSum;
  const remainders = quotas
    .map((quota, index) => ({ index, fraction: quota - Math.floor(quota) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i++) shares[remainders[i].index] += 1;

  return {
    wells: count,
    dailyTonnes,
    shares,
    marketValue: Math.round(dailyTonnes * perTonne),
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
    // bankScale — множитель банка, а не признак банковской операции.
    if (def.type !== 'taxCut') continue;
    const per = def.effect.bankScale;
    if (!per) continue;
    scale += per * level;
  }
  return scale;
}

