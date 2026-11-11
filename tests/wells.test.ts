/**
 * Сумма дебита скважин не устаревает (AUDIT F10).
 *
 * Сумма кешируется по массиву `state.wells`. Раньше ключом были «тот же
 * массив и та же длина», поэтому правка на месте без смены длины оставляла
 * старую сумму. Теперь массив скважин — неизменяемое значение: скважины
 * добавляются заменой массива, а посчитанный массив замораживается.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { computeDerived, wellsDailyTonnes } from '../src/core/economy';
import { Game } from '../src/core/game';
import { estimatedGain } from '../src/core/simulator';
import { createInitialState, normalizeState, parseSave, serializeState } from '../src/core/state';
import type { GameState, Well } from '../src/core/types';

const content = loadContent();
const { config } = content;

const actualSum = (state: GameState): number =>
  state.wells.reduce((sum, well) => sum + well.dailyTonnes, 0);

function stateWith(wells: Well[]): GameState {
  const state = createInitialState(config, 31);
  state.wells = wells;
  return state;
}

/** Попытка изменить на месте: либо запись отклонена, либо сумма её учла. */
function attempt(write: () => void): void {
  try {
    write();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
  }
}

describe('сумма дебита скважин не устаревает (AUDIT F10)', () => {
  it('замена массива массивом той же длины пересчитывает дебит', () => {
    const state = stateWith([{ kind: 'ordinary', dailyTonnes: 10 }, { kind: 'good', dailyTonnes: 60 }]);
    expect(wellsDailyTonnes(state)).toBe(70);
    state.wells = [{ kind: 'unique', dailyTonnes: 900 }, { kind: 'good', dailyTonnes: 60 }];
    expect(wellsDailyTonnes(state)).toBe(960);
  });

  it('замена элемента на месте не оставляет устаревшую сумму', () => {
    const state = stateWith([{ kind: 'ordinary', dailyTonnes: 10 }, { kind: 'good', dailyTonnes: 60 }]);
    expect(wellsDailyTonnes(state)).toBe(70);
    attempt(() => {
      (state.wells as Well[])[0] = { kind: 'unique', dailyTonnes: 900 };
    });
    expect(wellsDailyTonnes(state)).toBe(actualSum(state));
  });

  it('правка дебита самой скважины не оставляет устаревшую сумму', () => {
    const state = stateWith([{ kind: 'ordinary', dailyTonnes: 10 }, { kind: 'good', dailyTonnes: 60 }]);
    expect(wellsDailyTonnes(state)).toBe(70);
    attempt(() => {
      (state.wells[1] as { dailyTonnes: number }).dailyTonnes = 5;
    });
    expect(wellsDailyTonnes(state)).toBe(actualSum(state));
  });

  it('удаление и добавление без смены длины не оставляют устаревшую сумму', () => {
    const state = stateWith([{ kind: 'ordinary', dailyTonnes: 10 }, { kind: 'good', dailyTonnes: 60 }]);
    expect(wellsDailyTonnes(state)).toBe(70);
    attempt(() => {
      const wells = state.wells as Well[];
      wells.pop();
      wells.push({ kind: 'unique', dailyTonnes: 1500 });
    });
    expect(wellsDailyTonnes(state)).toBe(actualSum(state));
  });

  it('посчитанный массив скважин заморожен: запись на месте — явная ошибка', () => {
    const state = stateWith([{ kind: 'ordinary', dailyTonnes: 10 }]);
    computeDerived(config, content.upgrades, state, [], content);
    expect(Object.isFrozen(state.wells)).toBe(true);
    expect(Object.isFrozen(state.wells[0])).toBe(true);
    expect(() => (state.wells as Well[]).push({ kind: 'good', dailyTonnes: 60 })).toThrow(TypeError);
    expect(() => {
      (state.wells as Well[])[0] = { kind: 'unique', dailyTonnes: 900 };
    }).toThrow(TypeError);
    expect(wellsDailyTonnes(state)).toBe(10);
  });
});

describe('движок добавляет скважины заменой массива (AUDIT F10)', () => {
  function gameWithMoney(): Game {
    const state = createInitialState(config, 32);
    state.coins = 1e12;
    state.totalEarned = 1e12;
    return new Game(content, state);
  }

  it('бурение: новый массив, прежний не тронут, дебит вырос на выпавшую скважину', () => {
    const game = gameWithMoney();
    const before = game.state.wells;
    const beforeCopy = before.map((well) => ({ ...well }));
    const beforeRate = game.derived().oilPerSecond;

    const result = game.buy('t_well');
    expect(result.ok).toBe(true);

    expect(game.state.wells).not.toBe(before);
    expect(before).toEqual(beforeCopy);
    expect(game.state.wells).toHaveLength(before.length + 1);
    expect(wellsDailyTonnes(game.state)).toBe(actualSum(game.state));
    expect(game.derived().oilPerSecond).toBeGreaterThan(beforeRate);
  });

  it('пакетное бурение: каждая скважина учтена в дебите', () => {
    const game = gameWithMoney();
    const before = game.state.wells.length;
    const result = game.buy('t_well', 10);
    expect(result.ok).toBe(true);
    expect(game.state.wells).toHaveLength(before + 10);
    expect(wellsDailyTonnes(game.state)).toBe(actualSum(game.state));
  });

  it('месторождение: скважины добавлены заменой массива и все учтены', () => {
    const game = gameWithMoney();
    game.derived();
    const before = game.state.wells;
    const beforeCopy = before.map((well) => ({ ...well }));

    const prize = game.applyReprivatization(1e6);

    expect(prize.wells).toBeGreaterThan(0);
    expect(game.state.wells).not.toBe(before);
    expect(before).toEqual(beforeCopy);
    expect(game.state.wells).toHaveLength(before.length + prize.wells);
    expect(wellsDailyTonnes(game.state)).toBe(actualSum(game.state));
  });

  /**
   * Бурит ли покупка скважину, решал список id в `game.ts`. Новая карточка
   * `type: 'well'` покупалась, деньги списывались, а скважины не появлялось.
   */
  it('покупка типа well бурит скважину, даже если её id нигде не записан', () => {
    const extra = structuredClone(content);
    const template = extra.byId.get('t_well')!;
    const added = { ...structuredClone(template), id: 't_well_extra', name: 'Вторая буровая' };
    extra.upgrades.push(added);
    extra.byId = new Map(extra.upgrades.map((def) => [def.id, def]));

    const state = createInitialState(extra.config, 31);
    state.coins = 1e12;
    state.totalEarned = 1e12;
    const game = new Game(extra, state);
    const before = game.state.wells.length;
    const rate = game.derived().oilPerSecond;

    const result = game.buy('t_well_extra', 3);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(game.state.levels.t_well_extra).toBe(3);
    expect(game.state.wells).toHaveLength(before + 3);
    expect(game.derived().oilPerSecond).toBeGreaterThan(rate);
    // Выплата покупки — суммарный дебит пробуренных скважин, как у «t_well».
    expect(result.payouts).toHaveLength(1);
    expect(result.payouts[0]!.amount).toBeCloseTo(
      game.state.wells.slice(before).reduce((sum, well) => sum + well.dailyTonnes, 0), 9,
    );

    // Бот оценивает такую покупку как скважину, а не как месторождение.
    const fresh = new Game(extra, createInitialState(extra.config, 31));
    const asWell = estimatedGain(fresh, template, 1_000);
    expect(asWell).toBeGreaterThan(0);
    expect(estimatedGain(fresh, added, 1_000)).toBe(asWell);
  });

  it('сохранение и загрузка дают тот же дебит и рабочую игру', () => {
    const game = gameWithMoney();
    game.buy('t_well', 5);
    game.derived();
    const restored = normalizeState(parseSave(serializeState(game.snapshot())), config, content);
    expect(restored.wells).toEqual(game.state.wells);
    expect(wellsDailyTonnes(restored)).toBe(wellsDailyTonnes(game.state));

    const next = new Game(content, restored);
    next.state.coins = 1e12;
    expect(next.buy('t_well').ok).toBe(true);
    expect(wellsDailyTonnes(next.state)).toBe(actualSum(next.state));
  });
});
