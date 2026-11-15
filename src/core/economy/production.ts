/**
 * Производство и базовые коэффициенты расходов: ёмкости, скважины, налог и штрафы.
 * Функции не меняют игровые величины: состояние и конфиг только читаются.
 * Единственное исключение — посчитанный массив скважин замораживается,
 * см. `totalDailyWellTonnes`.
 */
import type { Content, GameConfig, GameState, Well } from '../types';
import { levelOf } from './purchases';

/**
 * Сумма суточного дебита, кеш по массиву скважин.
 *
 * `GameState.wells` — неизменяемое значение: скважины добавляются заменой
 * массива (`state.wells = [...state.wells, well]`), поэтому сам массив служит
 * ключом кеша. Чтобы правило нельзя было нарушить незаметно, посчитанный
 * массив и его скважины замораживаются: запись на месте бросает TypeError,
 * а не оставляет устаревшую сумму (AUDIT F10).
 */
interface WellSummary {
  totalDaily: number;
  lastThreshold: number;
  lastDecline: number;
  lastLowCount: number;
}

const wellDailyTotals = new WeakMap<readonly Well[], WellSummary>();

function summarizeWells(wells: readonly Well[]): WellSummary {
  const cached = wellDailyTotals.get(wells);
  if (cached !== undefined) return cached;
  let total = 0;
  for (let i = 0; i < wells.length; i++) {
    const well = wells[i]!;
    total += Math.max(0, well.dailyTonnes);
    if (!Object.isFrozen(well)) Object.freeze(well);
  }
  if (!Object.isFrozen(wells)) Object.freeze(wells);
  const summary: WellSummary = {
    totalDaily: total,
    lastThreshold: -1,
    lastDecline: -1,
    lastLowCount: 0,
  };
  wellDailyTotals.set(wells, summary);
  return summary;
}

function totalDailyWellTonnes(wells: readonly Well[]): number {
  return summarizeWells(wells).totalDaily;
}

export function fineFactorOf(config: GameConfig, influence: number): number {
  const relief = Math.min(
    config.fines.maxRelief,
    Math.max(0, influence) * config.fines.influenceReliefPerPoint,
  );
  // Влияние снижает штраф почти до нуля, но не отменяет его полностью.
  return Math.max(0.001, 1 - relief);
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
  return Math.max(1e-6, tonnes * rate * fineFactorOf(config, influence));
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

/**
 * Через сколько секунд партии дебит упирается в пол `decline.minFactor`.
 * 0 — падения нет (пол равен 1). Формула та же, что в `wellDeclineFactor`:
 * 0.5^(t / halfLife) = minFactor  ⇒  t = halfLife · log2(1 / minFactor).
 * Нужна «Правилам игры», чтобы текст не расходился с движком.
 */
export function wellDeclineFloorSeconds(config: GameConfig): number {
  const decline = config.oil.wells?.decline;
  if (!decline) return 0;
  const floor = Math.min(1, Math.max(0, decline.minFactor));
  if (floor >= 1) return 0;
  if (floor <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, decline.halfLifeSeconds) * Math.log2(1 / floor);
}

/** Дебит всех скважин, тонн в секунду (с учётом естественного падения). */
export function wellsTonnesPerSecond(config: GameConfig, state: GameState): number {
  const wells = state.wells ?? [];
  if (wells.length === 0) return 0;
  const perDay = config.oil.wells?.secondsPerDay || 1;
  return (totalDailyWellTonnes(wells) / perDay) * wellDeclineFactor(config, state);
}

/** Суммарный суточный дебит, тонн в сутки (с учётом падения) — для панели. */
export function wellsDailyTonnes(state: GameState, config?: GameConfig): number {
  const total = totalDailyWellTonnes(state.wells ?? []);
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


/**
 * Сколько скважин сейчас даёт меньше порога НДПИ, штук.
 *
 * Считается по ТЕКУЩЕМУ дебиту: суточный дебит скважины после естественного
 * падения. Порог и коэффициент падения берутся из данных, поэтому вычет
 * сам перестаёт полагаться, когда скважина «оживает» после ремонта или
 * наоборот истощается.
 */
export function lowRateWellCount(config: GameConfig, state: GameState): number {
  const threshold = Math.max(0, config.deductions?.ndpi?.dailyTonnesThreshold ?? 0);
  if (!(threshold > 0)) return 0;
  const wells = state.wells ?? [];
  if (wells.length === 0) return 0;
  const decline = wellDeclineFactor(config, state);
  const summary = summarizeWells(wells);
  if (summary.lastThreshold === threshold && summary.lastDecline === decline) {
    return summary.lastLowCount;
  }
  const cutoff = threshold / decline;
  let count = 0;
  for (let i = 0; i < wells.length; i++) {
    if (Math.max(0, wells[i]!.dailyTonnes) < cutoff) count += 1;
  }
  summary.lastThreshold = threshold;
  summary.lastDecline = decline;
  summary.lastLowCount = count;
  return count;
}
