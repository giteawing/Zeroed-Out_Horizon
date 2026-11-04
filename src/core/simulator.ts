/**
 * Симулятор-бот. «Играет» вместо человека: тапает и покупает самое выгодное.
 * Нужен двум вещам:
 *   1) тест на длительность прохождения (ТЗ §5.3: 12–25 мин, цель 15–20);
 *   2) подбор winCost (scripts/balance-report.ts).
 * Живёт в src/, а не в tests/, чтобы его можно было гонять из скрипта.
 * Бот детерминированный (свой ГПСЧ) — тесты не «мигают».
 */
import { Game } from './game';
import { costFor, isUnlocked, levelOf, unlockBlocker } from './economy';
import { createInitialState } from './state';
import { Rng } from './rng';
import type { Content, DerivedStats, UpgradeDef } from './types';

export interface SimulatorOptions {
  /** Тапов в секунду (ТЗ: 4–6). */
  tapsPerSecond?: number;
  /** Доля тапов, которые игрок реально делает (устаёт, отвлекается). */
  tapDiligence?: number;
  /** Как часто бот пересматривает покупки, сек. */
  decisionIntervalSeconds?: number;
  /** Максимум игрового времени, сек. */
  maxSeconds?: number;
  /** Сид ГПСЧ. */
  seed?: number;
  /** Сколько секунд бот ждёт выгодной мировой цены для экспорта. */
  exportPatienceSeconds?: number;
  /** Порог мировой цены, выше которого бот «пихает нефть заграницу». */
  exportPriceThreshold?: number;
  /** Раз в сколько секунд снимать точку прогресса. */
  sampleSeconds?: number;
}

export interface Checkpoint {
  minute: number;
  coins: number;
  netPerSecond: number;
  tapValue: number;
}

export interface Sample {
  second: number;
  coins: number;
  totalEarned: number;
  netPerSecond: number;
  tapValue: number;
  purchases: number;
}

export interface SimulatorResult {
  won: boolean;
  /** Время до победы (или до лимита), сек. */
  seconds: number;
  coins: number;
  totalEarned: number;
  totalTaps: number;
  purchases: number;
  luxurySpent: number;
  achievements: number;
  checkpoints: Checkpoint[];
  /** Прогресс каждые sampleSeconds — для подбора winCost и отчётов. */
  samples: Sample[];
  purchasedIds: string[];
}

const STEP_MS = 1000;

export function runSimulation(content: Content, options: SimulatorOptions = {}): SimulatorResult {
  const opts: Required<SimulatorOptions> = {
    tapsPerSecond: 5,
    tapDiligence: 0.85,
    decisionIntervalSeconds: 1.5,
    maxSeconds: 60 * 30,
    seed: 20240601,
    exportPatienceSeconds: 40,
    exportPriceThreshold: 1.12,
    sampleSeconds: 30,
    ...options,
  };

  const rng = new Rng(opts.seed ^ 0x5f3759df);
  const state = createInitialState(content.config, opts.seed);
  const game = new Game(content, state);
  const checkpoints: Checkpoint[] = [];
  const samples: Sample[] = [];
  const purchased = new Set<string>();

  const tapEveryMs = 1000 / Math.max(0.1, opts.tapsPerSecond);
  let tapAcc = 0;
  let nextDecisionMs = 0;
  let exportWaitMs = 0;
  let elapsed = 0;
  let lastCheckpointMinute = 0;
  let lastSampleSecond = -1;

  while (elapsed < opts.maxSeconds * 1000) {
    elapsed += STEP_MS;

    tapAcc += STEP_MS;
    while (tapAcc >= tapEveryMs) {
      tapAcc -= tapEveryMs;
      if (rng.next() < opts.tapDiligence) game.tap();
    }

    game.update(STEP_MS);

    if (elapsed >= nextDecisionMs) {
      nextDecisionMs = elapsed + opts.decisionIntervalSeconds * 1000;
      decide(game, content, purchased);
    }

    const exportDef = content.byId.get('p_export');
    if (exportDef && (state.cooldowns.p_export ?? 0) <= 0 && isUnlocked(exportDef, state)) {
      if (state.worldPrice >= opts.exportPriceThreshold) {
        if (game.buy('p_export').ok) {
          exportWaitMs = 0;
          purchased.add('p_export');
        }
      } else {
        exportWaitMs += STEP_MS;
        if (exportWaitMs >= opts.exportPatienceSeconds * 1000) {
          if (game.buy('p_export').ok) {
            exportWaitMs = 0;
            purchased.add('p_export');
          }
        }
      }
    }

    const minute = Math.floor(elapsed / 60000);
    if (minute !== lastCheckpointMinute && minute % 2 === 0) {
      lastCheckpointMinute = minute;
      checkpoints.push({
        minute,
        coins: state.coins,
        netPerSecond: game.derived().netPerSecond,
        tapValue: game.derived().tapValue,
      });
    }

    const sampleSecond = Math.floor(elapsed / (opts.sampleSeconds * 1000));
    if (sampleSecond !== lastSampleSecond) {
      lastSampleSecond = sampleSecond;
      const d = game.derived();
      samples.push({
        second: elapsed / 1000,
        coins: state.coins,
        totalEarned: state.totalEarned,
        netPerSecond: d.netPerSecond,
        tapValue: d.tapValue,
        purchases: state.totalPurchases,
      });
    }

    if (state.won) break;
  }

  return {
    won: state.won,
    seconds: state.won ? elapsed / 1000 : opts.maxSeconds,
    coins: state.coins,
    totalEarned: state.totalEarned,
    totalTaps: state.totalTaps,
    purchases: state.totalPurchases,
    luxurySpent: state.luxurySpent,
    achievements: state.achievements.length,
    checkpoints,
    samples,
    purchasedIds: [...purchased],
  };
}

/**
 * Одна итерация покупок. Приоритет: финальная цель (если готова) →
 * лучшее соотношение «прирост дохода / цена».
 */
export function decide(game: Game, content: Content, purchased: Set<string>): boolean {
  const state = game.state;
  const derived = game.derived();

  const winDef = content.upgrades.find((u) => u.win);
  if (winDef) {
    const blocker = unlockBlocker(winDef, state);
    if (!blocker && state.coins >= winDef.baseCost) {
      const res = game.buy(winDef.id);
      if (res.ok) purchased.add(winDef.id);
      return res.ok;
    }
  }

  const candidates: Array<{ def: UpgradeDef; score: number }> = [];
  for (const def of content.upgrades) {
    if (def.win) continue;
    const level = levelOf(state, def.id);
    if (level >= def.maxLevel) continue;
    if (!isUnlocked(def, state)) continue;
    if ((state.cooldowns[def.id] ?? 0) > 0) continue;
    const cost = def.baseCost > 0 ? costFor(content.config, def, level) : 0;
    if (cost > state.coins) continue;
    candidates.push({ def, score: estimatedGain(def, derived, cost) / Math.max(1, cost) });
  }

  if (candidates.length === 0) return false;
  candidates.sort((a, b) => b.score - a.score);

  let boughtAny = false;
  for (const candidate of candidates.slice(0, 4)) {
    if (game.buy(candidate.def.id).ok) {
      purchased.add(candidate.def.id);
      boughtAny = true;
    }
  }
  return boughtAny;
}

/** Оценка прироста дохода за секунду от покупки одного уровня. */
export function estimatedGain(def: UpgradeDef, derived: DerivedStats, cost: number): number {
  const e = def.effect;
  const netFactor = 1 - derived.taxRate;
  switch (def.type) {
    case 'perTap':
      return (e.value ?? 0) * 5 * 0.85 * derived.multiplier;
    case 'passive':
      return (e.value ?? 0) * netFactor * derived.priceMultiplier * derived.multiplier;
    case 'multiplier': {
      const scope = e.scope ?? 'all';
      const base = scope === 'tap' ? derived.tapValue * 5 : derived.grossPerSecond * netFactor;
      return base * ((e.factor ?? 1) - 1);
    }
    case 'taxCut':
      return derived.grossPerSecond * ((e.percent ?? 0) / 100);
    case 'costCut':
      return derived.expensesPerSecond * ((e.percent ?? 0) / 100);
    case 'priceBoost':
      return derived.grossPerSecond * ((e.factor ?? 1) - 1);
    case 'oneShot':
      return ((derived.tapValue + derived.grossPerSecond * 0.5) * (e.value ?? 1)) /
        (def.cooldownSeconds ?? 60);
    case 'periodic':
      return ((derived.tapValue + derived.grossPerSecond * 0.5) * (e.value ?? 1)) /
        (e.seconds ?? 60);
    case 'gamble': {
      const chance = e.chance ?? 0.5;
      const factor = e.factor ?? 2;
      const ev = chance * cost * (factor - 1) - (1 - chance) * cost;
      return ev / (e.seconds ?? 30);
    }
    case 'autoTap':
      return (e.value ?? 0) * derived.tapValue;
    case 'luxury':
      // Роскошь не приносит дохода: бот берёт её только «на сдачу» (почти нулевой скор).
      return 1e-9;
    default:
      return 0;
  }
}
