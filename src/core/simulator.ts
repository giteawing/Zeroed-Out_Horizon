/**
 * Симулятор-бот. Непрерывно добывает сырьё, управляет потоками и покупает самое выгодное.
 * Нужен двум вещам:
 *   1) тест на длительность прохождения (ТЗ §5.3: 12–25 мин, цель 15–20);
 *   2) подбор winCost (scripts/balance-report.ts).
 * Живёт в src/, а не в tests/, чтобы его можно было гонять из скрипта.
 * Бот детерминированный (свой ГПСЧ) — тесты не «мигают».
 */
import { Game } from './game';
import { adjustCurrencyCost, bankScaleOf, computeDerived, eventPayout, isUnlocked, levelOf, unlockBlocker, wellPricePerDailyTonne, winCostOf } from './economy';
import { isRepeatable } from './game';
import { createInitialState } from './state';
import type { Content, GameState, UpgradeDef } from './types';

export interface SimulatorOptions {
  /** Стандартная стратегия игнорирует cooldown-действия; optimizer оценивает и использует их. */
  strategy?: 'standard' | 'optimizer';
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
  productionRate: number;
}

export interface Sample {
  second: number;
  coins: number;
  totalEarned: number;
  netPerSecond: number;
  productionRate: number;
  /** Нефть в резервуарах на момент сэмпла, тонн. */
  oil: number;
  purchases: number;
}

export interface SimulatorResult {
  won: boolean;
  /** Время до победы (или до лимита), сек. */
  seconds: number;
  coins: number;
  totalEarned: number;
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
    strategy: 'standard',
    decisionIntervalSeconds: 1.5,
    maxSeconds: 60 * 30,
    seed: 20240601,
    exportPatienceSeconds: 40,
    exportPriceThreshold: 1.12,
    sampleSeconds: 30,
    ...options,
  };

  const state = createInitialState(content.config, opts.seed);
  const game = new Game(content, state);
  const checkpoints: Checkpoint[] = [];
  const samples: Sample[] = [];
  const purchased = new Set<string>();

  let nextDecisionMs = 0;
  let exportWaitMs = 0;
  let elapsed = 0;
  let lastCheckpointMinute = 0;
  let lastSampleSecond = -1;

  while (elapsed < opts.maxSeconds * 1000) {
    elapsed += STEP_MS;

    game.update(STEP_MS);

    if (elapsed >= nextDecisionMs) {
      nextDecisionMs = elapsed + opts.decisionIntervalSeconds * 1000;
      decide(
        game,
        content,
        purchased,
        opts.strategy === 'optimizer',
      );
    }

    // Экспортная акция продаёт нефть со склада: ждём, пока резервуары
    // наполнятся хотя бы наполовину, и смотрим на мировую цену.
    const exportDef = content.byId.get('p_export');
    if (exportDef && (state.cooldowns.p_export ?? 0) <= 0 && isUnlocked(exportDef, state, game.derived().influence, content.config)) {
      const derived = game.derived();
      const full = derived.oilCapacity > 0 ? state.oil / derived.oilCapacity : 0;
      if (full >= 0.5 && state.worldPrice >= opts.exportPriceThreshold) {
        if (game.buy('p_export').ok) {
          exportWaitMs = 0;
          purchased.add('p_export');
        }
      } else {
        exportWaitMs += STEP_MS;
        if (exportWaitMs >= opts.exportPatienceSeconds * 1000 && full >= 0.5) {
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
        productionRate: game.derived().oilPerSecond,
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
        productionRate: d.oilPerSecond,
        oil: state.oil,
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
/** С какой доли от цены финала бот перестаёт тратить и начинает копить. */
const savingShare = 0.8;

export function decide(
  game: Game,
  content: Content,
  purchased: Set<string>,
  allowRepeatables = false,
): boolean {
  const state = game.state;
  const derived = game.derived();

  const winDef = content.upgrades.find((u) => u.win);
  const requirementsMet = (): boolean => content.config.winRequirements.every((req) => {
    if (req.upgrade && levelOf(state, req.upgrade) < (req.level ?? 1)) return false;
    if (req.balance !== undefined && state.totalEarned < adjustCurrencyCost(content.config, req.balance)) return false;
    if (req.influence !== undefined && derived.influence < req.influence) return false;
    return true;
  });

  if (winDef) {
    const blocker = unlockBlocker(winDef, state, derived.influence, content.config);
    if (game.checkBuy(winDef.id).ok) {
      const res = game.buy(winDef.id);
      if (res.ok) purchased.add(winDef.id);
      return res.ok;
    }
    // Копить на финал имеет смысл только после выполнения его обязательных
    // условий: иначе бот откладывал деньги и никогда не покупал Насос-Гигант.
    if (!blocker && requirementsMet() && state.coins >= winCostOf(content.config, content.upgrades) * savingShare) return false;
  }

  // Что нужно для финала: бот покупает эти покупки, даже если они «дорогие».
  const needed = new Set<string>();
  for (const req of content.config.winRequirements) {
    if (!req.upgrade) continue;
    if (levelOf(state, req.upgrade) < (req.level ?? 1)) needed.add(req.upgrade);
  }

  for (const id of needed) {
    const reqDef = content.byId.get(id);
    if (!reqDef || !isUnlocked(reqDef, state, derived.influence, content.config)) continue;
    const check = game.checkBuy(id);
    if (!check.unlocked || check.cooldownMs > 0) continue;
    if (check.cost <= state.coins) {
      if (game.buy(id).ok) {
        purchased.add(id);
        return true;
      }
      continue;
    }
    // Копим только на действительно близкую обязательную покупку. Порог
    // «40×» останавливал развитие на полтора десятка минут раньше, чем
    // доход мог окупить Насос-Гигант.
    if (check.cost <= state.coins * 1.5) return false;
  }

  const candidates: Array<{ def: UpgradeDef; score: number }> = [];
  for (const def of content.upgrades) {
    if (def.win || (isRepeatable(def) && (!allowRepeatables || def.id === 'p_export'))) continue;
    const level = levelOf(state, def.id);
    if (level >= def.maxLevel && !isRepeatable(def)) continue;
    const check = game.checkBuy(def.id);
    if (!check.unlocked || check.cooldownMs > 0) continue;
    const cost = check.cost;
    if (cost > state.coins) continue;
    const gain = estimatedGain(game, def, cost);
    if (allowRepeatables && isRepeatable(def) && gain <= 0) continue;
    candidates.push({
      def,
      score: gain / Math.max(1, cost),
    });
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

/** Симулятор использует ту же непрерывную производственную модель, что и игра. */
function derivedForSimulation(content: Content, state: GameState) {
  return computeDerived(content.config, content.upgrades, state, [], content);
}

function averageWellDaily(content: Content): number {
  return content.config.oil.wells.classes.reduce(
    (sum, cls) => sum + cls.chance * ((cls.minDailyTonnes + cls.maxDailyTonnes) / 2),
    0,
  );
}

/**
 * Оценка прироста — разница фактической производной экономики до и после
 * условного уровня. Для скважин добавляется их математическое ожидание;
 * реприватизация оценивается по её реальному бюджету 5–10× (среднее 7,5×).
 */
export function estimatedGain(
  game: Game,
  def: UpgradeDef,
  cost: number,
  ): number {
  const content = game.content;
  const before = derivedForSimulation(content, game.state);
  const e = def.effect;

  // Считаем по той же денежной формуле, что и реальная выплата игры.
  if (def.type === 'oneShot') {
    const payout = eventPayout(def, before, levelOf(game.state, def.id) + 1, cost);
    const bankBonus = def.effect.bankScale ? bankScaleOf(content.upgrades, game.state) : 1;
    return (payout * bankBonus) / (def.cooldownSeconds ?? 60);
  }
  if (def.type === 'periodic') {
    const payout = eventPayout(def, before, levelOf(game.state, def.id) + 1, 0);
    return payout / (e.seconds ?? 60);
  }
  if (def.type === 'gamble') {
    const chance = e.chance ?? 0.5;
    const factor = e.factor ?? 2;
    const ev = chance * cost * (factor - 1) - (1 - chance) * cost;
    return ev / (e.seconds ?? 30);
  }
  if (def.type === 'luxury') return 1e-9;

  const level = levelOf(game.state, def.id);
  const next: GameState = {
    ...game.state,
    levels: { ...game.state.levels, [def.id]: level + 1 },
    wells: game.state.wells.map((well) => ({ ...well })),
    capitalFlightStartedAtMs: e.capitalFlightPerSecond && game.state.capitalFlightStartedAtMs === null
      ? game.state.clockMs
      : game.state.capitalFlightStartedAtMs,
  };
  if (def.type === 'well' || def.type === 'field') {
    const daily = def.id === 't_well'
      ? averageWellDaily(content)
      : (cost * 7.5) / wellPricePerDailyTonne(content.config, undefined, game.derived().exchangeRate);
    next.wells.push({ kind: 'unique', dailyTonnes: Math.max(1, daily) });
  }
  const after = derivedForSimulation(content, next);
  return Math.max(0, after.netPerSecond - before.netPerSecond);
}
