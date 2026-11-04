/**
 * Типы ядра игры. Всё, что описывает данные — здесь; сами данные лежат в src/content/*.json.
 */

export type Tab = 'political' | 'technical' | 'luxury' | 'goals';

export type UpgradeType =
  | 'perTap'
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
  | 'win';

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
}

export interface UnlockRequirement {
  /** Требуемый суммарный заработок (totalEarned). */
  balance?: number;
  /** Требуемая покупка. */
  upgrade?: string;
  /** Требуемый уровень покупки из upgrade. */
  level?: number;
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
  effect: UpgradeEffect;
  cooldownSeconds?: number;
  /** Покупка-действие: можно повторять после перезарядки, уровень не растёт. */
  repeatable?: boolean;
  unlockAt?: UnlockRequirement;
  achievement?: string;
  win?: boolean;
  tag?: string;
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
  tax: { baseRate: number; minRate: number };
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

/** Полный снимок прогресса, который сохраняется в localStorage. */
export interface GameState {
  version: number;
  coins: number;
  totalEarned: number;
  totalTaps: number;
  totalPurchases: number;
  luxurySpent: number;
  /** id покупки → уровень. */
  levels: Record<string, number>;
  /** id покупки → остаток перезарядки, мс. */
  cooldowns: Record<string, number>;
  /** id покупки → накопленное время периодики, мс. */
  timers: Record<string, number>;
  /** Гэмблы «в полёте». */
  gambles: Array<{ id: string; amount: number; factor: number; resolveAt: number }>;
  achievements: string[];
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

export interface DerivedStats {
  tapValue: number;
  autoTapsPerSecond: number;
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
  totalLevels: number;
  luxuries: string[];
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
  | { type: 'gambleStarted'; id: string; amount: number }
  | { type: 'gambleResult'; id: string; won: boolean; amount: number }
  | { type: 'worldPrice'; price: number }
  | { type: 'achievement'; id: string }
  | { type: 'win' }
  | { type: 'offline'; seconds: number; coins: number }
  | { type: 'error'; code: 'noMoney' | 'cooldown' | 'locked' | 'maxLevel'; id?: string };
