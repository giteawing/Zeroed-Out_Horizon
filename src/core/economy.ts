/**
 * Экономика игры. Здесь ТОЛЬКО чистые функции: на вход состояние и контент,
 * на выход числа. Никакого DOM, таймеров и localStorage — поэтому всё это
 * покрывается юнит-тестами и гоняется симулятором баланса.
 *
 * Базовая модель (нефтяная):
 *   добыча  : тап даёт тонны нефти, персонал даёт тонны в секунду;
 *   сбыт    : нефть из резервуаров продаётся через контракты, экспорт и НПЗ;
 *   деньги  : доход = проданные тонны · цена тонны;
 *             EBT = доход − расходы;  чистая прибыль = EBT − налог с EBT.
 *
 * Формулы:
 *   tapTonnes  = (oil.tapTonnes + Σ perTap·level) · Π(множители)          [т]
 *   oilPrice   = oil.basePricePerTon · worldPrice · Π(priceBoost)          [₦/т]
 *   канал      = rate··(1 + бонусы) · price · priceFactor                 [₦/с]
 *   ebt/s      = max(0, gross − salaries − officials)
 *   net/s      = max(0, ebt·(1 − taxRate))
 */
import type {
  AssetKind,
  ExportMode,
  Product,
  Channel,
  ChannelRate,
  Content,
  DerivedStats,
  GameConfig,
  GameState,
  OilFlows,
  ReprivatizationPrize,
  UpgradeDef,
} from './types';

/**
 * Способ доставки экспортной постройки: `effect.exportMode` из контента.
 *
 * Данные, а не догадки по названию: переименование карточки не должно
 * менять экономику. Если поле не задано — считаем морским экспортом.
 */
export function exportModeOf(def: UpgradeDef): ExportMode {
  return def.effect.exportMode ?? 'tanker';
}

export interface TaxBuff {
  id: string;
  /** На сколько процентных пунктов снижается налог (0.02 = 2 п.п.). */
  amount: number;
  untilMs: number;
}

export const CHANNELS: Channel[] = ['contract', 'export', 'refine'];

/** Товары, которые продаются: сырая нефть и нефтепродукты. */
export const PRODUCTS: Product[] = ['crude', 'products'];

/**
 * Название улучшения с историей: у долота/насоса/двигателя/раствора/ГРП
 * каждая покупка — новая модель, поэтому имя меняется вместе с уровнем.
 */
export function stagedNameOf(def: UpgradeDef, level: number): string {
  const names = def.stagedNames;
  if (!names || names.length === 0) return def.name;
  const index = Math.max(0, Math.min(names.length - 1, level - 1));
  return names[index] ?? def.name;
}

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
      // Нефтебазы хранят нефтепродукты, а не сырую нефть: у них storage='products'.
      if (def.type !== 'storage' || def.storage === 'products') continue;
      const level = levelOf(state, def.id);
      if (level > 0) capacity += (def.effect.value ?? 0) * level;
    }
  }
  return capacity;
}

/** Ёмкость хранилищ нефтепродуктов: её задают нефтебазы. */
export function productCapacityOf(
  config: GameConfig,
  content: Content | null,
  state: GameState,
): number {
  let capacity = config.product.baseStorage;
  if (content) {
    for (const def of content.upgrades) {
      if (def.type !== 'storage' || def.storage !== 'products') continue;
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
 * Сколько объектов построено: НПЗ, нефтебазы, АЗС, трубопроводы.
 * Считается по `assetKind` покупок, поэтому новые объекты достаточно
 * пометить в upgrades.json — панель подхватит их сама.
 */
export function assetCountsOf(upgrades: UpgradeDef[], state: GameState): Record<AssetKind, number> {
  const counts: Record<AssetKind, number> = {
    refinery: 0,
    depot: 0,
    azs: 0,
    exportPipe: 0,
    refineryPipe: 0,
    crudeTank: 0,
    productExport: 0,
  };
  for (const def of upgrades) {
    if (!def.assetKind) continue;
    counts[def.assetKind] += levelOf(state, def.id);
  }
  return counts;
}

/**
 * Стоимость всей собственности империи: построенное (по цене следующего
 * уровня — примерно столько объект стоил) плюс скважины по их дебиту
 * плюс потраченное на роскошь. Это «Активы» в панели: сколько всего стоит
 * то, чем игрок владеет, а не сколько у него денег на счету.
 */
export function assetsValueOf(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
): number {
  let total = state.luxurySpent;
  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    if (def.type === 'luxury') continue; // уже учтено через luxurySpent
    if (def.type === 'well') continue; // скважины считаем по дебиту
    if (def.type === 'win') continue;
    // Цена следующего уровня ≈ цена текущего объекта с учётом роста.
    const growth = def.costGrowth ?? config.costGrowth;
    total += costFor(config, def, 0) * ((Math.pow(growth, level) - 1) / Math.max(1e-9, growth - 1));
  }
  // Скважины: тонна суточного дебита стоит как четверть часа продаж
  // по базовой цене — так «уникальная» скважина действительно актив.
  const daily = wellsDailyTonnes(state, config);
  total += daily * config.oil.basePricePerTon * config.assets.tonnesValueSeconds;
  return Math.max(0, Math.round(total));
}

/**
 * Реприватизация: сколько объектов достаётся и сколько это стоит.
 *
 * По требованию владельца игрок получает СЛУЧАЙНОЕ число месторождений
 * и скважин, но их суммарная стоимость обязана быть в 5–10 раз больше
 * потраченного на активацию. Поэтому сначала считаем бюджет = цена × множитель,
 * потом набираем объекты, пока бюджет не кончится.
 */
/**
 * Разброс множителя выгоды. Нижняя граница и верхняя — из требований
 * (5–10 раз дороже, чем заплатили), поэтому сделка всегда выгодна.
 */
export const REPRIVAT_PRIZE_MIN = 5;
export const REPRIVAT_PRIZE_MAX = 10;

/** Сколько «стоит» одна тонна суточного дебита при реприватизации, ₦. */
export function wellPricePerDailyTonne(config: GameConfig, pricePerTon: number): number {
  return Math.max(1, pricePerTon * config.oil.wells.priceSeconds);
}

/**
 * Собирает приз реприватизации. `rand` — функция 0..1 (ГПСЧ игры),
 * чтобы результат был воспроизводимым в тестах.
 */
export function reprivatizationPrize(
  config: GameConfig,
  paid: number,
  pricePerTon: number,
  rand: () => number,
): ReprivatizationPrize {
  const factor = REPRIVAT_PRIZE_MIN + rand() * (REPRIVAT_PRIZE_MAX - REPRIVAT_PRIZE_MIN);
  const budget = Math.max(0, paid) * factor;
  const perTonne = wellPricePerDailyTonne(config, pricePerTon);
  /*
   * Сколько скважин достаётся покупателю.
   *
   * Требование заказчика: за одно отжатие приходит СЛУЧАЙНОЕ число скважин
   * от 5 до 50 — «месторождение», а не одна дырка в земле. Дебит при этом
   * всё равно считается от бюджета: дорогие скважины реже, дешёвые чаще,
   * иначе 50 скважин по тысяче тонн ломали бы баланс.
   */
  const countMin = Math.max(1, Math.round(config.oil.conquestWells?.min ?? 5));
  const countMax = Math.max(countMin, Math.round(config.oil.conquestWells?.max ?? 50));
  const count = countMin + Math.round(rand() * (countMax - countMin));
  // Сколько тонн в сутки «умещается» в бюджет: делим на всё месторождение.
  const totalTonnes = budget / perTonne;
  const weights: number[] = [];
  for (let i = 0; i < count; i++) weights.push(0.5 + rand());
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let dailyTonnes = 0;
  for (const weight of weights) {
    const share = (weight / weightSum) * totalTonnes;
    // Даже самая мелкая скважина месторождения что-то качает.
    dailyTonnes += Math.max(1, Math.round(share));
  }
  return {
    wells: count,
    dailyTonnes,
    marketValue: Math.round(totalTonnes * perTonne),
  };
}

/**
 * Множитель выплат банка: «Увеличение масштабов деятельности банка»
 * усиливает все операции с перезарядкой (транш, уход от налогов, отмывание).
 */
export function bankScaleOf(upgrades: UpgradeDef[], state: GameState): number {
  let scale = 1;
  for (const def of upgrades) {
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    const per = def.effect.bankScale;
    if (!per) continue;
    scale += per * level;
  }
  return scale;
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
  /*
   * Мощность рынков отдельно по товарам: «доступный объём вн. рынка» и
   * «доступный объём экспортного рынка» для сырья и для нефтепродуктов.
   * Раньше мощность считалась одной кучей, а доли (`transportSplit`) были
   * зашиты в конфиг — карточка не могла расширить только один рынок.
   */
  const rateByProduct: Record<Channel, Record<Product, number>> = {
    contract: { crude: 0, products: 0 },
    export: { crude: 0, products: 0 },
    refine: { crude: 0, products: 0 },
  };
  /*
   * Мощность экспорта по видам транспорта. Заказчик хотел видеть, сколько
   * нефти уходит поездами, сколько танкерами, а сколько — по трубопроводу:
   * это не украшение, а разные постройки, и каждая должна быть видна.
   *   pipeline — трубопроводы (t_pipeline, «Чёрная змея», труба по дну);
   *   rail     — цистерны и поезда (x_cistern);
   *   tanker   — терминалы, танкеры и флот (t_terminal, x_tanker, x_fleet).
   */
  const exportRateByMode: Record<ExportMode, number> = { pipeline: 0, rail: 0, tanker: 0 };

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
        if (e.value) {
          rateFlat[channel] += e.value * level;
          // Доли по товарам: если карточка расширяет только свой рынок,
          // прирост достаётся только ему, иначе — всем товарам канала.
          const split = e.channelSplit;
          for (const product of PRODUCTS) {
            const share = split ? (split[product] ?? 0) : 1;
            if (share > 0) rateByProduct[channel][product] += e.value * level * share;
          }
        }
        // Экспортные постройки дополнительно разносятся по способу доставки.
        if (channel === 'export' && e.value) {
          exportRateByMode[exportModeOf(def)] += e.value * level;
        }
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
  for (const channel of CHANNELS) {
    const cfg = config.oil.channels[channel];
    const rate = Math.max(0, cfg.baseRate + rateFlat[channel]);
    const price = oilPricePerTon * cfg.priceFactor * (1 + priceBonus[channel]);
    // Пропускная способность экспорта дополнительно растёт от терминалов.
    const boosted = (channel === 'export' ? rate * exportMultiplier : rate);
    channels[channel] = { rate: boosted, price, sold: boosted };
  }
  /*
   * Внутренняя и экспортная цены — это ФАКТИЧЕСКИЕ цены каналов, вместе с
   * надбавками от сбытовых построек. Раньше здесь стояла базовая цена без
   * них, и панель показывала ₦1,37/т, а строки сбыта — ₦4,13/т: игрок видел
   * два разных числа для одной и той же тонны. Теперь источник один.
   */
  const domesticPricePerTon = channels.contract.price;
  const exportPricePerTon = channels.export.price;

  /*
   * Товарная модель: сырьё → нефтепродукты.
   *
   * Добыча идёт в резервуары и копится там `shipDays` суток (по требованию
   * заказчика — 5 суток), после чего партия распределяется так:
   *   1) экспорт сырья     — дороже всего, забирает первым (трубы, поезда,
   *                          танкеры); если есть трубопровод, нефть уходит
   *                          по нему сразу и в резервуарах не лежит;
   *   2) переработка (НПЗ) — забирает остаток, но не больше своей мощности;
   *   3) внутренний рынок  — берёт всё, что осталось, по низкой цене.
   * Из переработки выходят нефтепродукты (`refineryYield`), которые
   * продаются внутри и на экспорт по своим, более высоким ценам.
   *
   * Порядок именно такой: раньше первым стоял дешёвый внутренний рынок, он
   * съедал всю добычу, и экспортные постройки показывали «0 т/с» — они не
   * получали ни тонны, хотя игрок за них заплатил.
   *
   * Так таблица сходится: добыча = экспорт + переработка + внутренний рынок,
   * переработка = продукты внутри + продукты на экспорт.
   */
  const producedPerSecond = oilPerSecond + tapValue * autoTaps;
  const product = config.product;
  /*
   * Мощность рынков по товарам.
   *
   * Базовая мощность канала (contract/export) делится между сырьём и
   * нефтепродуктами долями `transportSplit`, а прирост от построек идёт
   * туда, куда указывает карточка (`channelSplit`). Поэтому в панели есть
   * честные «доступные объёмы» отдельно для сырья и для продуктов, и
   * карточка может расширить ровно один рынок.
   */
  const split = product.transportSplit;
  /*
   * База канала (то, что даёт его стартовая мощность) делится долями
   * `transportSplit`, а прирост от построек идёт по `channelSplit` карточки.
   * Для сырья доля 1 — стартовые контракты торгуют только нефтью; для
   * продуктов доля 0 — без АЗС и трестов продавать продукты некому, и тогда
   * построенные рынки работают на них полностью.
   */
  /*
   * Прирост от построек приходит уже с назначенным товаром (`channelSplit`),
   * поэтому база канала — это остаток его мощности. Иначе тонна из карточки
   * считалась бы дважды: и в базе по доле, и в приросте.
   */
  const domesticBase = Math.max(0,
    channels.contract.rate - rateByProduct.contract.crude - rateByProduct.contract.products);
  const exportBase = Math.max(0,
    channels.export.rate - rateByProduct.export.crude - rateByProduct.export.products);
  const capacities = {
    domestic: {
      crude: domesticBase * split.crude + rateByProduct.contract.crude,
      products: domesticBase * split.productDomestic + rateByProduct.contract.products,
    },
    export: {
      crude: exportBase * split.crude + rateByProduct.export.crude,
      products: exportBase * split.productExport + rateByProduct.export.products,
    },
    refine: channels.refine.rate,
  };
  /*
   * Мощность каналов измеряется «сколько тонн в секунду они принимают»,
   * поэтому потоки считаем по всей добыче: и пассивной, и от тапов.
   * Потолок безлимитного рынка ставит только экспорт/переработка, а
   * внутренний рынок берёт всё, что ему дают, — поэтому overflow (backlog)
   * в норме нулевой.
   */
  /*
   * Экспорт отдаёт нефть по видам транспорта, а не одной кучей: так панель
   * показывает, сколько ушло по трубе, сколько поездами и сколько танкерами.
   * Доли считаются от общей мощности экспорта, чтобы труба, отмеченная
   * признаком bypassTanks, не потерялась при округлениях.
   */
  const pipelineShare = channels.export.rate > 0
    ? exportRateByMode.pipeline / channels.export.rate
    : 0;
  const hasPipeline = exportRateByMode.pipeline > 0;
  /*
   * Мощности по видам транспорта для панели. Общая мощность экспорта может
   * расти от терминалов (exportMultiplier), а сумма видов должна сойтись с
   * ней: поэтому масштабируем доли, а не берём «сырые» числа.
   */
  const rawModes = Math.max(1e-9,
    exportRateByMode.pipeline + exportRateByMode.rail + exportRateByMode.tanker);
  const modeScale = channels.export.rate / rawModes;
  const exportCapacityByMode: Record<ExportMode, number> = {
    pipeline: exportRateByMode.pipeline * modeScale,
    rail: exportRateByMode.rail * modeScale,
    tanker: exportRateByMode.tanker * modeScale,
  };
  // Нефтебазы хранят нефтепродукты: ёмкость считается отдельно от резервуаров.
  const productStorage = content
    ? productCapacityOf(config, content, state)
    : config.product.baseStorage;
  const flows = oilFlowsOf(config, capacities, producedPerSecond, {
    // Цены — чтобы поставки уходили на более выгодный рынок.
    prices: {
      crudeDomestic: channels.contract.price,
      crudeExport: channels.export.price,
      productDomestic: oilPricePerTon * product.domesticPriceFactor,
      productExport: oilPricePerTon * product.exportPriceFactor,
    },
    pipeline: pipelineShare,
    productStorage,
    modeShares: {
      pipeline: exportCapacityByMode.pipeline,
      rail: exportCapacityByMode.rail,
      tanker: exportCapacityByMode.tanker,
    },
  });
  const productPriceDomestic = oilPricePerTon * product.domesticPriceFactor;
  const productPriceExport = oilPricePerTon * product.exportPriceFactor;
  const grossPerSecond =
    flows.domestic * channels.contract.price +
    flows.export * channels.export.price +
    flows.productsDomestic * productPriceDomestic +
    flows.productsExport * productPriceExport;

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
  // Штат не может съесть больше 8 % выручки, чиновники — ещё 8 %:
  // иначе честная (по факту продаж) выручка почти вся уходила бы в расходы.
  const cappedLevelCost = (levels: number) =>
    Math.min(config.expenses.levelRate * levels, grossPerSecond * 0.08);
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

  // Расходы никогда не съедают больше пятой части выручки: иначе «успешная»
  // империя с полными резервуарами показывает нулевой доход.
  const rawExpenses = salaries + officials;
  const expenseCap = grossPerSecond * 0.2;
  const capped = rawExpenses > expenseCap && expenseCap > 0;
  const expensesPerSecond = capped ? expenseCap : rawExpenses;
  const expenseScale = rawExpenses > 0 ? expensesPerSecond / rawExpenses : 1;
  // Налог берётся с прибыли до налогообложения (EBT), а не с выручки:
  // сначала из дохода вычитаются расходы, и только потом ставка.
  const ebtPerSecond = Math.max(0, grossPerSecond - expensesPerSecond);
  const taxPerSecond = ebtPerSecond * taxRate;
  const netPerSecond = Math.max(0, ebtPerSecond - taxPerSecond);
  const winCost = winCostOf(config, upgrades);
  const capacity = content
    ? oilCapacityOf(config, content, state)
    : config.oil.baseCapacity + capacityBonus;
  const assetCounts = assetCountsOf(upgrades, state);
  const assetsValue = assetsValueOf(config, upgrades, state);

  return {
    tapValue,
    tapRevenue: tapValue * oilPricePerTon,
    autoTapsPerSecond: autoTaps,
    oilPerSecond,
    // Не сумма пропускных способностей (у контрактов она бесконечна), а то,
    // сколько тонн в секунду реально находит сбыт при текущей добыче.
    sellPerSecond: flows.domestic + flows.export + flows.productsDomestic + flows.productsExport,
    salesByChannel: {
      contract: flows.domestic,
      export: flows.export + flows.productsExport,
      refine: flows.refined,
    },
    flows,
    exportCapacityByMode,
    hasPipeline,
    productCapacity: productStorage,
    capacities,
    productPriceDomestic,
    productPriceExport,
    oil: state.oil,
    oilCapacity: capacity,
    oilPricePerTon,
    domesticPricePerTon,
    exportPricePerTon,
    // «Чистая прибыль» = то, что реально капает на счёт: EBT минус налог.
    profitPerSecond: netPerSecond,
    assetsValue,
    assetCounts,
    grossPerSecond,
    netPerSecond,
    expensesPerSecond,
    ebtPerSecond,
    taxPaidPerSecond: taxPerSecond,
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

/**
 * Итоговый прирост денег за интервал с учётом правила «не ниже нуля».
 *
 * Порядок тот же, что в панели: из дохода вычитаются расходы (получаем EBT),
 * и только с EBT берётся налог на прибыль.
 */
export function netForInterval(derived: DerivedStats, dtSeconds: number): number {
  return Math.max(0, derived.ebtPerSecond * (1 - derived.taxRate) * dtSeconds);
}

/**
 * Раскладка потоков нефти и нефтепродуктов при текущих мощностях.
 *
 * Порядок именно такой (и он же объяснён игроку в правилах):
 *   1) внутренний рынок сырья — контракты берут сколько угодно, цена низкая;
 *   2) экспорт сырья — пока есть свободная труба/терминал, цена выше;
 *   3) переработка — НПЗ забирают остаток, но не больше своей мощности;
 *   4) нефтепродукты — внутри и на экспорт по более высокой цене.
 *
 * Функция чистая: одинаковые входы дают одинаковые выходы, поэтому таблица
 * в интерфейсе и реальное начисление денег считаются одной и той же логикой.
 */
export function oilFlowsOf(
  config: GameConfig,
  capacities: {
    domestic: Record<Product, number>;
    export: Record<Product, number>;
    refine: number;
  },
  produced: number,
  /** Цены и доли, от которых зависит, куда уйдёт товар. */
  options: {
    pipeline?: number;
    productStorage?: number;
    modeShares?: Record<ExportMode, number>;
    /** Цены за тонну: по ним выбирается более выгодный рынок. */
    prices?: {
      crudeDomestic: number;
      crudeExport: number;
      productDomestic: number;
      productExport: number;
    };
  } = {},
): OilFlows {
  const total = Math.max(0, produced);
  const safe = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, value) : Number.MAX_SAFE_INTEGER;

  /*
   * «Поставки автоматически перераспределяются на более выгодные рынки».
   *
   * Раньше порядок был жёстко зашит (экспорт → переработка → внутренний), и
   * при падении экспортных цен игрок молча получал меньше денег. Теперь
   * каналы сортируются по цене: где дороже — тот и забирает первым, а
   * заполненный канал отдаёт остаток следующему.
   */
  const prices = options.prices ?? {
    crudeDomestic: 1,
    crudeExport: 1,
    productDomestic: 1,
    productExport: 1,
  };

  // Сырая нефть: рынок + переработка (НПЗ платит своей ценой за тонну).
  const crudeMarkets = [
    { key: 'export' as const, price: prices.crudeExport, capacity: safe(capacities.export.crude) },
    { key: 'refine' as const, price: prices.crudeExport, capacity: safe(capacities.refine) },
    { key: 'domestic' as const, price: prices.crudeDomestic, capacity: safe(capacities.domestic.crude) },
  ];
  // Переработка не «покупает» сырьё по цене экспорта: её выгода — продукты,
  // поэтому в сравнении цен она участвует ценой переработки (refine.priceFactor).
  crudeMarkets[1].price = prices.crudeExport * (config.oil.channels.refine.priceFactor /
    Math.max(1e-9, config.oil.channels.export.priceFactor));
  crudeMarkets.sort((a, b) => b.price - a.price);

  let rest = total;
  const crudeByMarket: Record<'domestic' | 'export' | 'refine', number> = {
    domestic: 0,
    export: 0,
    refine: 0,
  };
  for (const market of crudeMarkets) {
    const take = Math.min(rest, market.capacity);
    crudeByMarket[market.key] = take;
    rest -= take;
  }
  const exportTonnes = crudeByMarket.export;
  const refined = crudeByMarket.refine;
  const domestic = crudeByMarket.domestic;
  // Остаток — это не «пропащая» нефть, а та, что легла в резервуары.
  const stored = rest;

  /*
   * Нефтепродукты: те же два рынка, тоже по цене. Переработка здесь не
   * участвует — продукты уже произведены.
   */
  const productsProduced = refined * config.oil.refineryYield;
  const productMarkets = [
    { key: 'export' as const, price: prices.productExport, capacity: safe(capacities.export.products) },
    { key: 'domestic' as const, price: prices.productDomestic, capacity: safe(capacities.domestic.products) },
  ].sort((a, b) => b.price - a.price);

  let productRest = productsProduced;
  const productsByMarket: Record<'domestic' | 'export', number> = { domestic: 0, export: 0 };
  for (const market of productMarkets) {
    const take = Math.min(productRest, market.capacity);
    productsByMarket[market.key] = take;
    productRest -= take;
  }
  const productsDomestic = productsByMarket.domestic;
  const productsExport = productsByMarket.export;

  /*
   * Разбивка экспорта по видам транспорта. Доли берём из фактических
   * мощностей построек (труба, поезда, танкеры), поэтому сумма всегда равна
   * exportTonnes, а строки в панели сходятся с общим экспортом.
   */
  const shares = options.modeShares;
  const shareSum = shares
    ? Math.max(1e-9, shares.pipeline + shares.rail + shares.tanker)
    : 0;
  const exportByMode: Record<ExportMode, number> = shares && shareSum > 1
    ? {
      pipeline: exportTonnes * (shares.pipeline / shareSum),
      rail: exportTonnes * (shares.rail / shareSum),
      tanker: exportTonnes * (shares.tanker / shareSum),
    }
    : {
      pipeline: exportTonnes * Math.max(0, Math.min(1, options.pipeline ?? 0)),
      rail: 0,
      tanker: 0,
    };

  return {
    produced: total,
    domestic,
    export: exportTonnes,
    exportByMode,
    stored,
    refined,
    productsProduced,
    productsDomestic,
    productsExport,
    // Остаток остаётся в резервуарах: его видно игроку, он не «сгорает».
    backlog: stored,
    refineCapacity: safe(capacities.refine),
    domesticCapacity: safe(capacities.domestic.crude),
    exportCapacity: safe(capacities.export.crude),
    productCapacity: Math.max(0, options.productStorage ?? config.product.baseStorage),
  };
}

/**
 * Разложить партию нефти по мощностям каналов.
 *
 * Одна и та же функция считает и таблицу в интерфейсе, и реальную отправку
 * партии в движке, поэтому цифры на экране всегда совпадают с деньгами.
 * `seconds` — за сколько секунд накопилась партия: за это время канал
 * успевает принять `мощность · seconds` тонн.
 */
export function allocateBatch(
  config: GameConfig,
  capacities: {
    domestic: Record<Product, number>;
    export: Record<Product, number>;
    refine: number;
  },
  batch: number,
  seconds = 1,
  /** Цены за тонну: по ним выбирается, какой рынок выгоднее. */
  prices: {
    crudeDomestic: number;
    crudeExport: number;
    productDomestic: number;
    productExport: number;
  } = { crudeDomestic: 1, crudeExport: 1, productDomestic: 1, productExport: 1 },
): {
  domestic: number;
  export: number;
  refined: number;
  products: number;
  productsDomestic: number;
  productsExport: number;
  rest: number;
} {
  const span = Math.max(1e-9, seconds);
  const limit = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, value) * span : Number.MAX_SAFE_INTEGER;

  /*
   * Тот же приоритет, что и в таблице: поставки идут на более выгодный рынок,
   * а заполненный канал отдаёт остаток следующему. Порядок не зашит —
   * считается из текущих цен, поэтому и деньги, и экран ведут себя одинаково.
   */
  const refinePrice = prices.crudeExport * (config.oil.channels.refine.priceFactor /
    Math.max(1e-9, config.oil.channels.export.priceFactor));
  const crudeMarkets = [
    { key: 'export' as const, price: prices.crudeExport, capacity: limit(capacities.export.crude) },
    { key: 'refine' as const, price: refinePrice, capacity: limit(capacities.refine) },
    { key: 'domestic' as const, price: prices.crudeDomestic, capacity: limit(capacities.domestic.crude) },
  ].sort((a, b) => b.price - a.price);

  let left = batch;
  const crude: Record<'domestic' | 'export' | 'refine', number> = { domestic: 0, export: 0, refine: 0 };
  for (const market of crudeMarkets) {
    const take = Math.min(left, market.capacity);
    crude[market.key] = take;
    left -= take;
  }

  const products = crude.refine * config.oil.refineryYield;
  const productMarkets = [
    { key: 'export' as const, price: prices.productExport, capacity: limit(capacities.export.products) },
    { key: 'domestic' as const, price: prices.productDomestic, capacity: limit(capacities.domestic.products) },
  ].sort((a, b) => b.price - a.price);

  let productLeft = products;
  const sold: Record<'domestic' | 'export', number> = { domestic: 0, export: 0 };
  for (const market of productMarkets) {
    const take = Math.min(productLeft, market.capacity);
    sold[market.key] = take;
    productLeft -= take;
  }

  return {
    domestic: crude.domestic,
    export: crude.export,
    refined: crude.refine,
    products,
    productsDomestic: sold.domestic,
    productsExport: sold.export,
    rest: left,
  };
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
