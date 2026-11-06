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
  /** Отжатое месторождение: за одну покупку приходит 5–50 скважин. */
  | 'field'
  | 'win';

/** Каналы сбыта нефти: внутренний рынок, экспорт и переработка. */
export type Channel = 'contract' | 'export' | 'refine';

/** Что продаётся: сырая нефть или нефтепродукты. */
export type Product = 'crude' | 'products';

/**
 * Что именно построено: нужно, чтобы панель считала «сколько у меня НПЗ,
 * нефтебаз, АЗС и трубопроводов», не зашивая id покупок в интерфейс.
 */
export type AssetKind =
  | 'refinery'
  | 'depot'
  | 'azs'
  | 'exportPipe'
  | 'refineryPipe'
  /** Резервуары сырой нефти. */
  | 'crudeTank'
  /** Экспорт нефтепродуктов: наливные терминалы, танкеры. */
  | 'productExport';

/**
 * Канал сбыта. В модели «сырая нефть → нефтепродукты» каналы означают:
 *   contract — внутренний рынок сырой нефти (дёшево, но берёт сколько угодно);
 *   export   — экспорт сырой нефти (дороже, ограничен трубами и терминалами);
 *   refine   — мощность переработки: сколько тонн сырья в секунду забирают НПЗ.
 * Продажа нефтепродуктов считается отдельно (см. `ProductConfig`).
 */
export interface ChannelConfig {
  /** Множитель к мировой цене тонны. */
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
  /**
   * Сколько игровых суток нефть копится в резервуарах, прежде чем уехать
   * на сбыт. По требованию заказчика — 5 суток (5 реальных секунд).
   */
  shipDays: number;
  /**
   * Сколько скважин приходит за одно «отжатие месторождения»: случайное
   * число в этих границах (заказчик просил 5–50).
   */
  conquestWells: { min: number; max: number };
  /** Доля сырья, которая после переработки превращается в нефтепродукты. */
  refineryYield: number;
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
   * Сколько реальных секунд длится один игровой день. По требованию заказчика
   * это ровно 1 секунда: «8 т/сут» = 8 тонн в секунду.
   */
  secondsPerDay: number;
  /**
   * Естественное падение дебита: скважина со временем качает меньше, но
   * не сильно. Фактор = max(minFactor, 0.5^(прошло/полураспад)).
   */
  decline: {
    /** Ниже этого множителя дебит не падает. */
    minFactor: number;
    /** За сколько секунд дебит падает вдвое (при отсутствии пола). */
    halfLifeSeconds: number;
  };
  /**
   * Сколько секунд продаж по базовой цене стоит одна тонна суточного дебита.
   * Нужно для оценки активов и для приза реприватизации.
   */
  priceSeconds: number;
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
  /**
   * Доли прироста мощности канала по товарам, если постройка расширяет
   * только их. По умолчанию канал расширяется целиком (все товары).
   * Например, «экспортная эстакада» может качать только нефтепродукты.
   */
  channelSplit?: Partial<Record<Product, number>>;
  /**
   * Способ доставки экспорта: трубопровод, поезда или танкеры. От него
   * зависит, какой строкой в панели показывать эту постройку.
   */
  exportMode?: ExportMode;
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
  /**
   * Насколько усиливается операция за каждый уровень «масштаба банка»
   * (0.3 = +30 % к выплате при каждом уровне «Увеличения масштабов»).
   */
  bankScale?: number;
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
  /**
   * Улучшение с «историей»: долото, насос, двигатель, раствор, ГРП.
   * При каждой покупке название меняется (долото «Турбо-12», насос «Имперский-7»),
   * поэтому игрок видит, что купил именно новую модель, а не абстрактный «+1».
   */
  staged?: boolean;
  /** Что построено этим уровнем: НПЗ, нефтебаза, АЗС, трубопровод. */
  assetKind?: AssetKind;
  /**
   * Что хранит постройка типа `storage`: сырую нефть (резервуары, цистерны)
   * или нефтепродукты (нефтебазы). По умолчанию — нефть.
   */
  storage?: 'oil' | 'products';
  /**
   * Названия моделей по уровням: у «истории» (dолото, насос, двигатель,
   * раствор, ГРП) каждая покупка — новая модель, и её имя берётся отсюда.
   * Если уровни кончились, показывается последнее название.
   */
  stagedNames?: string[];
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
  /**
   * Нефтепродукты: сколько их даёт НПЗ и по какой цене они уходят.
   * Бензин и солярка дороже сырой нефти, поэтому переработка — главный
   * источник дохода к концу партии.
   */
  product: {
    /** Цена нефтепродуктов = цена сырой нефти · этот множитель (внутри). */
    domesticPriceFactor: number;
    /** То же для экспорта нефтепродуктов — обычно дороже внутреннего. */
    exportPriceFactor: number;
    /** Базовая ёмкость нефтебаз под продукты, тонн. */
    baseStorage: number;
    /**
     * Как пропускная способность каналов делится между сырьём и продуктами.
     * Труба одна на всех: если везём сырьё, продуктов влезет меньше.
     */
    transportSplit: {
      /** Доля экспортной мощности под сырую нефть. */
      crude: number;
      /** Доля внутреннего рынка под нефтепродукты. */
      productDomestic: number;
      /** Доля экспортной мощности под нефтепродукты. */
      productExport: number;
    };
  };
  /** Оценка собственности для панели «Активы». */
  assets: {
    /** Сколько секунд продаж стоит тонна суточного дебита скважины. */
    tonnesValueSeconds: number;
  };
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
  /** Сколько объектов пришло одной операцией (например, скважин при реприватизации). */
  count?: number;
}

/** Пробуренная скважина: класс и её суточный дебит. */
/** Приз реприватизации: случайные месторождения со скважинами конкурента. */
export interface ReprivatizationPrize {
  /** Сколько скважин досталось. */
  wells: number;
  /** Суммарный суточный дебит этих скважин, т/сут. */
  dailyTonnes: number;
  /** Сколько стоило бы построить столько же самому, ₦. */
  marketValue: number;
}

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
  /** Добытая и ещё не проданная сырая нефть в резервуарах, тонн. */
  oil: number;
  /** Нефтепродукты на нефтебазах, тонн (результат переработки). */
  products: number;
  /** Сколько миллисекунд копится партия до отправки (5 суток = 5 секунд). */
  shipTimerMs: number;
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

/**
 * Потоки нефти и нефтепродуктов, тонн в секунду.
 *
 * Модель: скважины качают сырьё → оно копится в резервуарах → раз в
 * `shipDays` суток партия уезжает: часть остаётся на внутреннем рынке,
 * часть уходит на экспорт, остаток — на переработку в НПЗ. НПЗ дают
 * нефтепродукты, которые продаются внутри и на экспорт.
 *
 * Ограничители реальные: пропускная способность труб и терминалов,
 * мощность НПЗ, ёмкость резервуаров и нефтебаз.
 */
/**
 * Чем нефть уходит за границу. Разные постройки — разные способы доставки,
 * и игрок должен видеть каждый: «поездами столько, танкерами столько».
 */
export type ExportMode = 'pipeline' | 'rail' | 'tanker';

export interface OilFlows {
  /** Добыча сырья, т/с. */
  produced: number;
  /** Продажа сырья на внутреннем рынке, т/с. */
  domestic: number;
  /** Экспорт сырья, т/с. */
  export: number;
  /**
   * Экспорт по способу доставки, т/с: трубопровод, поезда, танкеры.
   * Сумма всегда равна `export`.
   */
  exportByMode: Record<ExportMode, number>;
  /** Сколько сырья уходит в резервуары на хранение (не сразу в сбыт), т/с. */
  stored: number;
  /** Сколько сырья забирают НПЗ, т/с. */
  refined: number;
  /** Нефтепродукты на выходе НПЗ, т/с. */
  productsProduced: number;
  /** Продажа нефтепродуктов внутри страны, т/с. */
  productsDomestic: number;
  /** Экспорт нефтепродуктов, т/с. */
  productsExport: number;
  /** Что не влезло ни в каналы, ни в НПЗ (уходит в резервуары), т/с. */
  backlog: number;
  /** Мощность НПЗ (переработка), т/с. */
  refineCapacity: number;
  /** Пропускная способность внутреннего рынка, т/с. */
  domesticCapacity: number;
  /** Пропускная способность экспорта сырья, т/с. */
  exportCapacity: number;
  /** Ёмкость нефтебаз под продукты, тонн. */
  productCapacity: number;
}

export interface DerivedStats {
  /** Нефть за один тап, тонн. */
  tapValue: number;
  /** Деньги за один тап при текущей цене (справочно, для интерфейса). */
  tapRevenue: number;
  autoTapsPerSecond: number;
  /** Автодобыча, тонн/с. */
  oilPerSecond: number;
  /** Сколько нефти реально уходит в сбыт за секунду (добыча, влезшая в каналы). */
  sellPerSecond: number;
  /** Раскладка продаж сырой нефти по каналам за секунду, тонн. */
  salesByChannel: Record<'contract' | 'export' | 'refine', number>;
  /**
   * Товарная модель «сырая нефть → нефтепродукты». Всё в тоннах в секунду,
   * и всё сходится: добыча = внутренний рынок + экспорт + переработка,
   * переработка = продажа продуктов внутри + экспорт продуктов.
   */
  flows: OilFlows;
  /** Мощность экспорта по видам транспорта, т/с (для строк в панели). */
  exportCapacityByMode: Record<ExportMode, number>;
  /** Ёмкость нефтебаз под нефтепродукты, тонн. */
  productCapacity: number;
  /** Есть ли трубопровод: тогда нефть уходит в трубу, минуя резервуары. */
  hasPipeline: boolean;
  /**
   * Мощности рынков, тонн в секунду: сколько канал может принять по каждому
   * товару. Отсюда видно «доступный объём вн. рынка» и экспорта отдельно
   * для сырья и для нефтепродуктов.
   */
  capacities: {
    domestic: Record<Product, number>;
    export: Record<Product, number>;
    refine: number;
  };
  /** Запас нефти, тонн. */
  oil: number;
  /** Ёмкость резервуаров, тонн. */
  oilCapacity: number;
  /** Цена тонны при текущей мировой цене, ₦. */
  oilPricePerTon: number;
  /** Цена тонны на внутреннем рынке (контракты), ₦. */
  domesticPricePerTon: number;
  /** Экспортная цена тонны, ₦ — обычно выше внутренней. */
  exportPricePerTon: number;
  /** Цена тонны нефтепродуктов на внутреннем рынке, ₦. */
  productPriceDomestic: number;
  /** Цена тонны нефтепродуктов на экспорте, ₦. */
  productPriceExport: number;
  /** Чистая прибыль в секунду: выручка минус налог и расходы, ₦/с. */
  profitPerSecond: number;
  /** Стоимость всех активов империи (заводы, трубы, скважины, роскошь), ₦. */
  assetsValue: number;
  /** Сколько чего построено — для панели империи. */
  assetCounts: Record<AssetKind, number>;
  /** Доход от продажи нефти (до налогов), ₦/с. */
  grossPerSecond: number;
  netPerSecond: number;
  expensesPerSecond: number;
  /**
   * EBT (earnings before tax) — доход минус расходы, ₦/с. База для налога:
   * чистая прибыль = EBT − налог на прибыль.
   */
  ebtPerSecond: number;
  /** Налог на прибыль, ₦/с — считается с EBT, ₦/с. */
  taxPaidPerSecond: number;
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
  | { type: 'reprivatized'; wells: number; dailyTonnes: number; marketValue: number }
  | { type: 'achievement'; id: string }
  | { type: 'win' }
  | { type: 'offline'; seconds: number; coins: number }
  | { type: 'error'; code: 'noMoney' | 'cooldown' | 'locked' | 'maxLevel' | 'noOil'; id?: string };
