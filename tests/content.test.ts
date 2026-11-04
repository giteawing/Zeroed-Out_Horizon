/**
 * Тесты контента: все покупки из ТЗ §6 на месте, строгие формулировки
 * сохранены, тексты и иконки не «висят» в пустоте.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { creditsIsPlaceholder, loadContent, validateUpgrades } from '../src/core/content';
import type { UpgradeDef } from '../src/core/types';

const content = loadContent();
const byId = content.byId;
const root = resolve(__dirname, '..');

/** Обязательные формулировки из ТЗ («строго»). */
const STRICT_NAMES = [
  'Попросить монет у императора «на поддержание штанов»',
  'Занести в «министерство нефтяных ресурсов»',
  'Сходить в сауну с главой «комитета по промышленности»',
  'Пихнуть нефть заграницу',
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
      'Пихнуть нефть заграницу',
      'мировой нефтяной кризис',
      'икорной вечеринкой',
      'Отжать месторождение',
      'Отжать нефтеперерабатывающий завод',
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

  it('дополнительные политические идеи: минимум 5 из списка', () => {
    const extra = [
      'щенка депутату',
      'благотворительный фонд',
      'оффшор',
      'юриста с говорящей фамилией',
      'местную газету',
      'на храм',
      'экспертизу',
    ];
    expect(extra.filter(has).length).toBeGreaterThanOrEqual(5);
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

  it('все типы долот по возрастанию эффективности', () => {
    const drills = content.upgrades
      .filter((u) => u.group === 'drills')
      .sort((a, b) => a.baseCost - b.baseCost);
    expect(drills).toHaveLength(7);
    expect(drills[0].name).toBe('Лопастное долото');
    expect(drills[6].name).toBe('Долото-Терминатор');
    for (let i = 1; i < drills.length; i++) {
      expect(drills[i].effect.value ?? 0).toBeGreaterThan(drills[i - 1].effect.value ?? 0);
    }
  });

  it('насосы, каротаж, оборудование, персонал, цифровые — на месте', () => {
    for (const needle of [
      'Поршневой буровой насос',
      'Насос с цифровым управлением',
      'Насос-Гигант',
      'каротажные приборы',
      'Имиджер',
      'Картограф',
      'Телеметрия MWD/LWD',
      'Азимутальный резистивиметр',
      'Лаборатория керна',
      'Винтовой забойный двигатель',
      'Роторная управляемая система (РУС)',
      'Верхний привод',
      'Буровой раствор «Премиум»',
      'Многостадийный ГРП',
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
      'priceBoost',
      'luxury',
    ]) {
      expect(types.has(type as never), `тип ${type} не используется`).toBe(true);
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

  it('в credits.txt пока заглушка — интерфейс покажет замену', () => {
    const raw = readFileSync(resolve(root, 'src/content/credits.txt'), 'utf8');
    expect(creditsIsPlaceholder(raw)).toBe(true);
    expect(content.texts.finale.creditsFallback).toBe('Здесь будет стихотворение.');
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
