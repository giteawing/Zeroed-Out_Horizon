/**
 * Тесты контента: все покупки из ТЗ §6 на месте, строгие формулировки
 * сохранены, тексты и иконки не «висят» в пустоте.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { creditsIsPlaceholder, loadContent, validateUpgrades } from '../src/core/content';
import {
  REPRIVAT_PRIZE_MAX,
  REPRIVAT_PRIZE_MIN,
  computeDerived,
  reprivatizationPrize,
  stagedNameOf,
} from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import type { UpgradeDef } from '../src/core/types';

const content = loadContent();
const byId = content.byId;
const root = resolve(__dirname, '..');

/** Обязательные формулировки из ТЗ («строго»). */
const STRICT_NAMES = [
  'Попросить монет у императора «на поддержание штанов»',
  'Занести в «министерство нефтяных ресурсов»',
  'Сходить в сауну с главой «комитета по промышленности»',
  'Контрабанда нефти заграницу',
  'Пропихнуть в министерстве энергетики топливный демпфер',
  'Вывоз капитала за границу',
  'Магистральный Насос «Упырь-Абсолют»',
];

describe('обязательные формулировки', () => {
  it('все строки «строго» присутствуют дословно', () => {
    const names = content.upgrades.map((u) => u.name);
    for (const strict of STRICT_NAMES) {
      expect(names, `нет покупки «${strict}»`).toContain(strict);
    }
  });

  it('все покупки с tag: strict помечены и на месте', () => {
    const strict = content.upgrades.filter((u) => u.tag === 'strict');
    expect(strict.length).toBeGreaterThanOrEqual(5);
  });
});

describe('новые политические и финансовые механики', () => {
  it('демпфер находится в политике и включается только покупкой', () => {
    const damper = byId.get('p_fuel_damper')!;
    expect(damper.tab).toBe('political');
    expect(damper.effect.fuelDamper).toBe(true);
    expect(damper.maxLevel).toBe(1);
  });

  it('вывоз капитала находится во вкладке цели и стоит ровно триллион', () => {
    const capital = byId.get('g_capital_flight')!;
    expect(capital.tab).toBe('goals');
    expect(capital.baseCost).toBe(1_000_000_000_000);
    expect(capital.effect.capitalFlightPerSecond).toBe(5_000_000_000);
    expect(capital.effect.capitalFlightGrowthPerMinute).toBe(0.01);
  });
});

describe('состав контента (ТЗ §6)', () => {
  const has = (needle: string): boolean =>
    content.upgrades.some((u) => u.name.includes(needle));

  it('политические: 15 обязательных пунктов', () => {
    const political = content.upgrades.filter((u) => u.tab === 'political');
    expect(political.length).toBeGreaterThanOrEqual(20); // 15 + дополнительные идеи
    for (const needle of [
      'Попросить монет',
      'фуршет',
      'министерство нефтяных ресурсов',
      'сауну',
      'Контрабанда нефти заграницу',
      'мировой нефтяной кризис',
      'икорной вечеринкой',
      'топливный кризис',
      'в правительство',
      'в сенат',
      'Нагнуть конкурента',
      'Швырнуть подрядчика',
      'Оптимизировать зарплату',
    ]) {
      expect(has(needle), `нет политической покупки «${needle}»`).toBe(true);
    }
  });

  it('дополнительные политические идеи: минимум 3 из списка', () => {
    const extra = [
      'щенка депутату',
      'благотворительный фонд',
      'оффшор',
      'местную газету',
      'телеканал имперского значения',
      'главным секретарём топливной и экологической безопасности',
      'экспертизу',
    ];
    expect(extra.filter(has).length).toBeGreaterThanOrEqual(3);
  });

  it('производственные объекты и сбытовая техника разнесены по вкладкам', () => {
    for (const id of ['t_well', 't_refinery', 't_refpipe', 't_gasplant', 't_power', 'p_field', 'p_refinery', 'p_reprivatize', 'r_uzine', 'r_alkyl', 'r_aromatics', 'r_chemical']) {
      expect(byId.get(id)?.tab, id).toBe('production');
    }
    for (const id of ['t_depot', 't_pipeline', 't_terminal', 't_rail', 't_railbranch', 't_exptanker', 't_azs', 't_canister', 't_tank', 't_roga']) {
      expect(byId.get(id)?.tab, id).toBe('sales');
    }
    expect(byId.get('d1_blade')?.tab).toBe('technical');
  });

  it('инфраструктура: все 8 объектов', () => {
    for (const needle of [
      'нефтеперерабатывающий завод',
      'нефтебазу',
      'сеть АЗС',
      'Чёрная змея',
      'морской терминал',
      'железнодорожную эстакаду',
      'газоперерабатывающий завод',
      'электростанцию на попутном газе',
    ]) {
      expect(has(needle), `нет объекта «${needle}»`).toBe(true);
    }
  });

  it('долото одно, но с историей моделей: каждая покупка — новое название', () => {
    const drills = content.upgrades.filter((u) => u.group === 'drills');
    expect(drills).toHaveLength(1);
    expect(drills[0].staged).toBe(true);
    expect((drills[0].stagedNames ?? []).length).toBeGreaterThanOrEqual(5);
    // Название первой модели — то, что видно в магазине до покупки.
    expect(drills[0].stagedNames?.[0]).toBe(drills[0].name);
  });

  it('у насоса, двигателя, раствора и ГРП тоже меняются названия', () => {
    for (const id of ['t_pump1', 't_motor', 't_mud', 't_frac']) {
      const def = content.byId.get(id)!;
      expect(def.staged, `${id} без staged`).toBe(true);
      expect((def.stagedNames ?? []).length, `${id} без названий`).toBeGreaterThanOrEqual(5);
      expect(new Set(def.stagedNames).size).toBe(def.stagedNames!.length);
    }
  });

  it('насосы, каротаж, оборудование, персонал, цифровые — на месте', () => {
    for (const needle of [
      'Насос «Поршень-1»',
      'Насос с цифровым управлением',
      'Насос-Гигант',
      'каротажные приборы',
      'Имиджер',
      'Картограф',
      'Телеметрия MWD/LWD',
      'Азимутальный резистивиметр',
      'Лаборатория керна',
      'Двигатель «Винт-1»',
      'Роторная управляемая система (РУС)',
      'Верхний привод',
      'Раствор «Премиум»',
      'ГРП «Первый разрыв»',
      'Умная скважина',
      'Электроцентробежный насос (ЭЦН)',
      'геонавигатора',
      'ГТИ-шника',
      'стахановцев',
      'главного технолога',
      'Цифровой двойник',
      'Пластогадалка',
      'Дроны-обходчики',
      'Рога и Копыта-Сервис',
      'капитального ремонта скважин',
      'Единый дашборд',
    ]) {
      expect(has(needle), `нет покупки «${needle}»`).toBe(true);
    }
  });

  it('роскошь: все линейки из ТЗ', () => {
    for (const needle of [
      'Лодка с мотором',
      'Катер «Нефтяной ручеёк»',
      'Яхта «Скважина-1»',
      'Суперяхта',
      'Яхта размером с остров',
      'Подержанная иномарка',
      'Внедорожник',
      'Лимузин',
      'Раритетный ретро-автомобиль',
      'Бронированный кортеж',
      'Брюлики',
      'Часы',
      'Пиджак',
      'Трость',
      'Шуба',
      'Сигары',
      'Вилла в Куршевеле',
      'Пентхаус',
      'Замок с привидениями',
      'Собственный остров',
      'Вертолёт',
      'Частный самолёт',
      'Ледокол',
      'дирижабль',
      'Золотой унитаз',
      'Бассейн с шампанским',
      'Личный повар',
      'Коллекция вин',
      'Икра ложками',
      'Чёрный квадрат',
      'Личный оркестр',
      'Футбольный клуб',
      'Собственный стадион',
      'Памятник самому себе',
      'Парадный портрет',
      'Фонтан',
      'Трон с подогревом',
      'Дед Мороз',
    ]) {
      expect(has(needle), `нет предмета роскоши «${needle}»`).toBe(true);
    }
  });

  it('у каждой линейки роскоши цены растут', () => {
    const groups = new Map<string, UpgradeDef[]>();
    for (const u of content.upgrades.filter((x) => x.tab === 'luxury')) {
      groups.set(u.group, [...(groups.get(u.group) ?? []), u]);
    }
    for (const [group, items] of groups) {
      const sorted = [...items].sort((a, b) => a.baseCost - b.baseCost);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].baseCost, `${group}: ${sorted[i].name} дешевле предыдущего`).toBeGreaterThan(
          sorted[i - 1].baseCost,
        );
      }
    }
  });

  it('финальная покупка одна и она «Упырь-Абсолют»', () => {
    const winners = content.upgrades.filter((u) => u.win);
    expect(winners).toHaveLength(1);
    expect(winners[0].name).toBe('Магистральный Насос «Упырь-Абсолют»');
    expect(winners[0].baseCost).toBe(content.config.winCost);
  });

  it('роскошь ничего не усиливает', () => {
    for (const u of content.upgrades.filter((x) => x.tab === 'luxury')) {
      expect(u.type).toBe('luxury');
      expect(u.effect.value ?? 0).toBe(0);
      expect(u.effect.factor ?? 1).toBe(1);
    }
  });
});

describe('целостность данных', () => {
  it('валидатор не пропускает кривые данные', () => {
    expect(() => validateUpgrades([{ ...byId.get('t_well')!, id: '' }])).toThrow();
    expect(() =>
      validateUpgrades([{ ...byId.get('t_well')!, tab: 'нет-такой' as never }]),
    ).toThrow();
    expect(() =>
      validateUpgrades([{ ...byId.get('t_well')!, unlockAt: { upgrade: 'нет-такой' } }]),
    ).toThrow();
    expect(() =>
      validateUpgrades([{ ...byId.get('t_well')!, effect: { channel: 'unknown' as never } }]),
    ).toThrow(/канал/);
    expect(() =>
      validateUpgrades([{ ...byId.get('t_well')!, effect: { exportMode: 'truck' as never } }]),
    ).toThrow(/способ экспорта/);
    expect(() =>
      validateUpgrades([{ ...byId.get('t_well')!, effect: { channelSplit: { crude: 1.5 } } }]),
    ).toThrow(/channelSplit/);
    expect(() =>
      validateUpgrades([{ ...byId.get('t_well')!, unlockAt: { influence: -1 } }]),
    ).toThrow(/unlockAt.influence/);
    expect(() => validateUpgrades([])).toThrow(/финальной/);
  });

  it('все типы из ТЗ §5.2 используются', () => {
    const types = new Set(content.upgrades.map((u) => u.type));
    for (const type of [
      'perTap',
      'passive',
      'multiplier',
      'taxCut',
      'costCut',
      'periodic',
      'oneShot',
      'gamble',
      'luxury',
    ]) {
      expect(types.has(type as never), `тип ${type} не используется`).toBe(true);
    }
  });

  it('каждая покупка имеет локализованное имя в texts.upgrades', () => {
    for (const upgrade of content.upgrades) {
      expect(content.texts.upgrades[upgrade.id], `нет текста для ${upgrade.id}`).toBeTruthy();
    }
  });

  it('названия и описания не повторяются и не пустые', () => {
    const names = content.upgrades.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
    for (const u of content.upgrades) {
      expect(u.description.length, `пустое описание у ${u.id}`).toBeGreaterThan(5);
    }
  });

  it('для каждой покупки есть SVG-иконка', () => {
    const missing = content.upgrades
      .map((u) => u.icon)
      .filter((icon) => !existsSync(resolve(root, 'public/images/icons', `${icon}.svg`)));
    expect(missing).toEqual([]);
  });
});

describe('тексты', () => {
  it('в новостной ленте минимум 30 строк', () => {
    const news = content.texts.news;
    const lines = Object.entries(news)
      .filter(([key]) => key !== 'prefix')
      .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
    expect(lines.length).toBeGreaterThanOrEqual(30);
  });

  it('есть достижения с обязательными названиями', () => {
    const names = content.texts.achievements.list.map((a) => a.name);
    expect(names).toContain('Первый миллион');
    expect(names).toContain('Налоги? Какие налоги?');
    expect(names).toContain('Куршевель близко');
  });

  it('каждое достижение из texts.json имеет правило', () => {
    const ruleIds = new Set(content.achievements.map((a) => a.id));
    for (const text of content.texts.achievements.list) {
      expect(ruleIds.has(text.id), `нет правила для ${text.id}`).toBe(true);
    }
    for (const rule of content.achievements) {
      expect(
        content.texts.achievements.list.some((t) => t.id === rule.id),
        `нет текста для ${rule.id}`,
      ).toBe(true);
    }
  });

  it('credits.txt либо заглушка, либо настоящий стих — интерфейс понимает оба случая', () => {
    const raw = readFileSync(resolve(root, 'src/content/credits.txt'), 'utf8');
    expect(content.texts.finale.creditsFallback).toBe('Здесь будет стихотворение.');
    // Стих кладёт владелец игры, поэтому тест не требует конкретного состояния,
    // а проверяет, что заглушка распознаётся и что текст не пустой.
    if (creditsIsPlaceholder(raw)) {
      expect(raw).toContain('Здесь будет стихотворение');
    } else {
      expect(raw.trim().length).toBeGreaterThan(200);
    }
  });

  it('стихотворение из credits.txt готово к показу в титрах', () => {
    const raw = readFileSync(resolve(root, 'src/content/credits.txt'), 'utf8');
    if (creditsIsPlaceholder(raw)) return;
    // В браузере файл подставляется через Vite (?raw), поэтому здесь проверяем
    // сам источник: он не обрезан, читается целиком и содержит авторский текст.
    const poem = raw.trim();
    expect(poem.split('\n').length).toBeGreaterThan(10);
    expect(poem.toLowerCase()).toContain('капитал');
  });

  it('все обязательные разделы текстов заполнены', () => {
    for (const section of ['start', 'hud', 'tabs', 'shop', 'panel', 'stats', 'settings'] as const) {
      const entries = Object.values(content.texts[section]);
      expect(entries.length).toBeGreaterThan(0);
      for (const value of entries) expect(String(value).length).toBeGreaterThan(0);
    }
    expect(content.texts.finale.cutscene.length).toBeGreaterThanOrEqual(2);
  });

  it('в коде интерфейса нет «зашитых» русских строк в разметке экранов', () => {
    // Проверяем именно UI: тексты должны приходить из texts.json.
    const files = [
      'src/ui/shop.ts',
      'src/ui/hud.ts',
      'src/ui/finale.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      const latin = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      // Разрешаем кириллицу только в комментариях и в именах CSS-классов/данных.
      const suspicious = latin.match(/['"`][^'"`]*[А-Яа-яЁё][^'"`]*['"`]/g) ?? [];
      expect(suspicious, `${file}: строки должны браться из texts.json`).toEqual([]);
    }
  });
});

describe('этап 5: требования заказчика по содержанию', () => {
  const names = (): string[] => content.upgrades.map((u) => u.name);
  const hasName = (needle: string): boolean => names().some((n) => n.includes(needle));

  it('убраны пункты, которые заказчик просил убрать', () => {
    expect(hasName('юриста')).toBe(false);
    expect(hasName('на храм')).toBe(false);
    expect(hasName('дронов-разведчиков')).toBe(false);
    expect(hasName('ЧВК')).toBe(false);
  });

  it('добавлены новые пункты', () => {
    for (const needle of [
      'главным секретарём топливной и экологической безопасности',
      'телеканал имперского значения',
      'ж/д ветку к месторождению',
      'трубопровод к месторождению',
      'трубопровод к НПЗ',
      'экспортный трубопровод',
      'экспортный наливной терминал',
      'Увеличение масштабов деятельности банка',
      'получать зарплату через банк',
    ]) {
      expect(hasName(needle), `нет пункта «${needle}»`).toBe(true);
    }
  });

  it('убыточный банк — одноразовая покупка, операции открываются уровнями масштаба', () => {
    const bank = content.byId.get('p_badbank')!;
    expect(bank.maxLevel).toBe(1);
    const scale = content.byId.get('p_bank_scale')!;
    expect(scale.maxLevel).toBeGreaterThanOrEqual(6);
    for (const opId of ['p_tranche', 'p_hideprofit', 'p_launder']) {
      const op = content.byId.get(opId)!;
      expect(op.unlockAt?.upgrade, opId).toBe('p_bank_scale');
      expect(op.effect.bankScale, opId).toBeGreaterThan(0);
    }
    // Уровни, на которых открываются операции, идут по возрастанию.
    const levels = ['p_tranche', 'p_hideprofit', 'p_launder'].map(
      (id) => content.byId.get(id)!.unlockAt!.level ?? 1,
    );
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it('«Попросить монет» и фуршет открываются по влиянию', () => {
    expect(content.byId.get('p_monarch')!.unlockAt?.influence).toBeGreaterThan(0);
    expect(content.byId.get('p_forum')!.unlockAt?.influence).toBeGreaterThan(0);
  });

  it('реприватизация требует влияния и даёт случайный приз в 5–10 раз дороже', () => {
    const def = content.byId.get('p_reprivatize')!;
    expect(def.unlockAt?.influence).toBeGreaterThan(0);
    expect(REPRIVAT_PRIZE_MIN).toBe(5);
    expect(REPRIVAT_PRIZE_MAX).toBe(10);
    // Стоимость приза всегда в заданном коридоре, при любом ГПСЧ.
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const prize = reprivatizationPrize(content.config, 1_000_000, 100, () => r);
      expect(prize.wells).toBeGreaterThan(0);
      expect(prize.marketValue / 1_000_000).toBeGreaterThanOrEqual(4.5);
      expect(prize.marketValue / 1_000_000).toBeLessThanOrEqual(10.5);
    }
  });

  it('у каждого улучшения с историей своё название на каждом уровне', () => {
    for (const id of ['d1_blade', 't_pump1', 't_motor', 't_mud', 't_frac']) {
      const def = content.byId.get(id)!;
      expect(def.staged, id).toBe(true);
      expect(stagedNameOf(def, 1), id).toBe(def.stagedNames![0]);
      // Названия моделей действительно меняются с уровнем.
      expect(stagedNameOf(def, 2), id).not.toBe(stagedNameOf(def, 1));
      // За пределами списка — последняя модель, без падений.
      expect(stagedNameOf(def, 999), id).toBe(def.stagedNames![def.stagedNames!.length - 1]);
    }
  });

  it('«Контрабанда нефти заграницу» — одноразовая акция с перезарядкой', () => {
    const def = content.byId.get('p_export')!;
    expect(def.name).toBe('Контрабанда нефти заграницу');
    expect(def.type).toBe('oneShot');
    expect(def.repeatable).toBe(true);
    expect(def.cooldownSeconds).toBeGreaterThan(0);
  });

  it('экспортные цены выше внутренних, у объектов есть счётчики', () => {
    const state = createInitialState(content.config, 1);
    const derived = computeDerived(content.config, content.upgrades, state, [], content);
    expect(derived.exportPricePerTon).toBeGreaterThan(derived.domesticPricePerTon);
    for (const kind of ['refinery', 'depot', 'azs', 'exportPipe', 'refineryPipe'] as const) {
      expect(derived.assetCounts[kind]).toBe(0);
    }
    state.levels.t_refinery = 2;
    state.levels.t_depot = 3;
    const built = computeDerived(content.config, content.upgrades, state, [], content);
    expect(built.assetCounts.refinery).toBe(2);
    expect(built.assetCounts.depot).toBe(3);
    expect(built.assetsValue).toBeGreaterThan(0);
  });
});
describe('ссылочная целостность контента', () => {
  it('у каждой покупки есть локализованное название в texts.upgrades', () => {
    const textData = JSON.parse(readFileSync(resolve(root, 'src/content/texts.json'), 'utf8')) as {
      upgrades: Record<string, string>;
    };
    for (const upgrade of content.upgrades) {
      expect(textData.upgrades[upgrade.id], `нет названия для ${upgrade.id}`).toBeTruthy();
    }
  });
});

