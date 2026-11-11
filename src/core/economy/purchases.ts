/**
 * Покупки: цены, пакетная доступность и условия разблокировки.
 * Только расчёты — состояние игры здесь не меняется.
 */
import type { GameConfig, GameState, UnlockRequirement, UpgradeDef } from '../types';

export function levelOf(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/**
 * Параметры общей кривой цен в рабочих границах. Их же печатают «Правила»:
 * выше `anchor` номинальный рост цены за уровень `g` превращается в `g^exponent`.
 */
export function currencyCostCurveOf(config: GameConfig): { anchor: number; exponent: number } {
  return {
    anchor: Math.max(1, config.currencyCostCurve?.anchor ?? 100_000),
    exponent: Math.min(1, Math.max(0.01, config.currencyCostCurve?.exponent ?? 1)),
  };
}

/**
 * Предел, за которым денежное значение уже нельзя точно представить числом
 * JavaScript: выше `Number.MAX_SAFE_INTEGER` (2^53 − 1) целые складываются и
 * сравниваются с ошибкой. Номинальные цены вроде 2,5e24 сами по себе больше
 * предела, но кривая сжимает их до 5e14, поэтому игра работает в безопасной
 * области (REVIEW F11).
 */
export const SAFE_MONEY_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * Сжимает денежные значения по общей кривой:
 * значения до anchor не меняются, поздние цены растут степенно.
 * Это сохраняет стартовую экономику и делает финальные покупки достижимыми.
 *
 * Результат ограничен `SAFE_MONEY_LIMIT`: копить и платить больше, чем можно
 * посчитать точно, игра всё равно не даст, а «цена» из округлённого double
 * перестала бы быть ценой.
 */
export function adjustCurrencyCost(config: GameConfig, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const { anchor, exponent } = currencyCostCurveOf(config);
  const curved = value <= anchor
    ? value
    : Math.max(1, anchor * Math.pow(value / anchor, exponent));
  return Math.min(SAFE_MONEY_LIMIT, Math.max(1, Math.round(curved)));
}

/**
 * Строительный CAPEX дорожает при девальвации; политические услуги не индексируются.
 *
 * Формула — `max(initial, курс)^эластичность`, то есть индекс считается от
 * абсолютного курса, а не от его роста. При `initial = 1` (текущий конфиг)
 * это одно и то же, но при другом стартовом курсе все постройки подорожали
 * бы сразу, ещё до первой девальвации. Записано как известное ограничение:
 * менять формулу — значит менять числа игры, а для этого нужен отчёт по
 * балансу. Тест `tests/economy.test.ts` фиксирует текущее поведение и
 * предупредит, если конфиг перейдёт на другой стартовый курс.
 */
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

/**
 * Запомненные суммы цен первых уровней одной покупки. Рядом лежат все входные
 * данные `costFor`, при которых суммы посчитаны: если хоть одно из них
 * изменилось, суммы считаются заново.
 */
interface OwnedCostMemo {
  baseCost: number;
  ownGrowth: number | undefined;
  commonGrowth: number;
  curveAnchor: number | undefined;
  curveExponent: number | undefined;
  assetKind: UpgradeDef['assetKind'];
  type: UpgradeDef['type'];
  initialRate: number;
  elasticity: number;
  exchangeRate: number;
  /** sums[k] — сумма цен уровней 0…k−1, сложенная в том же порядке, что в totalCostFor. */
  sums: number[];
}

/**
 * Два набора на покупку: текущий курс и условный. Симулятор оценивает
 * девальвацию на копии состояния с другим курсом и сразу возвращается.
 */
const OWNED_COST_SLOTS = 2;
/** Выше этого уровня суммы не запоминаем: в контенте maxLevel не больше 50. */
const OWNED_COST_MAX_LEVEL = 1024;
const ownedCostMemos = new WeakMap<UpgradeDef, OwnedCostMemo[]>();

function ownedCostMemoFits(
  memo: OwnedCostMemo,
  config: GameConfig,
  def: UpgradeDef,
  exchangeRate: number,
): boolean {
  return memo.exchangeRate === exchangeRate &&
    memo.baseCost === def.baseCost &&
    memo.ownGrowth === def.costGrowth &&
    memo.commonGrowth === config.costGrowth &&
    memo.curveAnchor === config.currencyCostCurve?.anchor &&
    memo.curveExponent === config.currencyCostCurve?.exponent &&
    memo.assetKind === def.assetKind &&
    memo.type === def.type &&
    memo.initialRate === config.exchangeRate.initial &&
    memo.elasticity === config.exchangeRate.constructionCostElasticity;
}

/**
 * Сколько стоили первые `level` уровней покупки: то же число, что
 * `totalCostFor(config, def, 0, level, exchangeRate)`, бит в бит.
 *
 * Оценка имущества нужна в каждом `computeDerived`, а тот вызывается несколько
 * раз за шаг игры. Пересчёт цены каждого купленного уровня занимал больше
 * половины времени симуляции, поэтому суммы запоминаются по покупке и курсу.
 */
export function ownedLevelsCost(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  exchangeRate = config.exchangeRate.initial,
): number {
  // Столько слагаемых берёт цикл totalCostFor: при дробном уровне — с округлением вверх.
  const count = Math.ceil(level);
  if (!(count > 0)) return 0;
  if (count > OWNED_COST_MAX_LEVEL) return totalCostFor(config, def, 0, level, exchangeRate);

  let slots = ownedCostMemos.get(def);
  if (!slots) {
    slots = [];
    ownedCostMemos.set(def, slots);
  }
  let memo = slots[0];
  if (!memo || !ownedCostMemoFits(memo, config, def, exchangeRate)) {
    const index = slots.findIndex((slot) => ownedCostMemoFits(slot, config, def, exchangeRate));
    if (index > 0) {
      memo = slots[index];
      slots.splice(index, 1);
    } else {
      memo = {
        baseCost: def.baseCost,
        ownGrowth: def.costGrowth,
        commonGrowth: config.costGrowth,
        curveAnchor: config.currencyCostCurve?.anchor,
        curveExponent: config.currencyCostCurve?.exponent,
        assetKind: def.assetKind,
        type: def.type,
        initialRate: config.exchangeRate.initial,
        elasticity: config.exchangeRate.constructionCostElasticity,
        exchangeRate,
        sums: [0],
      };
    }
    // Последний использованный набор — первый; лишние вытесняются с конца.
    slots.unshift(memo);
    if (slots.length > OWNED_COST_SLOTS) slots.length = OWNED_COST_SLOTS;
  }
  const sums = memo.sums;
  for (let next = sums.length; next <= count; next++) {
    sums.push(sums[next - 1] + costFor(config, def, next - 1, exchangeRate));
  }
  return sums[count];
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
