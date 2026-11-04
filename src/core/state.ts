/**
 * Состояние игры: создание, миграция (мягкое слияние), сериализация, офлайн-доход.
 */
import type { Content, GameConfig, GameState } from './types';
import { randomSeed } from './rng';

export const SAVE_KEY = 'zeroed-out-horizon:save:v1';
export const SAVE_VERSION = 1;

export function createInitialState(config: GameConfig, seed = randomSeed()): GameState {
  return {
    version: SAVE_VERSION,
    coins: config.startCoins,
    totalEarned: config.startCoins,
    totalTaps: 0,
    totalPurchases: 0,
    luxurySpent: 0,
    levels: {},
    cooldowns: {},
    timers: {},
    gambles: [],
    achievements: [],
    clockMs: 0,
    playtimeMs: 0,
    savedAtWallMs: Date.now(),
    worldPrice: config.worldPrice.startPrice,
    soundOn: true,
    particlesOn: true,
    won: false,
    wonAtMs: null,
    rngSeed: seed,
  };
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Мягкое слияние сохранения с дефолтами: старые и битые сейвы не ломают новую версию. */
export function normalizeState(raw: unknown, config: GameConfig, content: Content): GameState {
  const base = createInitialState(config);
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Partial<GameState>;
  const state: GameState = { ...base };

  state.coins = Math.max(0, num(src.coins, base.coins));
  state.totalEarned = Math.max(state.coins, num(src.totalEarned, base.totalEarned));
  state.totalTaps = Math.max(0, num(src.totalTaps, 0));
  state.totalPurchases = Math.max(0, num(src.totalPurchases, 0));
  state.luxurySpent = Math.max(0, num(src.luxurySpent, 0));
  state.clockMs = Math.max(0, num(src.clockMs, 0));
  state.playtimeMs = Math.max(0, num(src.playtimeMs, 0));
  state.savedAtWallMs = num(src.savedAtWallMs, Date.now());
  state.worldPrice = Math.min(
    config.worldPrice.max,
    Math.max(config.worldPrice.min, num(src.worldPrice, base.worldPrice)),
  );
  state.soundOn = typeof src.soundOn === 'boolean' ? src.soundOn : true;
  state.particlesOn = typeof src.particlesOn === 'boolean' ? src.particlesOn : true;
  state.won = src.won === true;
  state.wonAtMs = typeof src.wonAtMs === 'number' ? src.wonAtMs : null;
  state.rngSeed = num(src.rngSeed, base.rngSeed) >>> 0;

  const levels: Record<string, number> = {};
  if (src.levels && typeof src.levels === 'object') {
    for (const [id, value] of Object.entries(src.levels)) {
      const def = content.byId.get(id);
      if (!def) continue;
      const level = Math.floor(num(value, 0));
      if (level > 0) levels[id] = Math.min(level, def.maxLevel);
    }
  }
  state.levels = levels;

  const cooldowns: Record<string, number> = {};
  if (src.cooldowns && typeof src.cooldowns === 'object') {
    for (const [id, value] of Object.entries(src.cooldowns)) {
      if (content.byId.has(id)) cooldowns[id] = Math.max(0, num(value, 0));
    }
  }
  state.cooldowns = cooldowns;

  const timers: Record<string, number> = {};
  if (src.timers && typeof src.timers === 'object') {
    for (const [id, value] of Object.entries(src.timers)) {
      if (content.byId.has(id)) timers[id] = Math.max(0, num(value, 0));
    }
  }
  state.timers = timers;

  state.gambles = Array.isArray(src.gambles)
    ? src.gambles
        .filter(
          (g): g is GameState['gambles'][number] =>
            !!g && typeof g === 'object' && content.byId.has((g as { id?: string }).id ?? ''),
        )
        .map((g) => ({
          id: g.id,
          amount: Math.max(0, num(g.amount, 0)),
          factor: Math.max(1, num(g.factor, 1)),
          resolveAt: num(g.resolveAt, state.clockMs),
        }))
    : [];

  state.achievements = Array.isArray(src.achievements)
    ? src.achievements.filter((id): id is string => typeof id === 'string')
    : [];

  return state;
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function parseSave(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface OfflineReport {
  seconds: number;
  coins: number;
  capped: boolean;
}

/**
 * Офлайн-доход: считаем по системным часам, но не больше capSeconds (5 минут),
 * иначе игрок «просыпается» уже с победой и темп 15–20 минут ломается.
 */
export function offlineReport(
  config: GameConfig,
  netPerSecond: number,
  savedAtWallMs: number,
  nowWallMs: number,
): OfflineReport {
  const elapsedMs = Math.max(0, nowWallMs - savedAtWallMs);
  const capMs = config.offline.capSeconds * 1000;
  const capped = elapsedMs > capMs;
  const effectiveMs = Math.min(elapsedMs, capMs);
  const seconds = effectiveMs / 1000;
  return { seconds, coins: Math.floor(netPerSecond * seconds * config.offline.efficiency), capped };
}
