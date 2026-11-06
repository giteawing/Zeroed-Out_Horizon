/**
 * Производство и базовые коэффициенты расходов: ёмкости, скважины, налог и штрафы.
 * Все функции чистые: состояние и конфиг только читаются.
 */
import type { Content, GameConfig, GameState } from '../types';
import { levelOf } from './purchases';

export function fineFactorOf(config: GameConfig, influence: number): number {
  const relief = Math.min(
    config.fines.maxRelief,
    Math.max(0, influence) * config.fines.influenceReliefPerPoint,
  );
  return 1 - relief;
}

/** Штраф за указанное количество разлитого, ₦ (с учётом влияния). */
export function fineFor(
  config: GameConfig,
  kind: 'crude' | 'products',
  tonnes: number,
  influence: number,
): number {
  if (!(tonnes > 0)) return 0;
  const rate = kind === 'crude' ? config.fines.oilPerTon : config.fines.productPerTon;
  return tonnes * rate * fineFactorOf(config, influence);
}

export function oilCapacityOf(config: GameConfig, content: Content | null, state: GameState): number {
  let capacity = config.oil.baseCapacity;
  if (content) {
    for (const def of content.upgrades) {
      // Нефтебазы хранят нефтепродукты, а не сырую нефть: у них storage='products'.
      if (def.type !== 'storage' || def.storage === 'products') continue;
      const level = levelOf(state, def.id);
      if (level > 0) capacity += (def.effect.value ?? 0) * level;
    }
  }
  return capacity;
}

/** Ёмкость хранилищ нефтепродуктов: её задают нефтебазы. */
export function productCapacityOf(
  config: GameConfig,
  content: Content | null,
  state: GameState,
): number {
  let capacity = config.product.baseStorage;
  if (content) {
    for (const def of content.upgrades) {
      if (def.type !== 'storage' || def.storage !== 'products') continue;
      const level = levelOf(state, def.id);
      if (level > 0) capacity += (def.effect.value ?? 0) * level;
    }
  }
  return capacity;
}

/** Работает ли автодобыча: наняты все нужные сотрудники. */
export function hasFullCrew(config: GameConfig, state: GameState): boolean {
  return config.oil.autoDrill.requires.every((id) => levelOf(state, id) > 0);
}

/**
 * Дебит всех пробуренных скважин, тонн в секунду.
 * У каждой скважины дебит выпал случайно при бурении (см. config.oil.wells)
 * и записан в состоянии, поэтому сумма не «дёргается» между кадрами.
 */
/**
 * Множитель естественного падения дебита. Скважина со временем качает меньше,
 * но не сильно: пол задаётся config.oil.wells.decline.minFactor.
 */
export function wellDeclineFactor(config: GameConfig, state: GameState): number {
  const decline = config.oil.wells?.decline;
  if (!decline) return 1;
  const seconds = Math.max(0, (state.playtimeMs ?? 0) / 1000);
  const halfLife = Math.max(1, decline.halfLifeSeconds);
  const raw = Math.pow(0.5, seconds / halfLife);
  return Math.min(1, Math.max(decline.minFactor, raw));
}

/** Дебит всех скважин, тонн в секунду (с учётом естественного падения). */
export function wellsTonnesPerSecond(config: GameConfig, state: GameState): number {
  const wells = state.wells ?? [];
  if (wells.length === 0) return 0;
  const perDay = config.oil.wells?.secondsPerDay || 1;
  let daily = 0;
  for (const well of wells) daily += Math.max(0, well.dailyTonnes);
  return (daily / perDay) * wellDeclineFactor(config, state);
}

/** Суммарный суточный дебит, тонн в сутки (с учётом падения) — для панели. */
export function wellsDailyTonnes(state: GameState, config?: GameConfig): number {
  const total = (state.wells ?? []).reduce(
    (sum, well) => sum + Math.max(0, well.dailyTonnes),
    0,
  );
  if (!config) return total;
  return total * wellDeclineFactor(config, state);
}

/**
 * Ставка налога. Зависит ТОЛЬКО от влияния и дружбы с чиновниками,
 * поэтому никогда не «прыгает»: чем больше влияния, тем ниже налог.
 *   rate = max(minRate, baseRate − влияние·influenceDrop − послабления)
 */
export function taxRateOf(
  config: GameConfig,
  influence: number,
  reliefPoints = 0,
): number {
  const drop = Math.max(0, influence) * config.tax.influenceDrop;
  const rate = config.tax.baseRate - drop - reliefPoints / 100;
  return Math.min(config.tax.baseRate, Math.max(config.tax.minRate, rate));
}

