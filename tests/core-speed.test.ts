/**
 * Быстрый расчёт экономики не меняет ни одного числа (REVIEW A9).
 *
 * `computeDerived` вызывается несколько раз за шаг игры, а оценка имущества
 * пересчитывала цену каждого купленного уровня заново — на неё уходило больше
 * половины времени симуляции. Сумма уровней теперь запоминается; эти тесты
 * сверяют результат с прямым расчётом и следят, чтобы пересчёт не вернулся.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../src/core/content';
import {
  assetValueBreakdownOf,
  assetsValueOf,
  computeDerived,
  costFor,
  ownedLevelsCost,
  totalCostFor,
  wellPricePerDailyTonne,
  wellsDailyTonnes,
} from '../src/core/economy';
import { Game } from '../src/core/game';
import { estimatedGain } from '../src/core/simulator';
import { createInitialState } from '../src/core/state';
import type { Content, GameConfig, GameState, UpgradeDef, Well } from '../src/core/types';

/** Детерминированный генератор: тест не зависит от Math.random. */
function lcg(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

const isValuedAsset = (def: UpgradeDef): boolean =>
  Boolean(def.assetKind) && def.type !== 'luxury' && def.type !== 'well' && def.type !== 'win';

/** Прямой расчёт без кеша: цена каждого уровня считается через costFor. */
function referenceAssetsValue(
  config: GameConfig,
  upgrades: UpgradeDef[],
  state: GameState,
  exchangeRate: number,
): number {
  const values: number[] = [];
  for (const def of upgrades) {
    const level = state.levels[def.id] ?? 0;
    if (level <= 0 || !isValuedAsset(def)) continue;
    let sum = 0;
    for (let i = 0; i < level; i++) sum += costFor(config, def, i, exchangeRate);
    values.push(sum);
  }
  if (state.wells.length > 0) {
    values.push(wellsDailyTonnes(state, config) * wellPricePerDailyTonne(config, undefined, exchangeRate));
  }
  if (state.luxurySpent > 0) values.push(state.luxurySpent);
  values.sort((a, b) => b - a);
  return Math.max(0, Math.round(values.reduce((sum, value) => sum + value, 0)));
}

function randomState(content: Content, random: () => number, seed: number): GameState {
  const state = createInitialState(content.config, seed);
  for (const def of content.upgrades) {
    if (random() < 0.45) continue;
    state.levels[def.id] = 1 + Math.floor(random() * def.maxLevel);
  }
  const wells: Well[] = [];
  const count = Math.floor(random() * 40);
  for (let i = 0; i < count; i++) wells.push({ kind: 'ordinary', dailyTonnes: 1 + Math.floor(random() * 900) });
  state.wells = wells;
  state.luxurySpent = random() < 0.5 ? 0 : Math.floor(random() * 1e9);
  state.playtimeMs = Math.floor(random() * 30 * 60 * 1000);
  return state;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('оценка собственности равна прямому расчёту (REVIEW A9)', () => {
  const content = loadContent();
  const { config, upgrades } = content;
  const rates = [config.exchangeRate.initial, config.exchangeRate.initial * 1.5, config.exchangeRate.initial * 4];

  it('случайные состояния и курсы: общая стоимость совпадает бит в бит', () => {
    const random = lcg(20261110);
    for (let i = 0; i < 300; i++) {
      const state = randomState(content, random, i + 1);
      const rate = rates[Math.floor(random() * rates.length)];
      expect(assetsValueOf(config, upgrades, state, rate)).toBe(referenceAssetsValue(config, upgrades, state, rate));
    }
  });

  it('общая стоимость — сумма строк расшифровки, строки идут по убыванию', () => {
    const random = lcg(7);
    for (let i = 0; i < 50; i++) {
      const state = randomState(content, random, i + 1);
      const rate = rates[i % rates.length];
      const lines = assetValueBreakdownOf(config, upgrades, state, rate);
      const total = lines.reduce((sum, line) => sum + line.value, 0);
      expect(assetsValueOf(config, upgrades, state, rate)).toBe(Math.max(0, Math.round(total)));
      for (let k = 1; k < lines.length; k++) expect(lines[k - 1].value).toBeGreaterThanOrEqual(lines[k].value);
      for (const line of lines.filter((candidate) => candidate.kind === 'upgrade')) {
        const def = content.byId.get(line.id)!;
        expect(line.value).toBe(totalCostFor(config, def, 0, line.count, rate));
      }
    }
  });

  it('computeDerived отдаёт ту же стоимость, что и прямой расчёт', () => {
    const random = lcg(99);
    for (let i = 0; i < 40; i++) {
      const state = randomState(content, random, i + 1);
      const derived = computeDerived(config, upgrades, state, [], content);
      expect(derived.assetsValue).toBe(referenceAssetsValue(config, upgrades, state, derived.exchangeRate));
    }
  });

  it('цена купленных уровней верна при росте и падении уровня и смене курса', () => {
    const defs = upgrades.filter((def) => isValuedAsset(def) && def.maxLevel >= 10);
    expect(defs.length).toBeGreaterThan(5);
    for (const def of defs) {
      for (const level of [1, 5, 3, def.maxLevel, 0, 2, def.maxLevel - 1, 7]) {
        for (const rate of [rates[0], rates[2], rates[1], rates[0]]) {
          expect(ownedLevelsCost(config, def, level, rate)).toBe(totalCostFor(config, def, 0, level, rate));
        }
      }
    }
  });
});

describe('правка цен на месте не оставляет старую оценку (REVIEW A9)', () => {
  /** Каждая правка меняет тот же объект, по которому цена уже считалась. */
  const edits: Array<[string, (content: Content, def: UpgradeDef) => void]> = [
    ['baseCost покупки', (_content, def) => { def.baseCost *= 3; }],
    ['costGrowth покупки', (_content, def) => { def.costGrowth = 1.31; }],
    ['общий costGrowth', (content) => { content.config.costGrowth += 0.05; }],
    ['степень кривой цен', (content) => { content.config.currencyCostCurve.exponent = 0.8; }],
    ['порог кривой цен', (content) => { content.config.currencyCostCurve.anchor = 500; }],
    ['эластичность CAPEX', (content) => { content.config.exchangeRate.constructionCostElasticity += 0.4; }],
    ['стартовый курс', (content) => { content.config.exchangeRate.initial *= 2; }],
    ['покупка перестала быть капитальным активом', (_content, def) => { delete def.assetKind; }],
  ];

  it.each(edits)('%s', (_name, edit) => {
    const content = structuredClone(loadContent());
    const { config, upgrades } = content;
    // Покупка без собственного costGrowth (на неё действует общий множитель) и
    // с ценами выше порога кривой, чтобы каждая правка меняла сумму.
    const def = upgrades.find((candidate) =>
      isValuedAsset(candidate) && candidate.costGrowth === undefined &&
      candidate.maxLevel >= 10 && candidate.baseCost > 1e6)!;
    expect(def).toBeDefined();
    const state = createInitialState(config, 5);
    state.levels[def.id] = 10;
    // Курс между стартовым и удвоенным: правка стартового курса меняет индекс CAPEX.
    const rate = config.exchangeRate.initial * 1.5;

    const before = ownedLevelsCost(config, def, 10, rate);
    expect(before).toBe(totalCostFor(config, def, 0, 10, rate));
    const valueBefore = assetsValueOf(config, upgrades, state, rate);
    expect(valueBefore).toBe(referenceAssetsValue(config, upgrades, state, rate));

    edit(content, def);

    const after = ownedLevelsCost(config, def, 10, rate);
    expect(after).toBe(totalCostFor(config, def, 0, 10, rate));
    expect(after).not.toBe(before);
    const valueAfter = assetsValueOf(config, upgrades, state, rate);
    expect(valueAfter).toBe(referenceAssetsValue(config, upgrades, state, rate));
    expect(valueAfter).not.toBe(valueBefore);
  });

  it('смена типа покупки на «месторождение» возвращает индекс CAPEX', () => {
    const content = structuredClone(loadContent());
    const { config, upgrades } = content;
    const def = upgrades.find((candidate) => isValuedAsset(candidate) && candidate.maxLevel >= 20)!;
    const rate = config.exchangeRate.initial * 3;
    const asAsset = ownedLevelsCost(config, def, 12, rate);
    delete def.assetKind;
    const plain = ownedLevelsCost(config, def, 12, rate);
    expect(plain).toBe(totalCostFor(config, def, 0, 12, rate));
    expect(plain).toBeLessThan(asAsset);
    def.type = 'field';
    expect(ownedLevelsCost(config, def, 12, rate)).toBe(totalCostFor(config, def, 0, 12, rate));
    expect(ownedLevelsCost(config, def, 12, rate)).toBe(asAsset);
  });

  it('любое числовое поле конфигурации или покупки: правка на месте даёт прямой расчёт', () => {
    // Страховка на будущее: если цена начнёт зависеть от нового поля, а запомненная
    // сумма о нём не узнает, этот перебор найдёт расхождение.
    const content = structuredClone(loadContent());
    const { config, upgrades } = content;
    const defs = upgrades.filter((def) => isValuedAsset(def) && def.maxLevel >= 12).slice(0, 6);
    const rate = config.exchangeRate.initial * 1.7;
    const check = (where: string): void => {
      for (const def of defs) {
        for (const level of [12, 3]) {
          expect(ownedLevelsCost(config, def, level, rate), `${where}: ${def.id}`).toBe(
            totalCostFor(config, def, 0, level, rate),
          );
        }
      }
    };
    check('до правок');

    /** Обходит числовые листья объекта и правит каждый на месте. */
    const visit = (node: Record<string, unknown>, path: string): number => {
      let edited = 0;
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          node[key] = value === 0 ? 0.37 : value * 1.37;
          check(`${path}.${key}`);
          node[key] = value;
          check(`${path}.${key} (возврат)`);
          edited++;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          edited += visit(value as Record<string, unknown>, `${path}.${key}`);
        }
      }
      return edited;
    };
    const configLeaves = visit(config as unknown as Record<string, unknown>, 'config');
    expect(configLeaves).toBeGreaterThan(40);
    let defLeaves = 0;
    for (const def of defs) defLeaves += visit(def as unknown as Record<string, unknown>, def.id);
    expect(defLeaves).toBeGreaterThan(defs.length * 2);
  });

  it('дробный, нулевой, отрицательный и нечисловой уровень — как в прямом расчёте', () => {
    const content = structuredClone(loadContent());
    const { config, upgrades } = content;
    const def = upgrades.find((candidate) => isValuedAsset(candidate) && candidate.maxLevel >= 20)!;
    for (const level of [0, -3, Number.NaN, 0.2, 2.5, 7, 6.999]) {
      expect(ownedLevelsCost(config, def, level)).toBe(totalCostFor(config, def, 0, level));
    }
  });
});

describe('оценка собственности не пересчитывает купленные уровни (REVIEW A9)', () => {
  it('повторный computeDerived не считает цену каждого купленного уровня заново', () => {
    // Свежие определения: по ним ещё ничего не запомнено.
    const content = structuredClone(loadContent());
    const { config, upgrades } = content;
    const state = createInitialState(config, 9);
    let ownedLevels = 0;
    for (const def of upgrades.filter(isValuedAsset)) {
      state.levels[def.id] = def.maxLevel;
      ownedLevels += def.maxLevel;
    }
    expect(ownedLevels).toBeGreaterThan(500);

    const pow = vi.spyOn(Math, 'pow');
    const expected = computeDerived(config, upgrades, state, [], content).assetsValue;
    // Цена уровня считается через Math.pow: первый расчёт обязан быть виден
    // шпиону, иначе проверка ниже ничего не доказывает.
    expect(pow.mock.calls.length).toBeGreaterThanOrEqual(ownedLevels);
    expect(expected).toBe(referenceAssetsValue(config, upgrades, state, config.exchangeRate.initial));

    pow.mockClear();
    const runs = 20;
    for (let i = 0; i < runs; i++) {
      expect(computeDerived(config, upgrades, state, [], content).assetsValue).toBe(expected);
    }
    // Раньше каждый расчёт возводил в степень минимум дважды на купленный
    // уровень: тысячи вызовов Math.pow на один computeDerived.
    expect(pow.mock.calls.length / runs).toBeLessThan(ownedLevels / 4);
  });

  it('условный курс симулятора не вытесняет суммы текущего курса', () => {
    // Симулятор оценивает девальвацию на копии состояния с другим курсом и
    // тут же возвращается к текущему. Оба курса должны оставаться запомненными.
    const content = structuredClone(loadContent());
    const { config, upgrades } = content;
    const state = createInitialState(config, 9);
    for (const def of upgrades.filter(isValuedAsset)) state.levels[def.id] = def.maxLevel;
    const current = config.exchangeRate.initial * 1.05;
    const hypothetical = config.exchangeRate.initial * 1.05 * 1.05;
    const atCurrent = assetsValueOf(config, upgrades, state, current);
    const atHypothetical = assetsValueOf(config, upgrades, state, hypothetical);
    expect(atHypothetical).toBeGreaterThan(atCurrent);

    const pow = vi.spyOn(Math, 'pow');
    for (let i = 0; i < 10; i++) {
      expect(assetsValueOf(config, upgrades, state, hypothetical)).toBe(atHypothetical);
      expect(assetsValueOf(config, upgrades, state, current)).toBe(atCurrent);
    }
    // На 20 оценок — только индекс CAPEX для скважин, а не цены 1256 уровней.
    expect(pow.mock.calls.length).toBeLessThan(100);
  });
});

describe('оценка прироста в симуляторе (REVIEW A9)', () => {
  it('готовая экономика «до покупки» даёт тот же прирост, что и расчёт внутри', () => {
    const content = loadContent();
    const { config, upgrades } = content;
    const random = lcg(4242);
    const state = randomState(content, random, 31);
    state.coins = 1e15;
    state.totalEarned = 1e15;
    state.clockMs = state.playtimeMs;
    const game = new Game(content, state);
    const before = computeDerived(config, upgrades, state, [], content);

    let compared = 0;
    for (const def of upgrades) {
      if (def.win) continue;
      const cost = game.checkBuy(def.id).cost;
      const gain = estimatedGain(game, def, cost);
      expect(Number.isFinite(gain), def.id).toBe(true);
      expect(estimatedGain(game, def, cost, before), def.id).toBe(gain);
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });
});
