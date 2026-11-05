/**
 * Экономика игры. Здесь ТОЛЬКО чистые функции: на вход состояние и контент,
 * на выход числа. Никакого DOM, таймеров и localStorage — поэтому всё это
 * покрывается юнит-тестами и гоняется симулятором баланса.
 *
 * Базовая модель (нефтяная):
 *   добыча  : тап даёт тонны нефти, персонал даёт тонны в секунду;
 *   сбыт    : нефть из резервуаров продаётся через контракты, экспорт и НПЗ;
 *   деньги  : ₦ = проданные тонны · цена тонны · (1 − налог) − расходы.
 *
 * Формулы:
 *   tapTonnes  = (oil.tapTonnes + Σ perTap·level) · Π(множители)          [т]
 *   oilPrice   = oil.basePricePerTon · worldPrice · Π(priceBoost)          [₦/т]
 *   канал      = rate··(1 + бонусы) · price · priceFactor                 [₦/с]
 *   net/s      = max(0, gross·(1 − taxRate) − salaries − officials)
 */
import type {
  Channel,
  ChannelRate,
  Content,
  DerivedStats,
  GameConfig,
  GameState,
  UpgradeDef,
} from './types';

export interface TaxBuff {
  id: string;
  /** На сколько процентных пунктов снижается налог (0.02 = 2 п.п.). */
  amount: number;
  untilMs: number;
}

export const CHANNELS: Channel[] = ['contract', 'export', 'refine'];

export function levelOf(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/** Цена следующего уровня: baseCost · growth^level. */
export function costFor(config: GameConfig, def: UpgradeDef, level: number): number {
  if (def.baseCost <= 0) return 0;
  const growth = def.costGrowth ?? config.costGrowth;
  return Math.round(def.baseCost * Math.pow(growth, level));
}

/** Суммарная цена count уровней подряд, начиная с текущего level. */
export function totalCostFor(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  count: number,
): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += costFor(config, def, level + i);
  return sum;
}

/** Сколько уровней можно купить на coins (с учётом maxLevel и лимита за раз). */
export function affordableLevels(
  config: GameConfig,
  def: UpgradeDef,
  level: number,
  coins: number,
): number {
  if (level >= def.maxLevel) return 0;
  if (def.baseCost <= 0) return Math.min(1, config.maxBuyLevels, def.maxLevel - level);
  let count = 0;
  let spent = 0;
  while (level + count < def.maxLevel && count < config.maxBuyLevels) {
    const next = costFor(config, def, level + count);
    if (spent + next > coins) break;
    spent += next;
    count++;
  }
  return count;
}

/** Выполнены ли требования разблокировки (деньги здесь не учитываются). */
export function isUnlocked(def: UpgradeDef, state: GameState, influence = 0): boolean {
  return unlockBlocker(def, state, influence) === null;
}

/** Чего не хватает для открытия покупки — для подсказки в интерфейсе. */
export function unlockBlocker(
  def: UpgradeDef,
  state: GameState,
  influence = 0,
):
  | { kind: 'balance'; value: number }
  | { kind: 'upgrade'; id: string; level: number }
  | { kind: 'influence'; value: number }
  | null {
  const req = def.unlockAt;
  if (!req) return null;
  if (req.balance !== undefined && state.totalEarned < req.balance) {
    return { kind: 'balance', value: req.balance };
  }
  if (req.upgrade !== undefined) {
    const need = req.level ?? 1;
    if (levelOf(state, req.upgrade) < need) {
      return { kind: 'upgrade', id: req.upgrade, level: need };
    }
  }
  if (req.influence !== undefined && influence < req.influence) {
    return { kind: 'influence', value: req.influence };
  }
  return null;
}

const GROUPS_OFFICIALS = new Set(['grants', 'taxes', 'deals', 'conquest', 'favors', 'pmc']);
const GROUPS_STAFF = new Set(['staff', 'crew']);
/** Дружба с властью: эти группы дают влияние империи. */
const GROUPS_INFLUENCE = new Set(['grants', 'taxes', 'deals', 'conquest', 'favors', 'pmc']);

/** Резервуары: базовая ёмкость плюс покупки типа storage. */
export function oilCapacityOf(config: GameConfig, content: Content | null, state: GameState): number {
  let capacity = config.oil.baseCapacity;
  if (content) {
    for (const def of content.upgrades) {
      if (def.type !== 'storage') continue;
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

/**
 * Главная функция: считает все производные показатели империи.
 *
 * content нужен для ёмкости резервуаров и проверки автодобычи; если его нет
 * (юнит-тесты отдельных формул), берётся только config.
 */
export function computeDerived(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  buffs: readonly TaxBuff[] = [],
  content: Content | null = null,
): DerivedStats {
  let tapFlat = config.oil.tapTonnes;
  let passiveFlat = 0;
  let multTap = 1;
  let multPassive = 1;
  let taxCutPoints = 0;
  let costCutFraction = 0;
  let priceMultiplier = 1;
  let exportMultiplier = 1;
  let autoTaps = 0;
  let salariesGrowth = 0;
  let taxAdd = 0;
  let staffLevels = 0;
  let officialLevels = 0;
  let totalLevels = 0;
  let influenceFromLevels = 0;
  let conquestCut = 0;
  let capacityBonus = 0;
  const luxuries: string[] = [];

  const rateFlat: Record<Channel, number> = { contract: 0, export: 0, refine: 0 };
  const priceBonus: Record<Channel, number> = { contract: 0, export: 0, refine: 0 };

  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    totalLevels += level;
    const e = def.effect;
    if (GROUPS_STAFF.has(def.group)) staffLevels += level;
    if (GROUPS_OFFICIALS.has(def.group)) officialLevels += level;
    if (GROUPS_INFLUENCE.has(def.group)) {
      const per = config.influence.perGroup[def.group] ?? 1;
      influenceFromLevels += per * level;
    }
    // Явно заданное влияние в эффекте покупки (например, ЧВК, газеты).
    if (e.influence) influenceFromLevels += e.influence * level;
    if (e.conquestCut) conquestCut += e.conquestCut * level;
    // Влияние усиливает отжатия: каждые 100 единиц дают ещё 5% скидки.
    if (GROUPS_INFLUENCE.has(def.group)) {
      const per = config.influence.perGroup[def.group] ?? 1;
      conquestCut += (per * level) / 2000;
    }

    switch (def.type) {
      case 'perTap':
        tapFlat += (e.value ?? 0) * level;
        break;
      case 'passive':
        passiveFlat += 0;
        if (e.costCut) costCutFraction += e.costCut * level;
        if (e.exportBonus) exportMultiplier += e.exportBonus * level;
        if (e.salaryAdd) salariesGrowth += e.salaryAdd * level;
        if (e.taxAdd) taxAdd += e.taxAdd * level;
        break;
      case 'storage':
        capacityBonus += (e.value ?? 0) * level;
        break;
      case 'sell': {
        const channel = e.channel ?? 'contract';
        if (e.value) rateFlat[channel] += e.value * level;
        if (e.percent) priceBonus[channel] += (e.percent / 100) * level;
        if (e.costCut) costCutFraction += e.costCut * level;
        break;
      }
      case 'multiplier': {
        // Затухающая отдача: factor^√level. Иначе к концу игры множители
        // перемножаются в астрономию и баланс «взрывается».
        const factor = Math.pow(e.factor ?? 1, Math.sqrt(level));
        const scope = e.scope ?? 'all';
        if (scope === 'all') {
          multTap *= factor;
          multPassive *= factor;
        } else if (scope === 'tap') {
          multTap *= factor;
        } else {
          multPassive *= factor;
        }
        break;
      }
      case 'taxCut':
        taxCutPoints += (e.percent ?? 0) * level;
        break;
      case 'costCut':
        costCutFraction += ((e.percent ?? 0) * level) / 100;
        break;
      case 'priceBoost':
        priceMultiplier *= Math.pow(e.factor ?? 1, level);
        break;
      case 'autoTap':
        autoTaps += (e.value ?? 0) * level;
        break;
      case 'luxury':
        luxuries.push(def.id);
        break;
      default:
        break;
    }
  }

  // Временные скидки (buffs) больше НЕ участвуют: налог меняется только
  // от влияния и от дружбы с чиновниками, иначе он «случайно прыгает».
  void buffs;

  // ---------------------------------------------------------------- добыча
  const tapValue = Math.max(0.1, tapFlat * multTap * config.balance.tapScale);
  // Автодобыча: пассив качает всегда, а нанятая целиком бригада
  // удваивает его — это и есть «добыча без игрока».
  const crew = hasFullCrew(config, state);
  const autoDrillBonus = crew ? 1 + config.oil.autoDrill.bonus : 1;
  const wellsPerSecond = wellsTonnesPerSecond(config, state);
  // Скважины качают всегда; без бригады — вдвое слабее.
  const oilPerSecond =
    wellsPerSecond * multPassive * config.balance.passiveScale * autoDrillBonus;

  // ----------------------------------------------------------------- сбыт
  const oilPricePerTon =
    config.oil.basePricePerTon * state.worldPrice * priceMultiplier;
  const channels = {} as Record<Channel, ChannelRate>;
  let grossPerSecond = 0;
  for (const channel of CHANNELS) {
    const cfg = config.oil.channels[channel];
    const rate = Math.max(0, cfg.baseRate + rateFlat[channel]);
    const price = oilPricePerTon * cfg.priceFactor * (1 + priceBonus[channel]);
    // Пропускная способность экспорта дополнительно растёт от терминалов.
    const boosted = (channel === 'export' ? rate * exportMultiplier : rate);
    channels[channel] = { rate: boosted, price, sold: boosted };
    // В «теоретический» доход безлимитный канал не входит: его вклад зависит
    // от того, сколько нефти реально добывается (считается в sellOil).
    if (!cfg.unlimited) grossPerSecond += boosted * price;
  }

  // Влияние считается до налога: больше влияния — меньше налог.
  const influenceTotal = Math.min(
    config.influence.cap,
    Math.round(influenceFromLevels),
  );
  const taxRate = Math.min(
    config.tax.baseRate,
    taxRateOf(config, influenceTotal, taxCutPoints + taxAdd * 100),
  );
  const cutFactor = Math.max(
    config.expenses.minCutFactor,
    1 - Math.min(0.8, costCutFraction),
  );
  // Расходы состоят из «постоянных» и «процентных» частей. Часть от уровней
  // ограничена долей от выручки — иначе к концу игры штат съедал весь доход
  // и империя банкротилась, хотя нефть качается.
  const cappedLevelCost = (levels: number) =>
    Math.min(config.expenses.levelRate * levels, grossPerSecond * 0.35);
  const salaries =
    (config.expenses.baseSalaries +
      config.expenses.salariesPerGross * grossPerSecond +
      cappedLevelCost(staffLevels) +
      salariesGrowth * grossPerSecond) *
    cutFactor;
  const officials =
    (config.expenses.baseOfficials +
      config.expenses.officialsPerGross * grossPerSecond +
      cappedLevelCost(officialLevels)) *
    cutFactor;

  // Расходы никогда не съедают больше половины выручки: иначе «успешная»
  // империя с полными резервуарами показывает нулевой доход.
  const rawExpenses = salaries + officials;
  const expenseCap = grossPerSecond * 0.5;
  const capped = rawExpenses > expenseCap && expenseCap > 0;
  const expensesPerSecond = capped ? expenseCap : rawExpenses;
  const expenseScale = rawExpenses > 0 ? expensesPerSecond / rawExpenses : 1;
  const netPerSecond = Math.max(0, grossPerSecond * (1 - taxRate) - expensesPerSecond);
  const winCost = winCostOf(config, upgrades);
  const capacity = content
    ? oilCapacityOf(config, content, state)
    : config.oil.baseCapacity + capacityBonus;

  return {
    tapValue,
    tapRevenue: tapValue * oilPricePerTon,
    autoTapsPerSecond: autoTaps,
    oilPerSecond,
    sellPerSecond: CHANNELS.reduce((sum, c) => sum + channels[c].rate, 0),
    oil: state.oil,
    oilCapacity: capacity,
    oilPricePerTon,
    grossPerSecond,
    netPerSecond,
    expensesPerSecond,
    taxRate,
    costCutPercent: Math.round((1 - cutFactor) * 100),
    multiplier: multTap * multPassive,
    priceMultiplier,
    salaries: salaries * expenseScale,
    officials: officials * expenseScale,
    exportMultiplier,
    influence: influenceTotal,
    conquestCut: Math.min(0.75, conquestCut),
    autoDrill: crew,
    totalLevels,
    luxuries,
    channels,
    winCost,
    winReady: isWinReady(config, upgrades, state, state.coins),
    progress: Math.min(1, winCost > 0 ? state.coins / winCost : 0),
  };
}

/** Сколько тонн уместится в резервуары (с учётом уже накопленного). */
export function freeOilSpace(derived: DerivedStats): number {
  return Math.max(0, derived.oilCapacity - derived.oil);
}

/** Цена победы: из финальной покупки (win: true) или из config.winCost. */
export function winCostOf(config: GameConfig, upgrades: UpgradeDef[]): number {
  const winDef = upgrades.find((u) => u.win);
  return winDef ? winDef.baseCost : config.winCost;
}

/** Все условия победы (деньги + ключевые улучшения) выполнены? */
export function isWinReady(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  coins: number,
): boolean {
  if (coins < winCostOf(config, upgrades)) return false;
  for (const req of config.winRequirements) {
    if (req.upgrade !== undefined && levelOf(state, req.upgrade) < (req.level ?? 1)) return false;
    if (req.balance !== undefined && state.totalEarned < req.balance) return false;
  }
  return true;
}

/**
 * База для выплат событий: «одна секунда текущего сбыта плюс полсекунды
 * пассивной добычи в деньгах». Растёт вместе с империей, поэтому разовые
 * акции не обесцениваются к концу игры.
 */
export function payoutBase(derived: DerivedStats): number {
  return Math.max(1, derived.grossPerSecond + derived.oilPerSecond * derived.oilPricePerTon * 0.5);
}

/**
 * Выплата разовой/периодической покупки в единицах «секунд дохода».
 * Для платных разовых покупок используется множитель цены (effect.factor),
 * иначе — фиксированное число секунд (effect.value).
 */
export function eventPayout(
  def: UpgradeDef,
  derived: DerivedStats,
  level: number,
  paidCost: number,
): number {
  const e = def.effect;
  if (e.factor !== undefined && paidCost > 0) {
    return Math.max(1, Math.round(paidCost * Math.pow(e.factor, Math.max(1, level))));
  }
  return Math.max(1, Math.round(payoutBase(derived) * (e.value ?? 1)));
}

/** Сколько тонн продаст разовая акция «Пихнуть нефть заграницу». */
export function exportTonnes(config: GameConfig, derived: DerivedStats, oil: number): number {
  const want = derived.channels.export.rate * config.oil.exportBurstSeconds;
  return Math.min(oil, Math.max(0, want));
}

/** Деньги за продажу тонн через канал (с учётом мировой цены и терминалов). */
export function saleProceeds(
  def: Pick<UpgradeDef, 'effect'>,
  derived: DerivedStats,
  tonnes: number,
): number {
  const channel = def.effect.burstChannel ?? 'export';
  const rate = derived.channels[channel];
  const bonus = 1 + (def.effect.exportBonus ?? 0);
  return Math.max(0, tonnes * rate.price * bonus);
}

/** Доход за один тап: тонны с лёгким «разбросом», чтобы не было одинаковых цифр. */
export function tapReward(derived: DerivedStats, rngValue: number): number {
  return Math.max(0.1, derived.tapValue * (0.9 + rngValue * 0.2));
}

/** Итоговый прирост денег за интервал с учётом правила «не ниже нуля». */
export function netForInterval(derived: DerivedStats, dtSeconds: number): number {
  return Math.max(
    0,
    derived.grossPerSecond * (1 - derived.taxRate) * dtSeconds - derived.expensesPerSecond * dtSeconds,
  );
}

/**
 * Сколько нефти реально можно продать за dt секунд при текущем запасе.
 * Возвращает по каналам: тонны и деньги. Каналы делят запас по приоритету
 * «дорогой сначала» — так игроку выгодно строить НПЗ.
 */
export function sellOil(
  derived: DerivedStats,
  oil: number,
  dtSeconds: number,
  unlimited: Channel[] = ['contract'],
): { oil: number; gross: number; sold: number; byChannel: Record<Channel, number> } {
  const byChannel: Record<Channel, number> = { contract: 0, export: 0, refine: 0 };
  const order: Channel[] = ['refine', 'export', 'contract'];
  let left = oil;
  let gross = 0;
  let sold = 0;
  for (const channel of order) {
    if (left <= 0) break;
    const rate = derived.channels[channel];
    // Контракты «на разлив» берут всё, что не забрали дорогие каналы.
    const want = unlimited.includes(channel) ? left : rate.rate * dtSeconds;
    const take = Math.min(left, want);
    if (take <= 0) continue;
    byChannel[channel] += take;
    left -= take;
    sold += take;
    gross += take * rate.price;
  }
  return { oil: left, gross, sold, byChannel };
}
