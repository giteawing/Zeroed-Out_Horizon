/**
 * Симулятор-бот. Непрерывно добывает сырьё, управляет потоками и покупает самое выгодное.
 * Нужен двум вещам:
 *   1) тест на длительность прохождения (ТЗ §5.3: 12–25 мин, цель 15–20);
 *   2) подбор winCost (scripts/balance-report.ts).
 * Живёт в src/, а не в tests/, чтобы его можно было гонять из скрипта.
 * Бот детерминированный (свой ГПСЧ) — тесты не «мигают».
 */
import { Game } from './game';
import {
  bankScaleOf,
  computeDerived,
  eventPayout,
  grantsField,
  isUnlocked,
  levelOf,
  unlockBlocker,
  wellPricePerDailyTonne,
  winCostOf,
  winRequirementBlocker,
} from './economy';
import { isRepeatable } from './game';
import { createInitialState } from './state';
import type { Content, DerivedStats, GameState, UpgradeDef } from './types';

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
  /**
   * Оптимизатор нажимает операции убыточного банка, как только они открыты.
   * Обычные профили банк не покупают: балансовые тесты тогда не видят
   * игрока, который «жмёт кнопки» (REVIEW D1).
   */
  useBank?: boolean;
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

/**
 * Откуда пришли деньги за партию, ₦. Сумма равна `totalEarned`.
 * Нужна отчёту баланса: периодика, банк и ставки идут мимо налога и расходов,
 * и их доля в заработке — решение по балансу, за которым надо следить.
 */
export interface EarnedBySource {
  /** Общая касса с расходами и налогом: нефть, нефтепродукты, проценты, демпфер, вывоз капитала. */
  sales: number;
  /** Периодические выплаты покупок — мимо налога и расходов. */
  periodic: number;
  /** Разовые выплаты кнопок-действий, прошедшие кассу с налогом. */
  oneShot: number;
  /** Операции убыточного банка — мимо налога и расходов. */
  bank: number;
  /** Выигрыши рисковых схем (ставки при этом списаны как цена покупки). */
  gamble: number;
}

export interface SimulatorResult {
  won: boolean;
  /** Время до победы (или до лимита), сек. */
  seconds: number;
  coins: number;
  totalEarned: number;
  earnedBySource: EarnedBySource;
  purchases: number;
  luxurySpent: number;
  achievements: number;
  checkpoints: Checkpoint[];
  /** Прогресс каждые sampleSeconds — для подбора winCost и отчётов. */
  samples: Sample[];
  purchasedIds: string[];
}

/** Профиль игрока для проверки баланса. */
export interface BalanceProfile {
  name: string;
  options: SimulatorOptions;
}

/**
 * Четыре профиля, на которых проверяется длительность партии (12–25 минут).
 * Единственный список: его используют балансовые тесты и
 * `scripts/balance-report.ts`, поэтому отчёт и тесты не расходятся.
 */
export const BALANCE_PROFILES: readonly BalanceProfile[] = [
  { name: 'быстрый экспорт', options: { exportPatienceSeconds: 20, seed: 101 } },
  { name: 'сбалансированная логистика', options: { exportPatienceSeconds: 40, seed: 202 } },
  { name: 'терпеливый экспорт', options: { exportPatienceSeconds: 60, seed: 303 } },
  {
    name: 'оптимизатор повторяемых действий',
    options: {
      exportPatienceSeconds: 40,
      seed: 404,
      strategy: 'optimizer',
      useBank: true,
    },
  },
];

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
    useBank: false,
    ...options,
  };

  const state = createInitialState(content.config, opts.seed);
  const game = new Game(content, state);
  const checkpoints: Checkpoint[] = [];
  const samples: Sample[] = [];
  const purchased = new Set<string>();

  // Учёт источников дохода по событиям игры. Слушатель ничего не меняет:
  // ход партии с ним тот же, что и без него.
  const untracked = { periodic: 0, oneShot: 0, bank: 0, gamble: 0 };
  game.on((event) => {
    if (event.type === 'periodic') untracked.periodic += event.amount;
    else if (event.type === 'gambleResult') untracked.gamble += event.amount;
    else if (event.type === 'oneShot') {
      const effect = content.byId.get(event.id)?.effect;
      if (effect?.launder) untracked.bank += event.amount;
      // Разовая продажа нефти — обычная выручка: остаётся в общей кассе.
      else if (!effect?.sellsOil) untracked.oneShot += event.amount;
    }
  });

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
        opts.useBank,
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
    earnedBySource: {
      sales: Math.max(
        0,
        state.totalEarned - untracked.periodic - untracked.oneShot - untracked.bank - untracked.gamble,
      ),
      ...untracked,
    },
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
  useBank = false,
): boolean {
  const state = game.state;
  const derived = game.derived();

  // Игрок-оптимизатор держит убыточный банк и нажимает операции, как только
  // они открыты: выплаты идут мимо налога и расходов, а боты обычных
  // профилей их не видят (REVIEW D1).
  if (useBank) {
    const bank = content.byId.get('p_badbank');
    if (bank && game.checkBuy(bank.id).ok && game.buy(bank.id).ok) {
      purchased.add(bank.id);
      return true;
    }
    // Операции банка открываются уровнями «масштаба»: пока их нет, купленный
    // банк не приносит ничего. Игрок, который держит банк, докупает масштаб.
    const scale = content.byId.get('p_bank_scale');
    if (scale && levelOf(state, 'p_badbank') > 0 && game.checkBuy(scale.id).ok && game.buy(scale.id).ok) {
      purchased.add(scale.id);
      return true;
    }
    for (const def of content.upgrades) {
      if (!def.effect.launder || !isRepeatable(def)) continue;
      if (game.checkBuy(def.id).ok && game.buy(def.id).ok) {
        purchased.add(def.id);
        return true;
      }
    }
  }

  const winDef = content.upgrades.find((u) => u.win);
  const requirementsMet = (): boolean =>
    winRequirementBlocker(content.config, state, derived.influence) === null;

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
  // Пока идёт перебор, состояние не меняется: экономика «до покупки» у всех
  // кандидатов одна, и считать её для каждого заново незачем.
  let before: DerivedStats | undefined;
  for (const def of content.upgrades) {
    if (def.win || (isRepeatable(def) && (!allowRepeatables || def.id === 'p_export'))) continue;
    const level = levelOf(state, def.id);
    if (level >= def.maxLevel && !isRepeatable(def)) continue;
    const check = game.checkBuy(def.id);
    if (!check.unlocked || check.cooldownMs > 0) continue;
    const cost = check.cost;
    if (cost > state.coins) continue;
    before ??= derivedForSimulation(content, state);
    const gain = estimatedGain(game, def, cost, before);
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
 *
 * `before` — экономика текущего состояния. Её можно передать, если она уже
 * посчитана для этого же состояния; по умолчанию считается здесь.
 */
export function estimatedGain(
  game: Game,
  def: UpgradeDef,
  cost: number,
  before: DerivedStats = derivedForSimulation(game.content, game.state),
): number {
  const content = game.content;
  const e = def.effect;

  // Считаем по той же денежной формуле, что и реальная выплата игры.
  if (def.type === 'oneShot') {
    const payout = eventPayout(def, before, levelOf(game.state, def.id) + 1);
    const bankBonus = def.effect.bankScale ? bankScaleOf(content.upgrades, game.state) : 1;
    return (payout * bankBonus) / (def.cooldownSeconds ?? 60);
  }
  if (def.type === 'periodic') {
    const payout = eventPayout(def, before, levelOf(game.state, def.id) + 1);
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
    // Массив скважин неизменяемый, поэтому копия не нужна: ссылка общая.
    capitalFlightStartedAtMs: e.capitalFlightPerSecond && game.state.capitalFlightStartedAtMs === null
      ? game.state.clockMs
      : game.state.capitalFlightStartedAtMs,
  };
  if (def.type === 'well' || def.type === 'field') {
    // Месторождение оценивается по бюджету приза, одиночная скважина — по
    // среднему дебиту. Правило «это месторождение» одно — `grantsField()`.
    const daily = grantsField(def)
      ? (cost * 7.5) / wellPricePerDailyTonne(content.config, undefined, game.derived().exchangeRate)
      : averageWellDaily(content);
    next.wells = [...game.state.wells, { kind: 'unique', dailyTonnes: Math.max(1, daily) }];
  }
  const after = derivedForSimulation(content, next);
  return Math.max(0, after.netPerSecond - before.netPerSecond);
}
