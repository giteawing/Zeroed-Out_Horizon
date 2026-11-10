/**
 * Типы ядра игры. Всё, что описывает данные — здесь; сами данные лежат в src/content/*.json.
 *
 * Скважины и производственное оборудование непрерывно добывают сырую нефть.
 * Игрок задаёт распределение сырья между внутренним рынком, экспортом и НПЗ.
 */

export type Tab = 'political' | 'technical' | 'production' | 'sales' | 'luxury' | 'goals';

export type UpgradeType =
  | 'production'
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
  | 'exportRail'
  | 'exportTanker'
  | 'gasPlant'
  | 'powerPlant'
  /** Экспорт нефтепродуктов: наливные терминалы, танкеры. */
  | 'productExport'
  /** Физическое оборудование, медиаактивы и принадлежащие объекты. */
  | 'equipment'
  | 'media'
  | 'facility';

/**
 * Канал сбыта. В модели «сырая нефть → нефтепродукты» каналы означают:
 *   contract — внутренний рынок сырой нефти (дёшево; объём ограничен, пока
 *              в конфигурации не включён `unlimited`);
 *   export   — экспорт сырой нефти (дороже, ограничен трубами и терминалами);
 *   refine   — мощность переработки: сколько тонн сырья в секунду забирают НПЗ.
 * Продажа нефтепродуктов считается отдельно (см. `ProductConfig`).
 */
export interface ChannelConfig extends RefineChannelConfig {
  /** Множитель к мировой цене тонны. */
  priceFactor: number;
}

/**
 * Переработка. Своей цены у канала нет: сырьё на НПЗ не продаётся, а
 * превращается в нефтепродукты. Выгода тонны считается по их ценам
 * (`ProductConfig`) и выходу (`OilConfig.refineryYield`).
 */
export interface RefineChannelConfig {
  /** Базовая пропускная способность, тонн в секунду. */
  baseRate: number;
  /** Канал берёт любой объём сырой нефти: ёмкость не ограничена. */
  unlimited?: boolean;
}

export interface OilConfig {
  /** Цена тонны при мировой цене 1.0, в нефтефантиках. */
  basePricePerTon: number;
  /** Абсолютный предел автоматической добычи/подачи на рынок, тонн в секунду. */
  maxProductionPerSecond: number;
  /** Стартовый запас нефти. */
  startOil: number;
  /** Стартовая ёмкость резервуаров, тонн. */
  baseCapacity: number;
  /** Дебит стартовой скважины, т/сут. */
  starterWellDailyTonnes: number;
  /** Каналы сбыта. */
  channels: { contract: ChannelConfig; export: ChannelConfig; refine: RefineChannelConfig };
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
  /** Прибавка к дебиту, пассивному доходу или разовой выплате — зависит от type. */
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
  /**
   * Область множителя: production — оборудование с прямой прибавкой т/с,
   * passive — суммарный дебит скважин (включая бонус комплекта бригады),
   * all — оба источника.
   */
  scope?: 'all' | 'production' | 'passive';
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
  /** Компенсация внутреннего рынка при экспортной цене выше внутренней. */
  fuelDamper?: boolean;
  /** Базовый доход от вывоза капитала, ₦/с. */
  capitalFlightPerSecond?: number;
  /** Рост дохода за игровую минуту, доля от базового потока. */
  capitalFlightGrowthPerMinute?: number;
  /** Однократная надбавка к внутренним ценам нефти и нефтепродуктов. */
  domesticPriceMultiplier?: number;
  /** Однократная надбавка к экспортным ценам нефти и нефтепродуктов. */
  exportPriceMultiplier?: number;
  /** Девальвация за уровень: 0.05 означает +5% нефтефантиков за доллар. */
  exchangeRateDevaluation?: number;
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
  costGrowth: number;
  /** Единая кривая стоимости всех карточек и денежных требований. */
  currencyCostCurve: { anchor: number; exponent: number };
  /** Курс: нефтефантиков за доллар и эластичность строительных затрат. */
  exchangeRate: { initial: number; constructionCostElasticity: number };
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
  };
  /**
   * Штрафы за разлив: излишек сверх склада не «исчезает», а выливается.
   * Чем больше влияния, тем меньше штраф — министерство выписывает
   * предписание, а не счёт.
   */
  fines: {
    /** Штраф за тонну разлитой сырой нефти, ₦/т. */
    oilPerTon: number;
    /** Штраф за тонну разлитых нефтепродуктов, ₦/т. */
    productPerTon: number;
    /** На сколько доля штрафа падает за единицу влияния (0.003 = 0.3 %). */
    influenceReliefPerPoint: number;
    /** Максимальная скидка: договориться «до нуля» нельзя. */
    maxRelief: number;
    /** Сколько секунд «разлива» превращаются в строку расходов, с. */
    stormSeconds: number;
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
  balance: { passiveScale: number };
}

export type AchievementRule =
  | { kind: 'earned'; value: number }
  | { kind: 'taxRate'; value: number }
  | { kind: 'costCut'; value: number }
  | { kind: 'own'; upgrade: string; value?: number }
  /** Куплена хотя бы одна покупка из списка. */
  | { kind: 'ownAny'; upgrades: string[] }
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
  kind: 'sold' | 'bought' | 'event' | 'conquest' | 'launder' | 'drill' | 'achievement' | 'spill';
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
  /** Что разлилось при переливе: сырая нефть или нефтепродукты. */
  spill?: 'crude' | 'products';
  /** Куда разлилось: ключ локации (море, тайга, река…). */
  place?: string;
}

/** Пробуренная скважина: класс и её суточный дебит. */
/** Приз реприватизации: случайные месторождения со скважинами конкурента. */
export interface ReprivatizationPrize {
  /** Сколько скважин досталось. */
  wells: number;
  /** Суммарный суточный дебит этих скважин, т/сут. */
  dailyTonnes: number;
  /** Точный дебит каждой скважины; сумма равна dailyTonnes. */
  shares: number[];
  /** Сколько стоило бы построить столько же самому, ₦. */
  marketValue: number;
}

export interface Well {
  /** Класс скважины: обычная, хорошая или уникальная. */
  readonly kind: 'ordinary' | 'good' | 'unique';
  /** Дебит, тонн в сутки. Выпадает случайно при бурении. */
  readonly dailyTonnes: number;
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
  /**
   * Зарплаты, чиновники и фактические штрафы, накопленные с последней
   * финансовой сделки. Списываются из той же партии выручки, к которой
   * относятся, поэтому пятисекундная партия не оплачивает лишь 0,25 с расходов.
   */
  expensesAccrued: number;
  /** Сырая нефть, уже проданная трубой с последней отгрузки партии, т. */
  pipeSoldSinceShip: number;
  /**
   * Фактический разлив, т/с (сглаженный): сколько сырья и продуктов уходит
   * мимо склада. По нему считается норматив штрафа в таблице расходов и
   * списываются деньги в кассе — иначе штраф был бы только на бумаге.
   */
  spillCrudePerSecond: number;
  spillProductsPerSecond: number;
  totalEarned: number;
  totalPurchases: number;
  /** Режимы маршрутизации сырья. auto распределяет доступный остаток по цене. */
  flowControl: FlowControls;
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
   *
   * Массив неизменяемый: новая скважина добавляется заменой массива
   * (`state.wells = [...state.wells, well]`), а не `push`. По самому массиву
   * кешируется сумма дебита, и после первого расчёта он заморожен.
   */
  wells: readonly Well[];
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
  /** Постоянный seed волны мировой цены; не меняется при расходовании игрового RNG. */
  worldPriceSeed: number;
  /** Игровое время покупки карточки вывоза капитала; null — ещё не куплена. */
  capitalFlightStartedAtMs: number | null;
}

export interface FlowControl {
  mode: 'auto' | 'fixed';
  /** Фиксированный поток, т/с; используется только при mode='fixed'. */
  value: number;
}

export type FlowControls = Record<Channel, FlowControl>;

export interface ChannelRate {
  /** Пропускная способность канала, тонн в секунду. */
  rate: number;
  /**
   * Выручка с тонны сырья через этот канал, ₦. Для переработки — выход
   * продуктов × лучшая из двух цен нефтепродуктов.
   */
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
  /**
   * Нефтепродукты, которые не влезли в рынки и легли на нефтебазы, т/с.
   * Именно этот остаток раньше «исчезал»: производство не сходилось с
   * продажей, хотя топливо физически оставалось на складе.
   */
  productsStored: number;
  /**
   * Топливо, которому не хватило ни рынка, ни места на нефтебазах, т/с.
   * Это разлив и расход, а не продажа: выручка за него не начисляется.
   */
  productsSpill: number;
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
  /** Текущая непрерывная добыча скважин и оборудования, тонн/с. */
  oilPerSecond: number;
  /** Физический максимум фиксированного потока с учётом других фиксированных направлений. */
  flowLimits: Record<Channel, number>;
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
  /** Прогноз секунд до заполнения склада; Infinity — накопления нет. */
  productStorageSecondsToFull: number;
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
  /** Текущий курс: нефтефантиков за 1 доллар; влияет только на экспортные цены. */
  exchangeRate: number;
  /** Чистая прибыль в секунду: выручка минус налог и расходы, ₦/с. */
  profitPerSecond: number;
  /** Стоимость всех активов империи (заводы, трубы, скважины, роскошь), ₦. */
  assetsValue: number;
  /** Сколько чего построено — для панели империи. */
  assetCounts: Record<AssetKind, number>;
  /** Номинальная установленная мощность производственных объектов по типам. */
  assetThroughputByKind: Partial<Record<AssetKind, number>>;
  /** Совокупный доход от продаж и внешних выплат, ₦/с. */
  grossPerSecond: number;
  /** Доход от топливного демпфера, ₦/с. */
  damperIncomePerSecond: number;
  /** Доход от вывоза капитала, ₦/с. */
  capitalFlightIncomePerSecond: number;
  /** Процентная ставка по текущему счёту, годовых: от 1 до 20%. */
  investmentRatePercent: number;
  /** Начисленные проценты на текущий баланс, ₦/с. */
  investmentIncomePerSecond: number;
  /** Выручка по четырём фактическим товарным потокам, ₦/с. */
  crudeExportIncomePerSecond: number;
  productsExportIncomePerSecond: number;
  crudeDomesticIncomePerSecond: number;
  productsDomesticIncomePerSecond: number;
  /** Суммарная ёмкость сырьевых и продуктовых хранилищ, тонн. */
  totalStorageCapacity: number;
  /** Внутренняя пропускная способность, т/с. */
  domesticThroughputCapacity: number;
  /** Суммарная экспортная пропускная способность, т/с. */
  exportThroughputCapacity: number;
  /** Пропускная способность НПЗ, т/с. */
  refineryThroughputCapacity: number;
  netPerSecond: number;
  expensesPerSecond: number;
  /**
   * EBT (earnings before tax) — доход минус расходы, ₦/с. База для налога:
   * чистая прибыль = EBT − налог на прибыль.
   */
  ebtPerSecond: number;
  /**
   * Норматив штрафа за разлив, ₦/с: сколько империя платит министерству
   * природных ресурсов при текущем влиянии. Идёт в расходы.
   */
  finePerSecond: number;
  /** Ставка штрафа с учётом влияния, доля от полной (1 = без скидки). */
  fineFactor: number;
  /** Налог на прибыль, ₦/с — считается с EBT, ₦/с. */
  taxPaidPerSecond: number;
  taxRate: number;
  costCutPercent: number;
  multiplier: number;
  /** Множители производственной добычи. */
  productionMultiplier: number;
  passiveMultiplier: number;
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
  | { type: 'income' }
  | { type: 'purchase'; id: string; level: number; cost: number }
  | { type: 'oneShot'; id: string; amount: number }
  | { type: 'periodic'; id: string; amount: number }
  | { type: 'sold'; channel: Channel; tonnes: number; money: number }
  | { type: 'oilFull' }
  | { type: 'spill'; kind: 'crude' | 'products'; tonnes: number; fine: number; place: string }
  | { type: 'gambleStarted'; id: string; amount: number }
  | { type: 'gambleResult'; id: string; won: boolean; amount: number }
  | { type: 'worldPrice'; price: number }
  | { type: 'drilled'; kind: 'ordinary' | 'good' | 'unique'; dailyTonnes: number }
  | { type: 'reprivatized'; wells: number; dailyTonnes: number; marketValue: number }
  | { type: 'achievement'; id: string }
  | { type: 'win' }
  | { type: 'offline'; seconds: number; coins: number }
  | {
      type: 'error';
      code: 'noMoney' | 'cooldown' | 'locked' | 'maxLevel' | 'won' | 'noOil' | 'noCapacity';
      id?: string;
    };
