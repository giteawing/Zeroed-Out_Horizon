/**
 * Симулятор-бот. «Играет» вместо человека: тапает и покупает самое выгодное.
 * Нужен двум вещам:
 *   1) тест на длительность прохождения (ТЗ §5.3: 12–25 мин, цель 15–20);
 *   2) подбор winCost (scripts/balance-report.ts).
 * Живёт в src/, а не в tests/, чтобы его можно было гонять из скрипта.
 * Бот детерминированный (свой ГПСЧ) — тесты не «мигают».
 */
import { Game } from './game';
import { computeDerived, isUnlocked, levelOf, unlockBlocker, wellPricePerDailyTonne } from './economy';
import { isRepeatable } from './game';
import { createInitialState } from './state';
import { Rng } from './rng';
import type { Content, GameState, UpgradeDef } from './types';

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

    // Экспортная акция продаёт нефть со склада: ждём, пока резервуары
    // наполнятся хотя бы наполовину, и смотрим на мировую цену.
    const exportDef = content.byId.get('p_export');
    if (exportDef && (state.cooldowns.p_export ?? 0) <= 0 && isUnlocked(exportDef, state, game.derived().influence)) {
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
/** С какой доли от цены финала бот перестаёт тратить и начинает копить. */
const savingShare = 0.8;

export function decide(game: Game, content: Content, purchased: Set<string>): boolean {
  const state = game.state;
  const derived = game.derived();

  const winDef = content.upgrades.find((u) => u.win);
  const requirementsMet = (): boolean => content.config.winRequirements.every((req) => {
    if (req.upgrade && levelOf(state, req.upgrade) < (req.level ?? 1)) return false;
    if (req.balance !== undefined && state.totalEarned < req.balance) return false;
    if (req.influence !== undefined && derived.influence < req.influence) return false;
    return true;
  });

  if (winDef) {
    const blocker = unlockBlocker(winDef, state, derived.influence);
    if (game.checkBuy(winDef.id).ok) {
      const res = game.buy(winDef.id);
      if (res.ok) purchased.add(winDef.id);
      return res.ok;
    }
    // Копить на финал имеет смысл только после выполнения его обязательных
    // условий: иначе бот откладывал деньги и никогда не покупал Насос-Гигант.
    if (!blocker && requirementsMet() && state.coins >= winDef.baseCost * savingShare) return false;
  }

  // Что нужно для финала: бот покупает эти покупки, даже если они «дорогие».
  const needed = new Set<string>();
  for (const req of content.config.winRequirements) {
    if (!req.upgrade) continue;
    if (levelOf(state, req.upgrade) < (req.level ?? 1)) needed.add(req.upgrade);
  }

  for (const id of needed) {
    const reqDef = content.byId.get(id);
    if (!reqDef || !isUnlocked(reqDef, state, derived.influence)) continue;
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
    if (def.win || isRepeatable(def)) continue;
    const level = levelOf(state, def.id);
    if (level >= def.maxLevel) continue;
    const check = game.checkBuy(def.id);
    if (!check.unlocked || check.cooldownMs > 0) continue;
    const cost = check.cost;
    if (cost > state.coins) continue;
    candidates.push({
      def,
      score: estimatedGain(game, def, cost) / Math.max(1, cost),
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

/** Усреднённая активность обычного профиля, тапов в секунду. */
const SIMULATED_MANUAL_TAPS = 5 * 0.85;
const HUMAN_TAPS_ID = '__simulator_human_taps';

/**
 * Та же computeDerived, что и у игры, плюс условный источник ручных тапов.
 * Это позволяет сравнить экономику до/после без отдельных формул цен,
 * мощностей, переработки, налогов и scope-множителей.
 */
function derivedForSimulation(content: Content, state: GameState) {
  const humanTaps: UpgradeDef = {
    id: HUMAN_TAPS_ID,
    tab: 'technical',
    group: 'simulation',
    name: HUMAN_TAPS_ID,
    description: HUMAN_TAPS_ID,
    icon: 'well',
    type: 'autoTap',
    baseCost: 0,
    maxLevel: 1,
    effect: { value: SIMULATED_MANUAL_TAPS },
  };
  return computeDerived(
    content.config,
    [...content.upgrades, humanTaps],
    { ...state, levels: { ...state.levels, [HUMAN_TAPS_ID]: 1 } },
    [],
    content,
  );
}

function averageWellDaily(content: Content): number {
  return content.config.oil.wells.classes.reduce(
    (sum, cls) => sum + cls.chance * ((cls.minDailyTonnes + cls.maxDailyTonnes) / 2),
    0,
  ) / content.config.oil.wells.secondsPerDay;
}

/**
 * Оценка прироста — разница фактической производной экономики до и после
 * условного уровня. Для скважин добавляется их математическое ожидание;
 * реприватизация оценивается по её реальному бюджету 5–10× (среднее 7,5×).
 */
export function estimatedGain(game: Game, def: UpgradeDef, cost: number): number {
  const content = game.content;
  const before = derivedForSimulation(content, game.state);
  const e = def.effect;

  // Разовые и периодические выплаты не меняют computeDerived, поэтому для
  // них остаётся оценка темпа выплат, а не фиктивный постоянный прирост.
  if (def.type === 'oneShot') {
    return ((before.tapValue + before.grossPerSecond * 0.5) * (e.value ?? 1)) /
      (def.cooldownSeconds ?? 60);
  }
  if (def.type === 'periodic') {
    return ((before.tapValue + before.grossPerSecond * 0.5) * (e.value ?? 1)) /
      (e.seconds ?? 60);
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
  };
  if (def.type === 'well' || def.type === 'field') {
    const daily = def.id === 't_well'
      ? averageWellDaily(content)
      : (cost * 7.5) / wellPricePerDailyTonne(content.config);
    next.wells.push({ kind: 'unique', dailyTonnes: Math.max(1, daily) });
  }
  const after = derivedForSimulation(content, next);
  return Math.max(0, after.netPerSecond - before.netPerSecond);
}
