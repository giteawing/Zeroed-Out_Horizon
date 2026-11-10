/**
 * Состояние игры: создание, миграция (мягкое слияние), сериализация, офлайн-доход.
 */
import type { Content, GameConfig, GameState, Well } from './types';
import { randomSeed } from './rng';

export const SAVE_KEY = 'zeroed-out-horizon:save:v2';
export const SAVE_VERSION = 3;

export function createInitialState(config: GameConfig, seed = randomSeed()): GameState {
  return {
    version: SAVE_VERSION,
    coins: config.startCoins,
    oil: config.oil.startOil,
    products: 0,
    shipTimerMs: 0,
    expensesAccrued: 0,
    pipeSoldSinceShip: 0,
    spillCrudePerSecond: 0,
    spillProductsPerSecond: 0,
    totalEarned: config.startCoins,
    totalSold: 0,
    flowControl: {
      contract: { mode: 'auto', value: 0 },
      export: { mode: 'auto', value: 0 },
      refine: { mode: 'auto', value: 0 },
    },
    log: [],
    totalPurchases: 0,
    luxurySpent: 0,
    levels: {},
    cooldowns: {},
    timers: {},
    wells: config.oil.starterWellDailyTonnes > 0
      ? [{ kind: 'ordinary', dailyTonnes: config.oil.starterWellDailyTonnes }]
      : [],
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
    worldPriceSeed: seed >>> 0,
    capitalFlightStartedAtMs: null,
  };
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Старые id достижений сохраняются в сейвах с версии игры на тапах. */
const LEGACY_ACHIEVEMENT_IDS: Record<string, string> = {
  a_tap100: 'a_sold_1000',
  a_tap1000: 'a_sold_100000',
};

/** Мягкое слияние сохранения с дефолтами: старые и битые сейвы не ломают новую версию. */
export function normalizeState(raw: unknown, config: GameConfig, content: Content): GameState {
  const base = createInitialState(config);
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Partial<GameState>;
  const state: GameState = { ...base };

  state.coins = Math.max(0, num(src.coins, base.coins));
  state.oil = Math.max(0, num((src as { oil?: number }).oil, base.oil));
  state.products = Math.max(0, num(src.products, 0));
  state.shipTimerMs = Math.max(0, num(src.shipTimerMs, 0));
  state.expensesAccrued = Math.max(0, num(src.expensesAccrued, 0));
  state.pipeSoldSinceShip = Math.max(0, num(src.pipeSoldSinceShip, 0));
  // Не переносим расход трубы в новое окно, если таймер уже закрыт.
  if (state.shipTimerMs <= 0) state.pipeSoldSinceShip = 0;
  state.spillCrudePerSecond = Math.max(0, num(src.spillCrudePerSecond, 0));
  state.spillProductsPerSecond = Math.max(0, num(src.spillProductsPerSecond, 0));
  state.totalSold = Math.max(0, num((src as { totalSold?: number }).totalSold, 0));
  state.totalEarned = Math.max(state.coins, num(src.totalEarned, base.totalEarned));
  state.totalPurchases = Math.max(0, num(src.totalPurchases, 0));
  const rawFlowControl = (src as { flowControl?: unknown }).flowControl;
  if (rawFlowControl && typeof rawFlowControl === 'object') {
    const controls = rawFlowControl as Partial<GameState['flowControl']>;
    for (const channel of ['contract', 'export', 'refine'] as const) {
      const setting = controls[channel];
      if (!setting || typeof setting !== 'object') continue;
      const value = num(setting.value, 0);
      state.flowControl[channel] = setting.mode === 'fixed' && value >= 0
        ? { mode: 'fixed', value: Math.min(config.oil.maxProductionPerSecond, value) }
        : { mode: 'auto', value: 0 };
    }
  }
  // В старых сохранениях поля распределения нет: все каналы переходят в авто.
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
  if (state.won && state.wonAtMs === null) state.wonAtMs = state.playtimeMs;
  state.rngSeed = num(src.rngSeed, base.rngSeed) >>> 0;
  state.worldPriceSeed = num((src as { worldPriceSeed?: number }).worldPriceSeed, state.rngSeed) >>> 0;
  const flightStarted = (src as { capitalFlightStartedAtMs?: number | null }).capitalFlightStartedAtMs;
  state.capitalFlightStartedAtMs = typeof flightStarted === 'number' && Number.isFinite(flightStarted)
    ? Math.max(0, flightStarted)
    : null;

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

  // Скважины: дебит каждой сохраняется, потому что он выпал случайно.
  const wells: Well[] = [];
  if (Array.isArray(src.wells)) {
    for (const w of src.wells.slice(0, 5000)) {
      if (!w || typeof w !== 'object') continue;
      const kind = (w as { kind?: unknown }).kind;
      const daily = num((w as { dailyTonnes?: unknown }).dailyTonnes, 0);
      if (daily <= 0) continue;
      wells.push({
        kind: kind === 'good' || kind === 'unique' ? kind : 'ordinary',
        dailyTonnes: daily,
      });
    }
  }
  state.wells = wells;

  // Старые сейвы хранили добычу в уровнях пассивных покупок. Переносим её
  // в скважины, чтобы прогресс не обнулился: суммарный дебит остаётся прежним.
  if (state.wells.length === 0) {
    let legacyDaily = 0;
    for (const [id, level] of Object.entries(state.levels)) {
      const def = content.byId.get(id);
      if (!def || def.type !== 'passive' || !def.effect.value) continue;
      legacyDaily += def.effect.value * level * (config.oil.wells?.secondsPerDay || 86400);
    }
    if (legacyDaily > 0) {
      state.wells = [{ kind: 'unique', dailyTonnes: Math.round(legacyDaily) }];
    }
  }
  // Старые сохранения без скважин получают стартовый дебит, чтобы переход
  // с ручной добычи на непрерывную не оставлял партию без источника сырья.
  if (state.wells.length === 0 && config.oil.starterWellDailyTonnes > 0) {
    state.wells = [{ kind: 'ordinary', dailyTonnes: config.oil.starterWellDailyTonnes }];
  }

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

  state.log = Array.isArray((src as { log?: unknown }).log)
    ? ((src as { log: unknown[] }).log
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .slice(0, 40)
        .map((e) => ({
          at: Math.max(0, num(e.at, 0)),
          kind: (typeof e.kind === 'string' ? e.kind : 'event') as GameState['log'][number]['kind'],
          upgradeId: typeof e.upgradeId === 'string' ? e.upgradeId : undefined,
          channel:
            typeof e.channel === 'string'
              ? (e.channel as GameState['log'][number]['channel'])
              : undefined,
          tonnes: typeof e.tonnes === 'number' ? e.tonnes : undefined,
          price: typeof e.price === 'number' ? e.price : undefined,
          money: typeof e.money === 'number' ? e.money : undefined,
          textKey: typeof e.textKey === 'string' ? e.textKey : undefined,
          count: typeof e.count === 'number' ? e.count : undefined,
          spill: e.spill === 'crude' || e.spill === 'products' ? e.spill : undefined,
          place: typeof e.place === 'string' ? e.place : undefined,
        })))
    : [];

  state.achievements = Array.isArray(src.achievements)
    ? [...new Set(src.achievements
        .filter((id): id is string => typeof id === 'string')
        .map((id) => LEGACY_ACHIEVEMENT_IDS[id] ?? id))]
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
