/**
 * Покупки: цены, пакетная доступность и условия разблокировки.
 * Только расчёты — состояние игры здесь не меняется.
 */
import type { GameConfig, GameState, UnlockRequirement, UpgradeDef } from '../types';

export function levelOf(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/**
 * Сжимает денежные значения по общей кривой:
 * значения до anchor не меняются, поздние цены растут степенно.
 * Это сохраняет стартовую экономику и делает финальные покупки достижимыми.
 */
export function adjustCurrencyCost(config: GameConfig, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const anchor = Math.max(1, config.currencyCostCurve?.anchor ?? 100_000);
  const exponent = Math.min(1, Math.max(0.01, config.currencyCostCurve?.exponent ?? 1));
  if (value <= anchor) return Math.round(value);
  return Math.max(1, Math.round(anchor * Math.pow(value / anchor, exponent)));
}

/** Строительный CAPEX дорожает при девальвации; политические услуги не индексируются. */
export function constructionCostMultiplier(
  config: GameConfig,
  def: UpgradeDef,
  exchangeRate = config.exchangeRate.initial,
): number {
  const isCapitalAsset = Boolean(def.assetKind) || def.type === 'well' || def.type === 'field';
  if (!isCapitalAsset) return 1;
  const elasticity = Math.max(0, config.exchangeRate.constructionCostElasticity);
  return Math.pow(Math.max(config.exchangeRate.initial, exchangeRate), elasticity);
}

/** Цена следующего уровня: nominal baseCost · growth^level, общая кривая и индекс CAPEX. */
export function costFor(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  if (def.baseCost <= 0) return 0;
  const growth = def.costGrowth ?? config.costGrowth;
  const curved = adjustCurrencyCost(config, def.baseCost * Math.pow(growth, level));
  return Math.round(curved * constructionCostMultiplier(config, def, exchangeRate));
}

/** Суммарная цена count уровней подряд, начиная с текущего level. */
export function totalCostFor(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  count: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += costFor(config, def, level + i, exchangeRate);
  return sum;
}

/** Сколько уровней можно купить на coins (с учётом maxLevel и лимита за раз). */
export function affordableLevels(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  coins: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  if (level >= def.maxLevel) return 0;
  if (def.baseCost <= 0) return Math.min(1, config.maxBuyLevels, def.maxLevel - level);
  let count = 0;
  let spent = 0;
  while (level + count < def.maxLevel && count < config.maxBuyLevels) {
    const next = costFor(config, def, level + count, exchangeRate);
    if (spent + next > coins) break;
    spent += next;
    count++;
  }
  return count;
}

/** Выполнены ли требования разблокировки (деньги здесь не учитываются). */
export function isUnlocked(
  def: UpgradeDef,
  state: GameState,
  influence = 0,
  config?: GameConfig,
): boolean {
  return unlockBlocker(def, state, influence, config) === null;
}

/**
 * Одно условие требования с итоговым порогом: именно это значение сравнивает
 * движок и именно его показывает интерфейс.
 */
export type RequirementTerm =
  | { kind: 'balance'; value: number }
  | { kind: 'upgrade'; id: string; level: number }
  | { kind: 'influence'; value: number };

/**
 * Все условия одного требования. Порог «заработано всего» проходит через
 * `currencyCostCurve`, если передана конфигурация: в боевом коде она есть
 * всегда, без неё работают только юнит-тесты отдельных определений.
 */
export function requirementTerms(req: UnlockRequirement, config?: GameConfig): RequirementTerm[] {
  const terms: RequirementTerm[] = [];
  if (req.balance !== undefined) {
    terms.push({
      kind: 'balance',
      value: config ? adjustCurrencyCost(config, req.balance) : req.balance,
    });
  }
  if (req.upgrade !== undefined) {
    terms.push({ kind: 'upgrade', id: req.upgrade, level: req.level ?? 1 });
  }
  if (req.influence !== undefined) terms.push({ kind: 'influence', value: req.influence });
  return terms;
}

function termMet(term: RequirementTerm, state: GameState, influence: number): boolean {
  switch (term.kind) {
    case 'balance':
      return state.totalEarned >= term.value;
    case 'upgrade':
      return levelOf(state, term.id) >= term.level;
    case 'influence':
      return influence >= term.value;
  }
}

/** Первое невыполненное условие требования или null, если выполнены все. */
export function requirementBlocker(
  req: UnlockRequirement,
  state: GameState,
  influence = 0,
  config?: GameConfig,
): RequirementTerm | null {
  return requirementTerms(req, config).find((term) => !termMet(term, state, influence)) ?? null;
}

/** Чего не хватает для открытия покупки — для подсказки в интерфейсе. */
export function unlockBlocker(
  def: UpgradeDef,
  state: GameState,
  influence = 0,
  config?: GameConfig,
): RequirementTerm | null {
  return def.unlockAt ? requirementBlocker(def.unlockAt, state, influence, config) : null;
}

/** Все условия финала с итоговыми порогами — для «Правил» и подсказок. */
export function winRequirementTerms(config: GameConfig): RequirementTerm[] {
  return config.winRequirements.flatMap((req) => requirementTerms(req, config));
}

/**
 * Первое невыполненное условие финала (`config.winRequirements`) или null.
 *
 * Единственный расчёт условий победы: его используют `isWinReady`, бот
 * симулятора, карточка финальной цели и «Правила». Деньги на саму покупку
 * сюда не входят — их проверяет `isWinReady`.
 */
export function winRequirementBlocker(
  config: GameConfig,
  state: GameState,
  influence = 0,
): RequirementTerm | null {
  for (const req of config.winRequirements) {
    const blocker = requirementBlocker(req, state, influence, config);
    if (blocker) return blocker;
  }
  return null;
}
