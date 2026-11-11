/**
 * Строка эффекта — единственное место карточки, где числа берутся из данных,
 * а не из авторского описания. Если она молчит о действующем поле, игрок о
 * нём не узнает: пять карточек ЧВК и «Купить голоса в парламенте» давали
 * только влияние, а показывали «×0,0% к добыче»; у «главного секретаря» не
 * было видно влияния, у электростанции — снижения расходов, у ставок — шанса,
 * у отжатия месторождения строка была пустой (REVIEW A4, B7).
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { computeDerived } from '../src/core/economy';
import { formatNumber, formatPercent } from '../src/core/format';
import { createInitialState } from '../src/core/state';
import { describeEffect, type EffectLineContext } from '../src/ui/effect-line';
import { Texts } from '../src/ui/texts';
import type { UpgradeDef, UpgradeEffect } from '../src/core/types';

const content = loadContent();
const texts = new Texts(content.texts);
const shopText = (key: string, params: Record<string, string | number> = {}): string =>
  texts.get(`shop.${key}`, params);

const context: EffectLineContext = {
  texts,
  config: content.config,
  currency: content.config.currency,
  lastWell: undefined,
  unlocks: [],
};

/** Строка эффекта ещё не купленной карточки. */
const line = (def: UpgradeDef): string => describeEffect(def, 0, context);
const byId = (id: string): UpgradeDef => {
  const def = content.byId.get(id);
  if (!def) throw new Error(`в контенте нет покупки ${id}`);
  return def;
};

/** Та же карточка с изменённым (или удалённым) полем effect. */
function withField(def: UpgradeDef, key: string, value: unknown): UpgradeDef {
  const effect: Record<string, unknown> = { ...def.effect };
  if (value === undefined) delete effect[key];
  else effect[key] = value;
  return { ...def, effect: effect as UpgradeEffect };
}

const cardsWith = (predicate: (def: UpgradeDef) => boolean): UpgradeDef[] => {
  const found = content.upgrades.filter(predicate);
  expect(found.length).toBeGreaterThan(0);
  return found;
};

describe('строка эффекта: у каждой карточки и без пустых обещаний', () => {
  it('строка есть у всех карточек, нулевой бонус не показывается', () => {
    const problems: string[] = [];
    for (const def of content.upgrades) {
      const text = line(def);
      if (text.trim().length === 0) problems.push(`${def.id} (${def.type}): пустая строка`);
      // «0%», «0,0%», «×0» — бонус, которого нет.
      if (/(?<![\d,])0(?:,0+)?%|×0(?![\d,])/.test(text)) problems.push(`${def.id} (${def.type}): «${text}»`);
      // Ключ, которого нет в texts.json, Texts.get возвращает как есть.
      if (/shop\.\w+/.test(text)) problems.push(`${def.id} (${def.type}): нет текста «${text}»`);
    }
    expect(problems).toEqual([]);
  });

  /**
   * Числа, о которых строка молчит намеренно. У разовой выплаты сумма зависит
   * от оборота империи в момент нажатия: множитель `value` без него ничего
   * не говорит, а `bankScale: 1` — признак банковской операции, не величина.
   */
  const SILENT = new Set(['oneShot.value', 'oneShot.bankScale']);

  it('изменение любого числа effect меняет строку эффекта', () => {
    const hidden: string[] = [];
    let checked = 0;
    for (const def of content.upgrades) {
      const before = line(def);
      for (const [key, value] of Object.entries(def.effect)) {
        if (typeof value !== 'number' || SILENT.has(`${def.type}.${key}`)) continue;
        checked++;
        const others = key === 'chance' ? [0, 1] : [value * 2 + 1, undefined];
        const shown = others.some((other) => line(withField(def, key, other)) !== before);
        if (!shown) hidden.push(`${def.id} (${def.type}): ${key} = ${value} — «${before}»`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(hidden).toEqual([]);
  });

  it('список исключений не устарел: такие поля в контенте есть', () => {
    for (const entry of SILENT) {
      const [type, key] = entry.split('.');
      expect(
        content.upgrades.some((def) => def.type === type && key! in def.effect),
        `исключение ${entry} не относится ни к одной карточке`,
      ).toBe(true);
    }
  });
});

describe('строка эффекта: то, чего раньше не было видно', () => {
  it('влияние показано у каждой карточки, которая его даёт', () => {
    for (const def of cardsWith((card) => !!card.effect.influence)) {
      expect(line(def), def.id)
        .toContain(shopText('effectInfluence', { value: formatNumber(def.effect.influence!) }));
    }
  });

  it('карточка без множителя добычи не обещает добычу', () => {
    // Подпись множителя без числа: «… к добыче».
    const production = shopText('effectMultiplier', { value: '' }).replace(/^[^\p{L}]+/u, '');
    expect(production.length).toBeGreaterThan(3);
    for (const def of cardsWith((card) => card.type === 'multiplier' && (card.effect.factor ?? 1) === 1)) {
      expect(line(def), def.id).not.toContain(production);
    }
    // У настоящих множителей подпись на месте, и прибавка записана прибавкой.
    for (const def of cardsWith((card) => card.type === 'multiplier' && (card.effect.factor ?? 1) > 1)) {
      expect(line(def), def.id).toContain(production);
      expect(line(def), def.id).toContain(`+${formatPercent(def.effect.factor! - 1, 1)}`);
      // «×6,0% к добыче» читалось как «умножить на шесть процентов».
      expect(line(def), def.id).not.toMatch(/×\d+(?:,\d+)?%/);
    }
  });

  it('множитель растёт с уровнем как factor^√уровень — так же, как в ядре', () => {
    const def = byId('t_carat');
    const factor = def.effect.factor!;
    expect(describeEffect(def, 4, context))
      .toContain(`+${formatPercent(Math.pow(factor, Math.sqrt(4)) - 1, 1)}`);
  });

  it('скидка на отжатие показана у карточек, которые её дают', () => {
    for (const def of cardsWith((card) => !!card.effect.conquestCut)) {
      expect(line(def), def.id)
        .toContain(shopText('effectConquestCut', { value: formatPercent(def.effect.conquestCut!, 0) }));
    }
  });

  it('постройка сбыта показывает снижение расходов', () => {
    for (const def of cardsWith((card) => card.type === 'sell' && !!card.effect.costCut)) {
      expect(line(def), def.id)
        .toContain(shopText('effectCostCut', { value: (def.effect.costCut! * 100).toFixed(0) }));
    }
  });

  it('ставка показывает множитель и шанс выигрыша', () => {
    for (const def of cardsWith((card) => card.type === 'gamble')) {
      expect(line(def), def.id).toContain(formatPercent(def.effect.chance!, 0));
      expect(line(def), def.id).toContain(`×${def.effect.factor}`);
      expect(line(def), def.id).toContain(String(def.effect.seconds));
    }
  });

  it('отжатие месторождения называет число скважин из конфигурации', () => {
    const { min, max } = content.config.oil.conquestWells;
    for (const def of cardsWith((card) => card.type === 'field')) {
      expect(line(def), def.id).toBe(shopText('effectField', { min, max }));
      expect(line(def), def.id).toContain(`${min}–${max}`);
    }
  });

  it('банковская операция сообщает, что идёт мимо налогов', () => {
    const launder = shopText('effectLaunder');
    expect(launder).not.toContain('shop.');
    for (const def of cardsWith((card) => !!card.effect.launder)) {
      expect(line(def), def.id).toContain(launder);
    }
    // Обычная разовая выплата налог платит.
    expect(line(byId('p_monarch'))).not.toContain(launder);
  });

  it('разовая продажа нефти описана как продажа запаса, а не как выплата', () => {
    for (const def of cardsWith((card) => !!card.effect.sellsOil)) {
      expect(line(def), def.id).toBe(shopText('effectOilBurst'));
      expect(line(def), def.id).not.toContain(shopText('effectOneShotHint'));
    }
  });
});

describe('строка эффекта: её утверждения проверены на ядре', () => {
  const crewIds = content.config.oil.autoDrill.requires;
  const derivedWith = (levels: Record<string, number>) => {
    const state = createInitialState(content.config, 7);
    state.wells = [{ kind: 'unique', dailyTonnes: 600 }];
    state.levels = { t_pump1: 3, ...levels };
    return computeDerived(content.config, content.upgrades, state, [], content);
  };
  const fullCrew = Object.fromEntries(crewIds.map((id) => [id, 1]));

  it('«хватает первого уровня»: следующие уровни бригады добычу не меняют', () => {
    expect(crewIds.length).toBeGreaterThan(0);
    const base = derivedWith(fullCrew);
    // Сама бригада работает: без одного участника добыча ниже.
    const { [crewIds[0]!]: _missing, ...incomplete } = fullCrew;
    expect(derivedWith(incomplete).oilPerSecond).toBeLessThan(base.oilPerSecond);
    for (const id of crewIds) {
      expect(line(byId(id)), id).toContain(shopText('effectCrew', {
        value: formatPercent(content.config.oil.autoDrill.bonus, 0),
      }));
      const more = derivedWith({ ...fullCrew, [id]: Math.min(byId(id).maxLevel, 5) });
      expect(more.oilPerSecond, id).toBe(base.oilPerSecond);
      expect(more.salaries, id).toBeGreaterThanOrEqual(base.salaries);
    }
  });

  it('«прямого бонуса к добыче нет» написано ровно там, где его нет', () => {
    const note = shopText('effectNoDirectBonus');
    const base = derivedWith(fullCrew);
    const noted = content.upgrades.filter((def) => line(def).includes(note));
    expect(noted.length).toBeGreaterThan(0);
    for (const def of noted) {
      const owned = derivedWith({ ...fullCrew, [def.id]: 1 });
      expect(owned.oilPerSecond, def.id).toBe(base.oilPerSecond);
      expect(owned.grossPerSecond, def.id).toBe(base.grossPerSecond);
    }
    // И наоборот: пассивная покупка с пустым effect вне бригады об этом говорит.
    for (const def of content.upgrades) {
      if (def.type !== 'passive' || Object.keys(def.effect).length > 0 || crewIds.includes(def.id)) continue;
      expect(line(def), def.id).toContain(note);
    }
  });

  it('обязательный уровень для финала показан на карточке и взят из конфигурации', () => {
    const required = content.config.winRequirements.filter((req) => req.upgrade !== undefined);
    expect(required.length).toBeGreaterThan(0);
    for (const req of required) {
      expect(line(byId(req.upgrade!)), req.upgrade)
        .toContain(shopText('effectGoalStage', { level: req.level ?? 1 }));
    }
    // У остальных карточек такой подписи нет.
    const marker = shopText('effectGoalStage', { level: '' }).trim();
    const ids = new Set(required.map((req) => req.upgrade));
    for (const def of content.upgrades) {
      if (!ids.has(def.id)) expect(line(def), def.id).not.toContain(marker);
    }
  });

  it('реприватизация и отжатие месторождения показывают одну и ту же строку', () => {
    expect(line(byId('p_reprivatize'))).toBe(line(byId('p_field')));
    // Обычное бурение — другое дело: там одна скважина.
    expect(line(byId('t_well'))).not.toBe(line(byId('p_field')));
    expect(describeEffect(byId('t_well'), 1, { ...context, lastWell: { kind: 'good', dailyTonnes: 60 } }))
      .toContain('60');
  });
});
