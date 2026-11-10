/**
 * REVIEW C6: проверка целостности контента при загрузке.
 * Принцип тестов — «ломаем данные и получаем понятную ошибку»: опечатка в
 * JSON не должна молча выключать механику.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadContent,
  validateAchievements,
  validateConfig,
  validateUpgrades,
} from '../src/core/content';
import type { AchievementDef, GameConfig, UpgradeDef } from '../src/core/types';

const content = loadContent();

/** Копия боевой конфигурации с правкой. */
function configWith(mutate: (config: GameConfig) => void): GameConfig {
  const config = structuredClone(content.config);
  mutate(config);
  return config;
}

/** Копия боевого списка покупок с правкой одной из них. */
function upgradesWith(id: string, mutate: (def: UpgradeDef) => void): UpgradeDef[] {
  const upgrades = structuredClone(content.upgrades);
  const def = upgrades.find((upgrade) => upgrade.id === id);
  if (!def) throw new Error(`в контенте нет покупки ${id}`);
  mutate(def);
  return upgrades;
}

const rule = (def: AchievementDef['rule']): AchievementDef[] => [{ id: 'a_test', rule: def }];

describe('validateConfig (REVIEW C6)', () => {
  const broken = (mutate: (config: GameConfig) => void) =>
    () => validateConfig(configWith(mutate), content.upgrades);

  it('боевая конфигурация проходит проверку', () => {
    expect(() => validateConfig(content.config, content.upgrades)).not.toThrow();
  });

  it('условия финала ссылаются на существующие покупки и достижимые уровни', () => {
    expect(broken((config) => { config.winRequirements = [{ upgrade: 'нет-такой' }]; }))
      .toThrow(/winRequirements.*нет-такой/);
    expect(broken((config) => { config.winRequirements = [{ upgrade: 't_smart', level: 999 }]; }))
      .toThrow(/winRequirements.*t_smart.*999/);
    expect(broken((config) => { config.winRequirements = [{ upgrade: 't_smart', level: 0 }]; }))
      .toThrow(/winRequirements/);
    expect(broken((config) => { config.winRequirements = [{ level: 2 }]; }))
      .toThrow(/winRequirements.*level/);
    expect(broken((config) => { config.winRequirements = [{ balance: -1 }]; }))
      .toThrow(/winRequirements.*balance/);
    expect(broken((config) => { config.winRequirements = [{ influence: Number.NaN }]; }))
      .toThrow(/winRequirements.*influence/);
    expect(broken((config) => { config.winRequirements = [{}]; }))
      .toThrow(/winRequirements.*пуст/);
    expect(broken((config) => { config.winCost = 0; })).toThrow(/winCost/);
  });

  it('бригада автобурения состоит из существующих покупок', () => {
    expect(broken((config) => { config.oil.autoDrill.requires = ['s_brigade', 's_опечатка']; }))
      .toThrow(/autoDrill.*s_опечатка/);
    expect(broken((config) => { config.oil.autoDrill.bonus = -1; })).toThrow(/autoDrill.*bonus/);
  });

  it('классы скважин: вероятности в сумме дают 1, диапазоны не вывернуты', () => {
    expect(broken((config) => { config.oil.wells.classes[0].chance = 0.9; }))
      .toThrow(/wells\.classes.*сумма вероятностей/);
    expect(broken((config) => { config.oil.wells.classes = []; })).toThrow(/wells\.classes/);
    expect(broken((config) => { config.oil.wells.classes[1].chance = -0.25; }))
      .toThrow(/wells\.classes.*good.*chance/);
    expect(broken((config) => {
      config.oil.wells.classes[0].minDailyTonnes = 11;
      config.oil.wells.classes[0].maxDailyTonnes = 10;
    })).toThrow(/wells\.classes.*ordinary/);
    expect(broken((config) => { config.oil.wells.classes[2].step = 0; }))
      .toThrow(/wells\.classes.*unique.*step/);
    expect(broken((config) => { config.oil.wells.classes[1].key = 'ordinary'; }))
      .toThrow(/wells\.classes.*ordinary/);
    // Погрешность двоичной арифметики (0.7 + 0.25 + 0.05) ошибкой не считается.
    expect(broken((config) => {
      config.oil.wells.classes[0].chance = 0.1 + 0.2;
      config.oil.wells.classes[1].chance = 0.65;
    })).not.toThrow();
  });

  it('падение дебита и переработка заданы осмысленно', () => {
    expect(broken((config) => { config.oil.wells.decline.minFactor = 0; })).toThrow(/decline\.minFactor/);
    expect(broken((config) => { config.oil.wells.decline.minFactor = 1.2; })).toThrow(/decline\.minFactor/);
    expect(broken((config) => { config.oil.wells.decline.halfLifeSeconds = 0; }))
      .toThrow(/decline\.halfLifeSeconds/);
    expect(broken((config) => { config.oil.wells.secondsPerDay = 0; })).toThrow(/secondsPerDay/);
    expect(broken((config) => { config.oil.refineryYield = 1.5; })).toThrow(/refineryYield/);
    expect(broken((config) => { config.oil.conquestWells = { min: 50, max: 5 }; }))
      .toThrow(/conquestWells/);
    expect(broken((config) => { config.oil.shipDays = 0; })).toThrow(/shipDays/);
  });

  it('каналы сбыта описаны все три и без отрицательных значений', () => {
    expect(broken((config) => {
      delete (config.oil.channels as Partial<GameConfig['oil']['channels']>).refine;
    })).toThrow(/channels\.refine/);
    expect(broken((config) => { config.oil.channels.export.priceFactor = -1; }))
      .toThrow(/channels\.export.*priceFactor/);
    expect(broken((config) => { config.oil.channels.contract.baseRate = Number.NaN; }))
      .toThrow(/channels\.contract.*baseRate/);
  });

  it('у переработки нет своего множителя цены (REVIEW A3)', () => {
    // Выгода НПЗ считается по ценам нефтепродуктов и выходу. Число в конфиге
    // выглядело бы настройкой баланса, но ничего бы не меняло.
    expect(broken((config) => {
      (config.oil.channels.refine as { priceFactor?: number }).priceFactor = 2.6;
    })).toThrow(/channels\.refine.*priceFactor/);
    expect(broken((config) => { config.oil.channels.refine.baseRate = -1; }))
      .toThrow(/channels\.refine.*baseRate/);
    expect(broken((config) => {
      delete (config.oil.channels.contract as { priceFactor?: number }).priceFactor;
    })).toThrow(/channels\.contract.*priceFactor/);
  });

  it('коридор мировой цены, такт и кривая цен', () => {
    expect(broken((config) => { config.worldPrice.min = 2; })).toThrow(/worldPrice/);
    expect(broken((config) => { config.worldPrice.startPrice = 5; })).toThrow(/worldPrice.*startPrice/);
    expect(broken((config) => { config.worldPrice.periodSeconds = 0; })).toThrow(/worldPrice.*periodSeconds/);
    expect(broken((config) => { config.tickMs = 0; })).toThrow(/tickMs/);
    expect(broken((config) => { config.autosaveSeconds = -5; })).toThrow(/autosaveSeconds/);
    expect(broken((config) => { config.maxBuyLevels = 0; })).toThrow(/maxBuyLevels/);
    expect(broken((config) => { config.costGrowth = 0.9; })).toThrow(/costGrowth/);
    expect(broken((config) => { config.currencyCostCurve.exponent = 0; })).toThrow(/currencyCostCurve/);
    expect(broken((config) => { config.currencyCostCurve.exponent = 1.5; })).toThrow(/currencyCostCurve/);
    expect(broken((config) => { config.currencyCostCurve.anchor = 0; })).toThrow(/currencyCostCurve/);
    expect(broken((config) => { config.offline.capSeconds = -1; })).toThrow(/offline/);
    expect(broken((config) => { config.offline.efficiency = 2; })).toThrow(/offline/);
  });

  it('налог и влияние', () => {
    expect(broken((config) => { config.tax.minRate = 0.5; })).toThrow(/tax/);
    expect(broken((config) => { config.tax.baseRate = 1.5; })).toThrow(/tax/);
    expect(broken((config) => { config.influence.perGroup = { 'нет-такой-группы': 2 }; }))
      .toThrow(/influence\.perGroup.*нет-такой-группы/);
    expect(broken((config) => { config.influence.perGroup.grants = -1; }))
      .toThrow(/influence\.perGroup.*grants/);
    expect(broken((config) => { config.influence.cap = 0; })).toThrow(/influence\.cap/);
  });
});

describe('validateUpgrades: новые проверки (REVIEW C6)', () => {
  const broken = (id: string, mutate: (def: UpgradeDef) => void) =>
    () => validateUpgrades(upgradesWith(id, mutate));

  it('боевой список покупок проходит проверку', () => {
    expect(() => validateUpgrades(content.upgrades, content.texts)).not.toThrow();
  });

  it('покупка сбыта обязана назвать канал', () => {
    const sell = content.upgrades.find((def) => def.type === 'sell');
    expect(sell).toBeDefined();
    expect(broken(sell!.id, (def) => { delete def.effect.channel; }))
      .toThrow(new RegExp(`${sell!.id}.*effect\\.channel`));
  });

  it('assetKind, storage и burstChannel — только известные значения', () => {
    expect(broken('t_refinery', (def) => { def.assetKind = 'refinary' as never; }))
      .toThrow(/assetKind.*refinary.*t_refinery/);
    expect(broken('t_depot', (def) => { def.storage = 'gas' as never; }))
      .toThrow(/storage.*gas.*t_depot/);
    expect(broken('p_export', (def) => { def.effect.burstChannel = 'sea' as never; }))
      .toThrow(/burstChannel.*sea.*p_export/);
  });

  it('названия моделей: только у staged, без пустых и недостижимых', () => {
    expect(broken('d1_blade', (def) => { delete def.stagedNames; })).toThrow(/d1_blade.*stagedNames/);
    expect(broken('d1_blade', (def) => { def.stagedNames = []; })).toThrow(/d1_blade.*stagedNames/);
    expect(broken('d1_blade', (def) => { def.stagedNames = ['Долото', ' ']; }))
      .toThrow(/d1_blade.*stagedNames/);
    expect(broken('d1_blade', (def) => { def.staged = false; })).toThrow(/d1_blade.*staged/);
    // Названий больше, чем уровней: лишние игрок не купит никогда, а полностью
    // купленная карточка показывала бы несуществующую «следующую модель».
    expect(broken('t_frac', (def) => { def.maxLevel = def.stagedNames!.length - 1; }))
      .toThrow(/t_frac.*stagedNames.*maxLevel/);
    // Названий меньше, чем уровней, — допустимо: дальше держится последнее.
    expect(broken('t_frac', (def) => { def.stagedNames = def.stagedNames!.slice(0, 3); })).not.toThrow();
  });

  it('условие открытия достижимо', () => {
    expect(broken('t_pump2', (def) => { def.unlockAt = { upgrade: 't_pump1', level: 999 }; }))
      .toThrow(/t_pump2.*t_pump1.*999/);
    expect(broken('t_pump2', (def) => { def.unlockAt = { level: 2 }; }))
      .toThrow(/t_pump2.*unlockAt\.level/);
    expect(broken('t_pump2', (def) => { def.unlockAt = { balance: -5 }; }))
      .toThrow(/t_pump2.*unlockAt\.balance/);
    expect(broken('t_pump2', (def) => { def.unlockAt = { upgrade: 't_pump2' }; }))
      .toThrow(/t_pump2.*сам/);
  });

  it('числа механики заданы там, где без них покупка не работает', () => {
    expect(broken('p_crisis', (def) => { def.effect.chance = 1.5; })).toThrow(/p_crisis.*chance/);
    expect(broken('p_crisis', (def) => { delete def.effect.seconds; })).toThrow(/p_crisis.*seconds/);
    expect(broken('p_ministry', (def) => { def.effect.seconds = 0; })).toThrow(/p_ministry.*seconds/);
    expect(broken('p_ministry', (def) => { def.cooldownSeconds = -1; })).toThrow(/p_ministry.*cooldownSeconds/);
    expect(broken('t_well', (def) => { def.costGrowth = 0.5; })).toThrow(/t_well.*costGrowth/);
  });

  it('финальная покупка ровно одна', () => {
    const upgrades = structuredClone(content.upgrades);
    const win = upgrades.find((def) => def.win);
    expect(win).toBeDefined();
    upgrades.push({ ...structuredClone(win!), id: 'win_second', name: 'Второй финал' });
    expect(() => validateUpgrades(upgrades)).toThrow(/финальн.*win_pump.*win_second/);
  });

  it('достижение покупки существует', () => {
    expect(() => validateAchievements(
      content.achievements,
      upgradesWith('l_jacket1', (def) => { def.achievement = 'a_нет'; }),
    )).toThrow(/l_jacket1.*a_нет/);
  });
});

describe('validateAchievements (REVIEW C6, B9)', () => {
  const check = (achievements: AchievementDef[]) =>
    () => validateAchievements(achievements, content.upgrades);

  it('боевые достижения проходят проверку', () => {
    expect(check(content.achievements)).not.toThrow();
  });

  it('правила ссылаются на существующие покупки, группы и достижимые уровни', () => {
    expect(check(rule({ kind: 'own', upgrade: 'нет-такой' }))).toThrow(/a_test.*нет-такой/);
    expect(check(rule({ kind: 'own', upgrade: 'l_ring', value: 5 }))).toThrow(/a_test.*l_ring.*5/);
    expect(check(rule({ kind: 'ownGroup', group: 'нет-группы' }))).toThrow(/a_test.*нет-группы/);
    expect(check(rule({ kind: 'ownAny', upgrades: [] }))).toThrow(/a_test.*ownAny/);
    expect(check(rule({ kind: 'ownAny', upgrades: ['l_ring', 'l_опечатка'] })))
      .toThrow(/a_test.*l_опечатка/);
    expect(check(rule({ kind: 'earned', value: Number.NaN }))).toThrow(/a_test.*value/);
    expect(check(rule({ kind: 'неизвестно' } as never))).toThrow(/a_test.*неизвестно/);
    // Исправное правило проходит (вместе с боевыми: на них ссылаются покупки).
    expect(check([...content.achievements, ...rule({ kind: 'ownAny', upgrades: ['l_ring', 'l_crown'] })]))
      .not.toThrow();
  });

  it('id достижений не повторяются и не пусты', () => {
    const [first] = content.achievements;
    expect(check([first, first])).toThrow(new RegExp(`дублирующийся.*${first.id}`));
    expect(check([{ id: '', rule: { kind: 'win' } }])).toThrow(/без id/);
  });
});

describe('loadContent проверяет весь контент (REVIEW C6)', () => {
  afterEach(() => {
    vi.doUnmock('../src/content/config.json');
    vi.doUnmock('../src/content/achievements.json');
    vi.resetModules();
  });

  it('сломанный config.json останавливает загрузку понятной ошибкой', async () => {
    vi.resetModules();
    vi.doMock('../src/content/config.json', () => ({
      default: configWith((config) => { config.oil.autoDrill.requires = ['s_опечатка']; }),
    }));
    const fresh = await import('../src/core/content');
    expect(() => fresh.loadContent()).toThrow(/config\.json.*autoDrill.*s_опечатка/);
  });

  it('сломанный achievements.json останавливает загрузку понятной ошибкой', async () => {
    vi.resetModules();
    vi.doMock('../src/content/achievements.json', () => ({
      default: { achievements: rule({ kind: 'own', upgrade: 'нет-такой' }) },
    }));
    const fresh = await import('../src/core/content');
    expect(() => fresh.loadContent()).toThrow(/achievements\.json.*a_test.*нет-такой/);
  });
});
