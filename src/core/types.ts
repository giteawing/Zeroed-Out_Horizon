/**
 * Типы ядра игры. Всё, что описывает данные — здесь; сами данные лежат в src/content/*.json.
 *
 * Главная идея экономики: тап добывает НЕФТЬ (тонны), а нефтефаники (₦) —
 * это деньги, которые получаются только когда нефть продана. Продать можно
 * тремя каналами: контракты (дёшево, но всегда), экспорт (дороже) и
 * переработка на НПЗ (дороже всего).
 */

export type Tab = 'political' | 'technical' | 'sales' | 'luxury' | 'goals';

export type UpgradeType =
  | 'perTap'
  | 'well'
  | 'passive'
  | 'multiplier'
  | 'taxCut'
  | 'costCut'
  | 'periodic'
  | 'oneShot'
  | 'gamble'
  | 'priceBoost'
  | 'luxury'
  | 'autoTap'
  | 'sell'
  | 'storage'
  | 'win';

/** Каналы сбыта нефти. */
export type Channel = 'contract' | 'export' | 'refine';

export interface ChannelConfig {
  /** Множитель к базовой цене тонны. */
  priceFactor: number;
  /** Базовая пропускная способность, тонн в секунду. */
  baseRate: number;
  /** Канал берёт любой объём (контракты «на разлив»): ёмкость не ограничена. */
  unlimited?: boolean;
  /** Средний размер одной сделки, тонн (тысячи тонн, а не штуки). */
  minLotTonnes?: number;
  maxLotTonnes?: number;
  /** За сколько секунд канал оборачивает одну сделку. */
  lotSeconds?: number;
}

export interface OilConfig {
  /** Цена тонны при мировой цене 1.0, в нефтефантиках. */
  basePricePerTon: number;
  /** Стартовый запас нефти. */
  startOil: number;
  /** Стартовая ёмкость резервуаров, тонн. */
  baseCapacity: number;
  /** Тонн за один тап без улучшений. */
  tapTonnes: number;
  /** Каналы сбыта. */
  channels: Record<Channel, ChannelConfig>;
  /** Сколько тонн продаёт разовая акция «Пихнуть нефть заграницу» за секунду запаса. */
  exportBurstSeconds: number;
  /** Автодобыча: какие сотрудники нужны и какой бонус дают все вместе. */
  autoDrill: { requires: string[]; bonus: number };
  /** Сколько тонн «сгорает» при переполнении резервуаров (доля потерь в секунду). */
  spillLoss: number;
  /**
   * Пробуренные скважины. Каждая даёт случайный дебит из своего диапазона,
   * поэтому покупка «Пробурить скважину» — это лотерея: обычная, хорошая
   * или уникальная скважина.
   */
  wells: WellConfig;
}

/** Один класс скважин: шанс выпадения и суточный дебит. */
export interface WellClassConfig {
  key: 'ordinary' | 'good' | 'unique';
  /** Вероятность, что выпадет именно этот класс, 0..1. */
  chance: number;
  /** Минимальный и максимальный дебит, тонн в СУТКИ. */
  minDailyTonnes: number;
  maxDailyTonnes: number;
  /** Шаг округления дебита, тонн в сутки. */
  step: number;
}

export interface WellConfig {
  /** Классы скважин, сумма вероятностей должна быть равна 1. */
  classes: WellClassConfig[];
  /**
   * Сколько реальных секунд длится один игровой день.
   * Дебит задан в тоннах в СУТКИ, а добыча идёт в реальном времени: при 20
   * секундах партия в 16 минут — это почти полсотни игровых суток, поэтому
   * обычная скважина (8–10 т/сут) реально качает нефть, а не 0,0001 т/с.
   */
  secondsPerDay: number;
}

export interface UpgradeEffect {
  /** Прибавка (к тапу, к пассиву, к разовой выплате — зависит от type). */
  value?: number;
  /** Множитель одного уровня (1.06 = +6% за уровень). */
  factor?: number;
  /** Процентных пункта за уровень (налог, расходы). */
  percent?: number;
  /** Интервал периодики / длительность гэмбла, секунды. */
  seconds?: number;
  /** Вероятность успеха гэмбла, 0..1. */
  chance?: number;
  /** Дополнительное снижение расходов за уровень, доля (0.02 = 2%). */
  costCut?: number;
  /** Дополнительное снижение налога (буфф), доля. */
  taxCut?: number;
  /** Бонус к «пихнуть нефть заграницу», доля. */
  exportBonus?: number;
  /** Прибавка к расходам на зарплаты за уровень. */
  salaryAdd?: number;
  /** Прибавка к ставке налога за уровень. */
  taxAdd?: number;
  /** Разовая выплата считается по мировой цене нефти. */
  usesWorldPrice?: boolean;
  /** На что действует множитель. */
  scope?: 'all' | 'tap' | 'passive';
  /** Канал сбыта (для type: 'sell'). */
  channel?: Channel;
  /** Прибавка к влиянию за уровень. */
  influence?: number;
  /** Скидка на «отжатие» (доля за уровень). */
  conquestCut?: number;
  /** Разовая акция продаёт нефть со склада, а не «воздух». */
  sellsOil?: boolean;
  /** Канал, через который разовая акция сбрасывает нефть. */
  burstChannel?: Channel;
  /** Разовая акция отмывает деньги: не платит налог. */
  launder?: boolean;
  /** Тонн за операцию (для разовых акций сбыта). */
  tonnes?: number;
}

export interface UnlockRequirement {
  /** Требуемый суммарный заработок (totalEarned). */
  balance?: number;
  /** Требуемая покупка. */
  upgrade?: string;
  /** Требуемый уровень покупки из upgrade. */
  level?: number;
  /** Требуемое влияние империи. */
  influence?: number;
}

export interface UpgradeDef {
  id: string;
  tab: Tab;
  group: string;
  name: string;
  description: string;
  icon: string;
  type: UpgradeType;
  baseCost: number;
  maxLevel: number;
  /** Индивидуальный рост цены (по умолчанию config.costGrowth). */
  costGrowth?: number;
  effect: UpgradeEffect;
  cooldownSeconds?: number;
  /** Покупка-действие: можно повторять после перезарядки, уровень не растёт. */
  repeatable?: boolean;
  unlockAt?: UnlockRequirement;
  achievement?: string;
  win?: boolean;
  tag?: string;
  /** Это «отжатие» у конкурента: цена ниже, но нужно влияние (и часто ЧВК). */
  conquest?: boolean;
}

export interface GameConfig {
  version: number;
  currency: string;
  startCoins: number;
  baseTapValue: number;
  costGrowth: number;
  maxBuyLevels: number;
  tickMs: number;
  offline: { capSeconds: number; efficiency: number };
  /**
   * Налог зависит ТОЛЬКО от влияния и дружбы с чиновниками.
   *   rate = max(minRate, baseRate − influence·influenceDrop − послабления)
   * Никаких случайных колебаний: налог может только снижаться.
   */
  tax: {
    baseRate: number;
    minRate: number;
    /** На сколько снижается ставка за единицу влияния (0.00055 = 0.055 п.п.). */
    influenceDrop: number;
    /** Влияние, при котором налог опускается до minRate. */
    influenceForZero: number;
  };
  expenses: {
    baseSalaries: number;
    baseOfficials: number;
    salariesPerGross: number;
    officialsPerGross: number;
    levelRate: number;
    minCutFactor: number;
  };
  worldPrice: {
    min: number;
    max: number;
    periodSeconds: number;
    startPrice: number;
    smoothing: number;
  };
  oil: OilConfig;
  /** Бонусы за «дружбу» с разными ветвями власти. */
  influence: {
    /** Влияние за каждый уровень политической покупки (по группам). */
    perGroup: Record<string, number>;
    /** Максимальное влияние, которое можно получить (для прогресс-бара). */
    cap: number;
  };
  autosaveSeconds: number;
  winCost: number;
  winRequirements: UnlockRequirement[];
  achievementsTickSeconds: number;
  particles: { maxParticles: number; maxFloating: number };
  balance: { passiveScale: number; tapScale: number; exportGainSeconds: number };
}

export type AchievementRule =
  | { kind: 'taps'; value: number }
  | { kind: 'earned'; value: number }
  | { kind: 'taxRate'; value: number }
  | { kind: 'costCut'; value: number }
  | { kind: 'own'; upgrade: string; value?: number }
  | { kind: 'ownGroup'; group: string }
  | { kind: 'influence'; value: number }
  | { kind: 'sold'; value: number }
  | { kind: 'win' };

export interface AchievementDef {
  id: string;
  rule: AchievementRule;
}

export interface AchievementsFile {
  achievements: AchievementDef[];
}

export interface UpgradesFile {
  upgrades: UpgradeDef[];
}

export interface NewsTexts {
  prefix: string;
  [category: string]: string | string[];
}

export interface TextsFile {
  meta: { title: string; subtitle: string; lang: string };
  start: Record<string, string>;
  hud: Record<string, string>;
  tabs: Record<string, string>;
  shop: Record<string, string>;
  panel: Record<string, string>;
  stats: Record<string, string>;
  sales: Record<string, string>;
  log: Record<string, string>;
  /** Единицы измерения: чтобы в коде не было даже «т» и «₦/с». */
  units: Record<string, string>;
  finale: {
    pumpName: string;
    buyButton: string;
    locked: string;
    cutscene: string[];
    victoryTitle: string;
    creditsTitle: string;
    creditsFallback: string;
    playAgain: string;
    showStats: string;
    hideStats: string;
    skip: string;
  };
  settings: Record<string, string>;
  news: NewsTexts;
  achievements: { list: Array<{ id: string; name: string; description: string }> };
  tips: string[];
  /** id покупки → название: журналу нужны имена без обращения к играм-данным. */
  upgrades?: Record<string, string>;
  purchase: { okNews: string[] };
}

export interface Content {
  config: GameConfig;
  texts: TextsFile;
  upgrades: UpgradeDef[];
  byId: Map<string, UpgradeDef>;
  achievements: AchievementDef[];
  credits: string;
}

/** Запись в журнале операций под скважиной. */
export interface LogEntry {
  /** Игровое время, мс. */
  at: number;
  kind: 'sold' | 'bought' | 'event' | 'conquest' | 'launder' | 'drill' | 'achievement';
  /** id покупки, если запись про покупку. */
  upgradeId?: string;
  channel?: Channel;
  tonnes?: number;
  price?: number;
  money?: number;
  /** Ключ текста в log.* для нестандартных записей. */
  textKey?: string;
}

/** Пробуренная скважина: класс и её суточный дебит. */
export interface Well {
  /** Класс скважины: обычная, хорошая или уникальная. */
  kind: 'ordinary' | 'good' | 'unique';
  /** Дебит, тонн в сутки. Выпадает случайно при бурении. */
  dailyTonnes: number;
}

/** Полный снимок прогресса, который сохраняется в localStorage. */
export interface GameState {
  version: number;
  coins: number;
  /** Добытая и ещё не проданная нефть, тонн. */
  oil: number;
  totalEarned: number;
  totalTaps: number;
  totalPurchases: number;
  /** Всего продано нефти, тонн. */
  totalSold: number;
  luxurySpent: number;
  /** id покупки → уровень. */
  levels: Record<string, number>;
  /** id покупки → остаток перезарядки, мс. */
  cooldowns: Record<string, number>;
  /** id покупки → накопленное время периодики, мс. */
  timers: Record<string, number>;
  /**
   * Пробуренные скважины в порядке бурения. Дебит каждой выпал случайно
   * при покупке и больше не меняется — это «характер» месторождения.
   */
  wells: Well[];
  /** Гэмблы «в полёте». */
  gambles: Array<{ id: string; amount: number; factor: number; resolveAt: number }>;
  achievements: string[];
  /** Журнал последних операций (самые свежие — первыми). */
  log: LogEntry[];
  /** Логические часы игры, мс (не зависят от системного времени). */
  clockMs: number;
  playtimeMs: number;
  /** Время последнего сохранения по системным часам (для офлайн-дохода). */
  savedAtWallMs: number;
  worldPrice: number;
  soundOn: boolean;
  particlesOn: boolean;
  won: boolean;
  wonAtMs: number | null;
  /** Сид гейм-РНГ: сохраняется, чтобы поведение было воспроизводимым. */
  rngSeed: number;
}

export interface ChannelRate {
  /** Пропускная способность канала, тонн в секунду. */
  rate: number;
  /** Цена тонны через этот канал, ₦. */
  price: number;
  /** Сколько тонн канал реально продаёт в секунду (учитывая запас нефти). */
  sold: number;
}

export interface DerivedStats {
  /** Нефть за один тап, тонн. */
  tapValue: number;
  /** Деньги за один тап при текущей цене (справочно, для интерфейса). */
  tapRevenue: number;
  autoTapsPerSecond: number;
  /** Автодобыча, тонн/с. */
  oilPerSecond: number;
  /** Сколько нефти уходит в сбыт за секунду (сумма по каналам). */
  sellPerSecond: number;
  /** Запас нефти, тонн. */
  oil: number;
  /** Ёмкость резервуаров, тонн. */
  oilCapacity: number;
  /** Цена тонны при текущей мировой цене, ₦. */
  oilPricePerTon: number;
  /** Доход от продажи нефти (до налогов), ₦/с. */
  grossPerSecond: number;
  netPerSecond: number;
  expensesPerSecond: number;
  taxRate: number;
  costCutPercent: number;
  multiplier: number;
  priceMultiplier: number;
  salaries: number;
  officials: number;
  exportMultiplier: number;
  /** Влияние империи: дружба с властью, газеты, парламент, ЧВК. */
  influence: number;
  /** Скидка на отжатие активов, доля. */
  conquestCut: number;
  /** Работает ли автодобыча (все сотрудники наняты). */
  autoDrill: boolean;
  totalLevels: number;
  luxuries: string[];
  channels: Record<Channel, ChannelRate>;
  winCost: number;
  winReady: boolean;
  progress: number;
}

export type GameEvent =
  | { type: 'tap'; amount: number }
  | { type: 'income' }
  | { type: 'purchase'; id: string; level: number; cost: number }
  | { type: 'oneShot'; id: string; amount: number }
  | { type: 'periodic'; id: string; amount: number }
  | { type: 'sold'; channel: Channel; tonnes: number; money: number }
  | { type: 'oilFull' }
  | { type: 'gambleStarted'; id: string; amount: number }
  | { type: 'gambleResult'; id: string; won: boolean; amount: number }
  | { type: 'worldPrice'; price: number }
  | { type: 'drilled'; kind: 'ordinary' | 'good' | 'unique'; dailyTonnes: number }
  | { type: 'achievement'; id: string }
  | { type: 'win' }
  | { type: 'offline'; seconds: number; coins: number }
  | { type: 'error'; code: 'noMoney' | 'cooldown' | 'locked' | 'maxLevel' | 'noOil'; id?: string };
