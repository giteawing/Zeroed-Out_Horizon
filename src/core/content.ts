/**
 * Загрузчик контента. Единственное место, которое знает, откуда берутся данные.
 * Чтобы добавить покупку — правится только JSON, код не трогаем.
 */
import configJson from '../content/config.json';
import textsJson from '../content/texts.json';
import upgradesJson from '../content/upgrades.json';
import achievementsJson from '../content/achievements.json';
import type {
  AchievementDef,
  AchievementsFile,
  AssetKind,
  Content,
  GameConfig,
  TextsFile,
  UnlockRequirement,
  UpgradeDef,
  UpgradeEffect,
  UpgradeType,
  UpgradesFile,
} from './types';

const TABS = new Set(['political', 'technical', 'production', 'sales', 'luxury', 'goals']);
const TYPES = new Set([
  'production', 'well', 'passive', 'multiplier', 'taxCut', 'costCut', 'periodic',
  'oneShot', 'gamble', 'priceBoost', 'luxury', 'sell', 'storage', 'field', 'win',
]);
/**
 * Поля `effect`, которые ядро применяет для каждого типа покупки.
 *
 * Поле вне списка игра молча игнорирует, а карточка продолжает его обещать:
 * так постройки сбыта несли `exportBonus`, работающий только у пассивных
 * покупок (REVIEW A4). Поэтому контент с лишним полем не загружается.
 *
 * Чтобы разрешить типу новое поле, добавьте его сюда и поставьте хотя бы
 * одной карточке: `tests/effect-fields.test.ts` меняет каждое поле каждой
 * карточки и требует, чтобы игра это заметила. Запись `Record<UpgradeType, …>`
 * не даст забыть новый тип, `keyof UpgradeEffect` — опечататься в названии.
 */
export const EFFECT_FIELDS: Record<UpgradeType, ReadonlyArray<keyof UpgradeEffect>> = {
  production: ['value'],
  well: [],
  field: [],
  passive: [
    'exportBonus', 'salaryAdd', 'influence',
    'capitalFlightPerSecond', 'capitalFlightGrowthPerMinute',
  ],
  multiplier: ['factor', 'scope', 'influence', 'conquestCut', 'fuelDamper'],
  taxCut: ['percent', 'bankScale', 'influence'],
  costCut: ['percent'],
  periodic: ['seconds', 'value'],
  oneShot: ['value', 'bankScale', 'launder', 'sellsOil', 'usesWorldPrice', 'burstChannel'],
  gamble: ['factor', 'seconds', 'chance'],
  priceBoost: ['domesticPriceMultiplier', 'exportPriceMultiplier', 'exchangeRateDevaluation'],
  luxury: [],
  sell: ['channel', 'value', 'channelSplit', 'exportMode', 'percent', 'costCut'],
  storage: ['value'],
  win: [],
};
const CHANNELS = new Set(['contract', 'export', 'refine']);
/** Разовая акция продаёт сырую нефть: переработки в ней нет. */
const BURST_CHANNELS = new Set(['contract', 'export']);
const EXPORT_MODES = new Set(['pipeline', 'rail', 'tanker']);
const PRODUCTS = new Set(['crude', 'products']);
const STORAGE_KINDS = new Set(['oil', 'products']);
const WELL_CLASS_KEYS = new Set(['ordinary', 'good', 'unique']);
/** Все значения AssetKind: `satisfies` не даст списку отстать от типа. */
const ASSET_KIND_FLAGS = {
  refinery: true,
  depot: true,
  azs: true,
  exportPipe: true,
  refineryPipe: true,
  crudeTank: true,
  exportRail: true,
  exportTanker: true,
  gasPlant: true,
  powerPlant: true,
  productExport: true,
  equipment: true,
  media: true,
  facility: true,
} satisfies Record<AssetKind, true>;
const ASSET_KINDS = new Set<string>(Object.keys(ASSET_KIND_FLAGS));

/** Плейсхолдер из ТЗ (§7.4): пока владелец не положил стихотворение. */
const CREDITS_PLACEHOLDER_MARKER = 'Здесь будет стихотворение';

export interface LoadOptions {
  /** Текст титров. В браузере подставляется из credits.txt через Vite (?raw). */
  credits?: string;
}

export function loadContent(options: LoadOptions = {}): Content {
  const config = configJson as unknown as GameConfig;
  const texts = textsJson as unknown as TextsFile;
  // effect может отсутствовать у роскоши — подставляем пустой объект,
  // чтобы остальной код не проверял его на существование.
  const upgrades = ((upgradesJson as unknown as UpgradesFile).upgrades as UpgradeDef[]).map(
    (def) => ({ ...def, effect: def.effect ?? {} }),
  );
  const achievements = (achievementsJson as unknown as AchievementsFile).achievements;

  validateUpgrades(upgrades, texts);
  validateConfig(config, upgrades);
  validateAchievements(achievements, upgrades);

  return {
    config,
    texts,
    upgrades,
    byId: new Map(upgrades.map((u) => [u.id, u])),
    achievements,
    credits: options.credits ?? '',
  };
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Число в отрезке [min, max]. */
const within = (value: unknown, min: number, max: number): boolean =>
  isNumber(value) && value >= min && value <= max;

/**
 * Одно требование (`unlockAt` или элемент `winRequirements`): ссылка на
 * существующую покупку, достижимый уровень, неотрицательные пороги.
 * `where` — где искать ошибку, например «upgrades.json: t_pump2: unlockAt».
 */
function validateRequirement(
  where: string,
  req: UnlockRequirement,
  byId: ReadonlyMap<string, UpgradeDef>,
): void {
  if (req.balance !== undefined && !(isNumber(req.balance) && req.balance >= 0)) {
    throw new Error(`${where}.balance: нужно неотрицательное число`);
  }
  if (req.influence !== undefined && !(isNumber(req.influence) && req.influence >= 0)) {
    throw new Error(`${where}.influence: нужно неотрицательное число`);
  }
  if (req.level !== undefined) {
    if (req.upgrade === undefined) {
      throw new Error(`${where}.level задан без upgrade`);
    }
    if (!Number.isInteger(req.level) || req.level < 1) {
      throw new Error(`${where}.level: нужен целый уровень от 1 (${req.upgrade}: ${req.level})`);
    }
  }
  if (req.upgrade !== undefined) {
    const target = byId.get(req.upgrade);
    if (!target) throw new Error(`${where}: ссылка на несуществующую покупку ${req.upgrade}`);
    const need = req.level ?? 1;
    if (need > target.maxLevel) {
      throw new Error(
        `${where}: уровень ${req.upgrade} = ${need} недостижим (maxLevel ${target.maxLevel})`,
      );
    }
  }
}

/** Проверка целостности контента: падаем громко и понятно, а не молча. */
export function validateUpgrades(upgrades: UpgradeDef[], texts?: TextsFile): void {
  const seen = new Set<string>();
  const byId = new Map(upgrades.map((u) => [u.id, u]));
  for (const u of upgrades) {
    if (!u.id) throw new Error('upgrades.json: покупка без id');
    if (seen.has(u.id)) throw new Error(`upgrades.json: дублирующийся id «${u.id}»`);
    seen.add(u.id);
    if (!TABS.has(u.tab)) throw new Error(`upgrades.json: неизвестная вкладка «${u.tab}» у ${u.id}`);
    if (!TYPES.has(u.type)) throw new Error(`upgrades.json: неизвестный type «${u.type}» у ${u.id}`);
    if (!u.name) throw new Error(`upgrades.json: пустое имя у ${u.id}`);
    if (!u.description) throw new Error(`upgrades.json: пустое описание у ${u.id}`);
    if (!u.icon) throw new Error(`upgrades.json: пустая иконка у ${u.id}`);
    if (!Number.isFinite(u.baseCost) || u.baseCost < 0) {
      throw new Error(`upgrades.json: некорректная baseCost у ${u.id}`);
    }
    if (u.repeatable && !u.cooldownSeconds) {
      throw new Error(`upgrades.json: repeatable-покупка ${u.id} без cooldownSeconds`);
    }
    if (u.cooldownSeconds !== undefined && !(isNumber(u.cooldownSeconds) && u.cooldownSeconds >= 0)) {
      throw new Error(`upgrades.json: ${u.id}: cooldownSeconds должен быть неотрицательным числом`);
    }
    if (u.costGrowth !== undefined && !(isNumber(u.costGrowth) && u.costGrowth >= 1)) {
      throw new Error(`upgrades.json: ${u.id}: costGrowth должен быть числом не меньше 1`);
    }
    if (!Number.isInteger(u.maxLevel) || u.maxLevel < 1) {
      throw new Error(`upgrades.json: некорректный maxLevel у ${u.id}`);
    }
    if (u.effect.channel && !CHANNELS.has(u.effect.channel)) {
      throw new Error(`upgrades.json: неизвестный канал ${u.effect.channel} у ${u.id}`);
    }
    // Без канала постройка сбыта молча не добавляет мощности ни одному рынку.
    if (u.type === 'sell' && !u.effect.channel) {
      throw new Error(`upgrades.json: ${u.id}: у покупки type «sell» не задан effect.channel`);
    }
    if (u.effect.burstChannel && !CHANNELS.has(u.effect.burstChannel)) {
      throw new Error(`upgrades.json: неизвестный burstChannel «${u.effect.burstChannel}» у ${u.id}`);
    }
    // Продажа нефти со склада включается двумя признаками сразу. Один без
    // другого даёт карточку, которая требует нефть, но платит «из воздуха».
    if (!!u.effect.sellsOil !== !!u.effect.usesWorldPrice) {
      throw new Error(
        `upgrades.json: ${u.id}: effect.sellsOil и effect.usesWorldPrice задаются только вместе`,
      );
    }
    if (u.effect.burstChannel) {
      if (!u.effect.sellsOil) {
        throw new Error(
          `upgrades.json: ${u.id}: effect.burstChannel работает только у разовой продажи нефти (effect.sellsOil)`,
        );
      }
      if (!BURST_CHANNELS.has(u.effect.burstChannel)) {
        throw new Error(
          `upgrades.json: ${u.id}: effect.burstChannel «${u.effect.burstChannel}» — ` +
          'разовая акция продаёт сырую нефть, допустимы contract и export',
        );
      }
    }
    if (u.effect.exportMode && !EXPORT_MODES.has(u.effect.exportMode)) {
      throw new Error(`upgrades.json: неизвестный способ экспорта ${u.effect.exportMode} у ${u.id}`);
    }
    if (u.assetKind !== undefined && !ASSET_KINDS.has(u.assetKind)) {
      throw new Error(`upgrades.json: неизвестный assetKind «${u.assetKind}» у ${u.id}`);
    }
    if (u.storage !== undefined && !STORAGE_KINDS.has(u.storage)) {
      throw new Error(`upgrades.json: неизвестный storage «${u.storage}» у ${u.id}`);
    }
    if (u.effect.channelSplit) {
      const entries = Object.entries(u.effect.channelSplit);
      const total = entries.reduce((sum, [product, share]) => {
        if (!PRODUCTS.has(product) || !Number.isFinite(share) || share < 0 || share > 1) {
          throw new Error(`upgrades.json: некорректный channelSplit у ${u.id}`);
        }
        return sum + share;
      }, 0);
      if (entries.length === 0 || total <= 0 || total > 2) {
        throw new Error(`upgrades.json: пустой или некорректный channelSplit у ${u.id}`);
      }
    }
    // Значения полей проверены выше; здесь — что поле вообще работает у этого
    // типа покупки. Иначе карточка обещает эффект, которого ядро не применяет.
    const allowed: ReadonlyArray<string> = EFFECT_FIELDS[u.type];
    const ignored = Object.keys(u.effect).filter((key) => !allowed.includes(key));
    if (ignored.length > 0) {
      throw new Error(
        `upgrades.json: ${u.id}: поле effect.${ignored.join(', effect.')} не работает у покупки type «${u.type}» — ` +
        `ядро его не читает. Доступные поля: ${allowed.length > 0 ? allowed.join(', ') : 'нет'}`,
      );
    }
    if (u.type === 'gamble') {
      if (!within(u.effect.chance, 0, 1)) {
        throw new Error(`upgrades.json: ${u.id}: effect.chance гэмбла должен быть от 0 до 1`);
      }
      if (!(isNumber(u.effect.seconds) && u.effect.seconds > 0)) {
        throw new Error(`upgrades.json: ${u.id}: гэмблу нужен effect.seconds больше 0`);
      }
    }
    if (u.type === 'periodic' && !(isNumber(u.effect.seconds) && u.effect.seconds > 0)) {
      throw new Error(`upgrades.json: ${u.id}: периодике нужен effect.seconds больше 0`);
    }
    validateStagedNames(u);
    if (u.unlockAt?.influence !== undefined &&
      (!Number.isFinite(u.unlockAt.influence) || u.unlockAt.influence < 0)) {
      throw new Error(`upgrades.json: некорректное unlockAt.influence у ${u.id}`);
    }
    if (texts && !texts.upgrades?.[u.id]?.trim()) {
      throw new Error(`texts.json: нет названия покупки ${u.id} в texts.upgrades`);
    }
    if (u.unlockAt?.upgrade && !byId.has(u.unlockAt.upgrade)) {
      throw new Error(
        `upgrades.json: ${u.id} ссылается на несуществующую покупку ${u.unlockAt.upgrade}`,
      );
    }
    if (u.unlockAt) {
      if (u.unlockAt.upgrade === u.id) {
        throw new Error(`upgrades.json: ${u.id}: unlockAt требует сам себя — покупка не откроется`);
      }
      validateRequirement(`upgrades.json: ${u.id}: unlockAt`, u.unlockAt, byId);
    }
  }
  const wins = upgrades.filter((u) => u.win);
  if (wins.length === 0) {
    throw new Error('upgrades.json: нет финальной покупки (win: true)');
  }
  if (wins.length > 1) {
    throw new Error(
      `upgrades.json: финальная покупка должна быть одна, найдено: ${wins.map((u) => u.id).join(', ')}`,
    );
  }
}

/**
 * Названия моделей у «улучшений с историей».
 * Меньше названий, чем уровней, — допустимо (дальше держится последнее).
 * Больше — ошибка: лишние модели купить нельзя, а полностью купленная
 * карточка показывала бы несуществующую «следующую модель».
 */
function validateStagedNames(u: UpgradeDef): void {
  const names = u.stagedNames;
  if (!u.staged) {
    if (names !== undefined) {
      throw new Error(`upgrades.json: ${u.id}: stagedNames заданы, но staged не включён`);
    }
    return;
  }
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`upgrades.json: ${u.id}: у staged-покупки нет stagedNames`);
  }
  if (names.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error(`upgrades.json: ${u.id}: пустое название в stagedNames`);
  }
  if (names.length > u.maxLevel) {
    throw new Error(
      `upgrades.json: ${u.id}: stagedNames (${names.length}) длиннее maxLevel (${u.maxLevel})`,
    );
  }
}

/**
 * Проверка `config.json`: ссылки на покупки, вероятности и диапазоны.
 * Ловит то, что иначе молча выключает механику: опечатку в id сотрудника
 * бригады, условие финала на несуществующую покупку, классы скважин с суммой
 * вероятностей не 1.
 */
export function validateConfig(config: GameConfig, upgrades: UpgradeDef[]): void {
  const byId = new Map(upgrades.map((u) => [u.id, u]));
  const fail = (message: string): never => {
    throw new Error(`config.json: ${message}`);
  };
  const positive = (value: unknown): boolean => isNumber(value) && value > 0;
  const nonNegative = (value: unknown): boolean => isNumber(value) && value >= 0;

  if (!positive(config.tickMs)) fail('tickMs должен быть больше 0');
  if (!positive(config.autosaveSeconds)) fail('autosaveSeconds должен быть больше 0');
  if (!Number.isInteger(config.maxBuyLevels) || config.maxBuyLevels < 1) {
    fail('maxBuyLevels должен быть целым числом от 1');
  }
  if (!(isNumber(config.costGrowth) && config.costGrowth >= 1)) {
    fail('costGrowth должен быть числом не меньше 1');
  }
  if (!nonNegative(config.startCoins)) fail('startCoins должен быть неотрицательным числом');
  if (!positive(config.winCost)) fail('winCost должен быть больше 0');
  if (!positive(config.achievementsTickSeconds)) fail('achievementsTickSeconds должен быть больше 0');

  const curve = config.currencyCostCurve;
  if (!curve || !(isNumber(curve.anchor) && curve.anchor >= 1) ||
    !(isNumber(curve.exponent) && curve.exponent > 0 && curve.exponent <= 1)) {
    fail('currencyCostCurve: нужен anchor не меньше 1 и exponent в (0, 1]');
  }
  if (!config.offline || !nonNegative(config.offline.capSeconds) ||
    !within(config.offline.efficiency, 0, 1)) {
    fail('offline: нужен capSeconds не меньше 0 и efficiency от 0 до 1');
  }
  if (!config.tax || !within(config.tax.baseRate, 0, 1) || !within(config.tax.minRate, 0, 1) ||
    config.tax.minRate > config.tax.baseRate || !nonNegative(config.tax.influenceDrop)) {
    fail('tax: ставки должны быть от 0 до 1, minRate не больше baseRate');
  }

  const world = config.worldPrice;
  if (!world || !positive(world.min) || !isNumber(world.max) || world.min > world.max) {
    fail('worldPrice: нужен коридор 0 < min ≤ max');
  }
  if (!within(world.startPrice, world.min, world.max)) {
    fail('worldPrice.startPrice должен лежать в коридоре min…max');
  }
  if (!positive(world.periodSeconds)) fail('worldPrice.periodSeconds должен быть больше 0');

  const oil = config.oil;
  for (const channel of CHANNELS) {
    const channelConfig: { priceFactor?: unknown; baseRate?: unknown } =
      oil.channels?.[channel as keyof typeof oil.channels] ??
      fail(`oil.channels.${channel}: канал не описан`);
    if (channel === 'refine') {
      // Выгода НПЗ считается по ценам нефтепродуктов и выходу. Множитель цены
      // здесь выглядел бы настройкой баланса, но ничего бы не менял.
      if (channelConfig.priceFactor !== undefined) {
        fail(
          'oil.channels.refine.priceFactor не используется: выгоду переработки задают ' +
          'product.domesticPriceFactor, product.exportPriceFactor и oil.refineryYield',
        );
      }
    } else if (!nonNegative(channelConfig.priceFactor)) {
      fail(`oil.channels.${channel}.priceFactor должен быть неотрицательным числом`);
    }
    if (!nonNegative(channelConfig.baseRate)) {
      fail(`oil.channels.${channel}.baseRate должен быть неотрицательным числом`);
    }
  }
  if (!positive(oil.basePricePerTon)) fail('oil.basePricePerTon должен быть больше 0');
  if (!positive(oil.shipDays)) fail('oil.shipDays должен быть больше 0');
  if (!positive(oil.exportBurstSeconds)) fail('oil.exportBurstSeconds должен быть больше 0');
  if (!(isNumber(oil.refineryYield) && oil.refineryYield > 0 && oil.refineryYield <= 1)) {
    fail('oil.refineryYield должен быть в (0, 1]');
  }
  const conquest = oil.conquestWells;
  if (!conquest || !Number.isInteger(conquest.min) || !Number.isInteger(conquest.max) ||
    conquest.min < 1 || conquest.min > conquest.max) {
    fail('oil.conquestWells: нужны целые 1 ≤ min ≤ max');
  }

  const requires = oil.autoDrill?.requires;
  if (!Array.isArray(requires)) fail('oil.autoDrill.requires должен быть списком id покупок');
  for (const id of requires) {
    if (!byId.has(id)) fail(`oil.autoDrill.requires: нет покупки ${id}`);
  }
  if (!nonNegative(oil.autoDrill.bonus)) fail('oil.autoDrill.bonus должен быть неотрицательным числом');

  const wells = oil.wells;
  if (!positive(wells?.secondsPerDay)) fail('oil.wells.secondsPerDay должен быть больше 0');
  if (!nonNegative(wells.priceSeconds)) fail('oil.wells.priceSeconds должен быть неотрицательным числом');
  if (!(isNumber(wells.decline?.minFactor) && wells.decline.minFactor > 0 && wells.decline.minFactor <= 1)) {
    fail('oil.wells.decline.minFactor должен быть в (0, 1]');
  }
  if (!positive(wells.decline.halfLifeSeconds)) {
    fail('oil.wells.decline.halfLifeSeconds должен быть больше 0');
  }
  if (!Array.isArray(wells.classes) || wells.classes.length === 0) {
    fail('oil.wells.classes: нужен хотя бы один класс скважин');
  }
  const classKeys = new Set<string>();
  let chanceSum = 0;
  for (const wellClass of wells.classes) {
    const where = `oil.wells.classes «${wellClass.key}»`;
    if (!WELL_CLASS_KEYS.has(wellClass.key)) fail(`${where}: неизвестный класс`);
    if (classKeys.has(wellClass.key)) fail(`${where}: класс описан дважды`);
    classKeys.add(wellClass.key);
    if (!within(wellClass.chance, 0, 1)) fail(`${where}: chance должен быть от 0 до 1`);
    if (!positive(wellClass.minDailyTonnes) || !isNumber(wellClass.maxDailyTonnes) ||
      wellClass.minDailyTonnes > wellClass.maxDailyTonnes) {
      fail(`${where}: нужен дебит 0 < minDailyTonnes ≤ maxDailyTonnes`);
    }
    if (!positive(wellClass.step)) fail(`${where}: step должен быть больше 0`);
    chanceSum += wellClass.chance;
  }
  // Сумма вероятностей не равна 1 — класс скважины выбирался бы со смещением.
  if (Math.abs(chanceSum - 1) > 1e-9) {
    fail(`oil.wells.classes: сумма вероятностей должна быть 1, сейчас ${chanceSum}`);
  }

  // Влияние начисляется только за effect.influence покупок. Таблица по
  // группам осталась от прежней механики и ничего не делала (REVIEW A4).
  if (config.influence && 'perGroup' in config.influence) {
    fail('influence.perGroup больше не используется: влияние задаётся полем effect.influence у покупок');
  }
  if (!positive(config.influence?.cap)) fail('influence.cap должен быть больше 0');

  if (!Array.isArray(config.winRequirements)) fail('winRequirements должен быть списком');
  config.winRequirements.forEach((req, index) => {
    const where = `config.json: winRequirements[${index}]`;
    if (req.balance === undefined && req.upgrade === undefined && req.influence === undefined) {
      throw new Error(`${where}: пустое требование${req.level !== undefined ? ' (level без upgrade)' : ''}`);
    }
    validateRequirement(where, req, byId);
  });
}

/**
 * Проверка `achievements.json`: правило ссылается на существующие покупки и
 * группы, а требуемый уровень достижим. Заодно проверяются ссылки покупок
 * на достижения (`upgrade.achievement`).
 */
export function validateAchievements(achievements: AchievementDef[], upgrades: UpgradeDef[]): void {
  const byId = new Map(upgrades.map((u) => [u.id, u]));
  const groups = new Set(upgrades.map((u) => u.group));
  const seen = new Set<string>();
  for (const achievement of achievements) {
    if (!achievement.id) throw new Error('achievements.json: достижение без id');
    if (seen.has(achievement.id)) {
      throw new Error(`achievements.json: дублирующийся id «${achievement.id}»`);
    }
    seen.add(achievement.id);
    const where = `achievements.json: ${achievement.id}`;
    const rule = achievement.rule;
    switch (rule?.kind) {
      case 'earned':
      case 'taxRate':
      case 'costCut':
      case 'influence':
      case 'sold':
        if (!(isNumber(rule.value) && rule.value >= 0)) {
          throw new Error(`${where}: value должен быть неотрицательным числом`);
        }
        break;
      case 'own': {
        const target = byId.get(rule.upgrade);
        if (!target) throw new Error(`${where}: нет покупки ${rule.upgrade}`);
        const need = rule.value ?? 1;
        if (!Number.isInteger(need) || need < 1 || need > target.maxLevel) {
          throw new Error(
            `${where}: уровень ${rule.upgrade} = ${need} недостижим (maxLevel ${target.maxLevel})`,
          );
        }
        break;
      }
      case 'ownAny':
        if (!Array.isArray(rule.upgrades) || rule.upgrades.length === 0) {
          throw new Error(`${where}: у правила ownAny пустой список покупок`);
        }
        for (const id of rule.upgrades) {
          if (!byId.has(id)) throw new Error(`${where}: нет покупки ${id}`);
        }
        break;
      case 'ownGroup':
        if (!groups.has(rule.group)) throw new Error(`${where}: нет покупок с группой «${rule.group}»`);
        break;
      case 'win':
        break;
      default:
        throw new Error(`${where}: неизвестный вид правила «${String((rule as { kind?: unknown })?.kind)}»`);
    }
  }
  for (const u of upgrades) {
    if (u.achievement !== undefined && !seen.has(u.achievement)) {
      throw new Error(`upgrades.json: ${u.id} ссылается на несуществующее достижение ${u.achievement}`);
    }
  }
}

/** Лежит ли в credits.txt заглушка вместо стихотворения. */
export function creditsIsPlaceholder(credits: string): boolean {
  const body = credits
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('Империя обнуленного горизонта'))
    .join('\n')
    .trim();
  return body.includes(CREDITS_PLACEHOLDER_MARKER) || body.length < 40;
}

/** Путь к иконке покупки (относительно базы статики). */
export function iconPath(icon: string): string {
  return `images/icons/${icon}.svg`;
}
