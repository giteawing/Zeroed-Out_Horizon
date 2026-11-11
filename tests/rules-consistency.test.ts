/**
 * Правила и описания ↔ игра (REVIEW B7, B8, H7).
 *
 * Описание карточки пишет человек, механику задают числа `effect` и
 * `config.json`, и они расходятся молча: «результат ×10» у ставки с
 * множителем 2, «укрепляет влияние» у покупки без влияния. Здесь описания
 * сверяются с данными: каждое число в тексте должно выводиться из них, а
 * слова-обещания («влияние», «выплата») — подтверждаться полями карточки.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadContent } from '../src/core/content';
import { REPRIVAT_PRIZE_MAX, REPRIVAT_PRIZE_MIN } from '../src/core/economy';
import type { UpgradeDef } from '../src/core/types';

const content = loadContent();
const { config, byId, upgrades } = content;

/** Число так, как его пишут в описаниях: 11.1, 16.65, 37 (без хвостов float). */
const plain = (value: number): string => String(Number(value.toFixed(4)));
/** То же с десятичной запятой: 0,3. */
const comma = (value: number): string => plain(value).replace('.', ',');

const card = (id: string): UpgradeDef => {
  const def = byId.get(id);
  if (!def) throw new Error(`в контенте нет покупки ${id}`);
  return def;
};

/** Уровни покупки, на которых открываются другие карточки. */
function unlockLevels(id: string): number[] {
  return upgrades
    .filter((def) => def.unlockAt?.upgrade === id && (def.unlockAt.level ?? 1) > 1)
    .map((def) => def.unlockAt!.level!)
    .sort((a, b) => a - b);
}

/**
 * Фрагменты описания с числами и то, из чего каждый из них следует.
 * Ключ — id покупки; значение собирает ожидаемые фрагменты из данных.
 */
const NUMERIC_FACTS: Record<string, (def: UpgradeDef) => string[]> = {
  t_well: () => config.oil.wells.classes.map((cls) => `${cls.minDailyTonnes}–${cls.maxDailyTonnes}`),
  t_roga: (def) => [`+${comma(def.effect.exportBonus! * 100)}% мощности экспорта за уровень`],
  p_domestic_cartel: (def) => [`на ${plain((def.effect.domesticPriceMultiplier! - 1) * 100)}%`],
  p_export_cartel: (def) => [`на ${plain((def.effect.exportPriceMultiplier! - 1) * 100)}%`],
  p_devalue_currency: (def) => [
    `на ${plain(def.effect.exchangeRateDevaluation! * 100)}%`,
    // Условие открытия — «строго выше»: в данных стоит следующее целое.
    `строго выше ${def.unlockAt!.influence! - 1}`,
  ],
  p_field: () => [`${config.oil.conquestWells.min}–${config.oil.conquestWells.max} скважин`],
  p_reprivatize: () => [
    `${config.oil.conquestWells.min}–${config.oil.conquestWells.max} скважин`,
    `в ${REPRIVAT_PRIZE_MIN}–${REPRIVAT_PRIZE_MAX} раз`,
  ],
  g_capital_flight: (def) => [
    `${plain(def.effect.capitalFlightPerSecond! / 1e9)} млрд ₦/с`,
    `на ${plain(def.effect.capitalFlightGrowthPerMinute! * 100)}%`,
  ],
  p_bank_scale: (def) => {
    const levels = unlockLevels(def.id);
    return [`На уровнях ${levels.slice(0, -1).join(', ')} и ${levels[levels.length - 1]}`];
  },
};

// Договоры и модернизация НПЗ называют свой процент за уровень.
for (const def of upgrades) {
  if (def.type === 'sell' && def.effect.percent !== undefined) {
    NUMERIC_FACTS[def.id] = (current) => [`на ${plain(current.effect.percent!)}% за уровень`];
  }
}

/** Числа без механики: роскошь ничего не даёт, её описание — шутка. */
const FLAVOUR_NUMBERS = new Set(['l_retro']);

/** Слова, которыми описание называет множитель, не написав цифру. */
const MULTIPLIER_WORDS = /вдвое|втрое|вчетверо|впятеро|вдесятеро|удваива|удвои|утраива|утрои|×/i;

describe('описания карточек: числа берутся из данных (REVIEW B7)', () => {
  it('каждое число в описании выводится из effect, unlockAt или config', () => {
    const problems: string[] = [];
    for (const def of upgrades) {
      const facts = NUMERIC_FACTS[def.id]?.(def) ?? [];
      let rest = def.description;
      for (const fact of facts) {
        if (!rest.includes(fact)) problems.push(`${def.id}: в описании нет «${fact}»`);
        rest = rest.split(fact).join(' ');
      }
      if (FLAVOUR_NUMBERS.has(def.id)) continue;
      const stray = rest.match(/\d+(?:[.,]\d+)?/g);
      if (stray) problems.push(`${def.id}: число без источника в данных: ${stray.join(', ')} — «${def.description}»`);
    }
    expect(problems).toEqual([]);
  });

  it('описание не называет множитель словами: множитель показывает строка эффекта', () => {
    const wordy = upgrades
      .filter((def) => MULTIPLIER_WORDS.test(def.description))
      .map((def) => `${def.id}: «${def.description}»`);
    expect(wordy).toEqual([]);
  });

  it('таблица чисел не ссылается на несуществующие покупки', () => {
    for (const id of [...Object.keys(NUMERIC_FACTS), ...FLAVOUR_NUMBERS]) {
      expect(byId.has(id), `нет покупки ${id}`).toBe(true);
    }
  });

  it('числа прописью совпадают с данными', () => {
    // «Клёпаный резервуар на двадцать тысяч тонн».
    expect(card('t_tank').effect.value).toBe(20_000);
    expect(card('t_tank').description).toContain('двадцать тысяч тонн');
    // «Раз в минуту …».
    expect(card('t_neuro').effect.seconds).toBe(60);
    expect(card('t_neuro').description).toContain('Раз в минуту');
    // «Перевести триллион …».
    expect(card('g_capital_flight').baseCost).toBe(1e12);
    expect(card('g_capital_flight').description).toContain('триллион');
  });
});

describe('описания карточек: обещания подтверждены полями (REVIEW B7, B8)', () => {
  it('ставка описана как ставка: проигрыш вероятнее выигрыша, и текст это говорит', () => {
    const gambles = upgrades.filter((def) => def.type === 'gamble');
    expect(gambles.length).toBeGreaterThan(0);
    for (const def of gambles) {
      const chance = def.effect.chance ?? 0;
      const factor = def.effect.factor ?? 0;
      // Сами числа: ожидание ниже ставки (аудит A8) и шанс меньше половины.
      expect(chance * factor, `${def.id}: ожидание`).toBeLessThan(1);
      expect(chance, `${def.id}: шанс`).toBeLessThan(0.5);
      expect(def.description, def.id).toMatch(/сгора/);
      expect(def.description, def.id).toMatch(/чаще/);
      // Раньше: «результат ×10», «отдача очень большая».
      expect(def.description, def.id).not.toMatch(/очень больш|×/);
    }
  });

  it('о влиянии пишет только карточка, которая его даёт или требует', () => {
    const empty = upgrades
      .filter((def) => /влияни/i.test(def.description))
      .filter((def) => !def.effect.influence && def.unlockAt?.influence === undefined)
      .map((def) => `${def.id}: «${def.description}»`);
    expect(empty).toEqual([]);
  });

  it('периодическая покупка описана как выплата, а не как новая добыча', () => {
    const periodic = upgrades.filter((def) => def.type === 'periodic');
    expect(periodic.length).toBeGreaterThan(0);
    const silent = periodic
      .filter((def) => !/выплат/i.test(def.description))
      .map((def) => `${def.id}: «${def.description}»`);
    expect(silent).toEqual([]);
  });

  it('периодика и множители не обещают того, чего не делают', () => {
    // Керн и министерство платят деньгами: скважин и нефтеотдачи не прибавляют.
    expect(card('p_ministry').description).toMatch(/скважин не прибавляется/);
    // Формулировка из ТЗ («строго») сохранена дословно.
    expect(card('p_ministry').description)
      .toContain('Периодически бесплатно появляются новые месторождения с хорошей нефтеотдачей');
    // КРС не отменяет падение дебита (`oil.wells.decline`).
    expect(card('t_krs').description).not.toMatch(/Возвращает к жизни/);
    expect(card('t_krs').description).toMatch(/[Дд]ебит/);
    // Резистивиметр — обычный множитель добычи, с геонавигатором не связан.
    expect(card('t_resist').description).not.toMatch(/геонавигатор/i);
    expect(card('t_resist').description).toMatch(/добыч/);
    // Сенат платит, но влияния не даёт.
    expect(card('p_senate').description).not.toMatch(/влияни/i);
  });

  it('разовая выплата не описана как поток «на время»', () => {
    const streams = upgrades
      .filter((def) => def.type === 'oneShot' && /на время|автоматически/i.test(def.description))
      .map((def) => `${def.id}: «${def.description}»`);
    expect(streams).toEqual([]);
  });
});

describe('README: откуда берётся влияние (REVIEW B8)', () => {
  /** Слово, по которому источник влияния узнаётся в README. */
  const SOURCES: Record<string, string> = {
    p_gov: 'правительств',
    p_newspaper: 'газет',
    p_parliament: 'парламент',
    p_secretary: 'секретар',
    pmc: 'ЧВК',
  };
  const readme = readFileSync(resolve(__dirname, '..', 'README.md'), 'utf8');
  const start = readme.indexOf('**Влияние**');
  const item = readme.slice(start, readme.indexOf('\n8. ', start));

  it('пункт о влиянии найден', () => {
    expect(start).toBeGreaterThan(0);
    expect(item.length).toBeGreaterThan(50);
  });

  it('названы все покупки, дающие влияние, и только они', () => {
    const givers = upgrades.filter((def) => def.effect.influence);
    expect(givers.length).toBeGreaterThan(0);
    for (const def of givers) {
      const word = SOURCES[def.id] ?? SOURCES[def.group];
      expect(word, `${def.id} даёт влияние, но в README не описан`).toBeDefined();
      expect(item, def.id).toContain(word!);
    }
    // Перечень источников — до точки с запятой; дальше сказано, кто влияния не даёт.
    const sources = item.slice(0, item.indexOf(';'));
    expect(sources.length).toBeGreaterThan(50);
    for (const word of Object.values(SOURCES)) expect(sources).toContain(word);
    // У «Попросить монет у императора», сената и министерства поля influence нет.
    for (const id of ['p_monarch', 'p_senate', 'p_ministry']) {
      expect(card(id).effect.influence).toBeUndefined();
    }
    expect(sources).not.toMatch(/император|сенат|министерств/);
  });
});
