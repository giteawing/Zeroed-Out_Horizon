/**
 * Торговые кнопки уровня (×1, ×5, ×10, MAX): набор слотов, точная цена
 * отрезка уровней и состояние кнопок в движке. Чистая экономика — без DOM.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';
import {
  buySlotsFor,
  maxAffordableLevels,
  rangeCost,
  slotsOf,
} from '../src/core/economy/purchases';
import type { UpgradeDef } from '../src/core/types';

const content = loadContent();

/** Карточка с уровнем, у которой есть все четыре кнопки и хватает уровня для ×10 и MAX. */
function leveledDef(): UpgradeDef {
  const def = content.upgrades.find((u) =>
    u.maxLevel >= 30 && !u.unlimited && !u.repeatable && !u.win &&
    u.cooldownSeconds === undefined && u.type !== 'refineryDepth' && !u.unlockAt);
  if (!def) throw new Error('в контенте нет leveled-карточки с maxLevel >= 30');
  return def;
}

function gameWith(coins: number): Game {
  const state = createInitialState(content.config, 2026);
  state.coins = coins;
  state.totalEarned = coins;
  return new Game(content, state);
}

describe('набор кнопок покупки', () => {
  it('уровневая карточка получает четыре кнопки, остальные — одну', () => {
    expect(buySlotsFor(leveledDef())).toEqual(['buy1', 'buy5', 'buy10', 'buyMax']);
    // Одноразовая покупка-действие без уровня (с перезарядкой).
    const action = content.upgrades.find((u) => u.repeatable === true)!;
    expect(buySlotsFor(action)).toEqual(['buy1']);
    // Финальная цель.
    const win = content.upgrades.find((u) => u.win)!;
    expect(buySlotsFor(win)).toEqual(['buy1']);
  });

  it('slotsOf берёт загруженный набор, а без него пересчитывает', () => {
    const def = leveledDef();
    expect(slotsOf(def)).toEqual(def.slots);
    expect(slotsOf({ ...def, slots: undefined })).toEqual(['buy1', 'buy5', 'buy10', 'buyMax']);
  });
});

describe('точная цена отрезка уровней', () => {
  it('rangeCost совпадает с ценой пачки из checkBuy', () => {
    const def = leveledDef();
    for (const count of [1, 3, 5, 10, 25]) {
      const from = 4;
      const game = gameWith(1e18);
      game.stateForTests().levels[def.id] = from;
      const range = rangeCost(content.config, def, from, count, game.derived().exchangeRate);
      expect(range).toBe(game.checkBuy(def.id, count).cost);
    }
  });
});

describe('максимальная доступная пачка', () => {
  it('накапливает уровни до баланса и не превышает лимит за покупку', () => {
    const def = leveledDef();
    const game = gameWith(1e18);
    const { count, cost } = maxAffordableLevels(
      content.config, def, 0, game.stateForTests().coins,
      game.derived().exchangeRate, content.config.maxBuyLevels, 0,
    );
    expect(count).toBe(content.config.maxBuyLevels);
    // Стоимость ровно стольких уровней.
    expect(cost).toBe(rangeCost(content.config, def, 0, count, game.derived().exchangeRate));
  });

  it('списывает пачку, которую покрывает баланс, и не выше', () => {
    const def = leveledDef();
    const one = gameWith(1e18).checkBuy(def.id, 1).cost;
    const game = gameWith(one);
    const { count, cost } = maxAffordableLevels(
      content.config, def, 0, game.stateForTests().coins,
      game.derived().exchangeRate, content.config.maxBuyLevels, 0,
    );
    expect(count).toBe(1);
    expect(cost).toBe(one);
  });
});

describe('состояние кнопок Game.buySlotState', () => {
  it('при больших деньгах все четыре кнопки доступны с правильными объёмами', () => {
    const def = leveledDef();
    const game = gameWith(1e18);
    const state = game.buySlotState(def.id);
    expect(state.slots.map((s) => s.slot)).toEqual(['buy1', 'buy5', 'buy10', 'buyMax']);
    expect(state.slots.map((s) => s.count)).toEqual([1, 5, 10, content.config.maxBuyLevels]);
    for (const slot of state.slots) {
      expect(slot.enabled).toBe(true);
      expect(slot.reason).toBe('ok');
    }
  });

  it('если хватает только на один уровень, кнопки ×5 и ×10 блокируются по деньгам', () => {
    const def = leveledDef();
    const one = gameWith(1e18).checkBuy(def.id, 1).cost;
    const game = gameWith(one);
    const state = game.buySlotState(def.id);
    const [buy1, buy5, buy10, max] = state.slots;
    expect(buy1!.enabled).toBe(true);
    expect(buy5!.enabled).toBe(false);
    expect(buy5!.reason).toBe('noMoney');
    expect(buy10!.enabled).toBe(false);
    expect(buy10!.reason).toBe('noMoney');
    // MAX покупает ровно один уровень — столько, сколько покрывает баланс.
    expect(max!.count).toBe(1);
    expect(max!.enabled).toBe(true);
  });

  it('если осталось меньше уровней, чем в порции, кнопка блокируется по уровню', () => {
    const def = leveledDef();
    const game = gameWith(1e30);
    // Осталось ровно три уровня: ×5 и ×10 некуда потратить.
    game.stateForTests().levels[def.id] = def.maxLevel - 3;
    const state = game.buySlotState(def.id);
    expect(state.available).toBe(3);
    const [buy1, buy5, buy10, max] = state.slots;
    expect(buy1!.enabled).toBe(true);
    expect(buy5!.enabled).toBe(false);
    expect(buy5!.reason).toBe('maxLevel');
    expect(buy10!.enabled).toBe(false);
    expect(buy10!.reason).toBe('maxLevel');
    expect(max!.count).toBe(3);
    expect(max!.enabled).toBe(true);
  });

  it('MAX покупает столько уровней, сколько указано в состоянии, и это срабатывает', () => {
    const def = leveledDef();
    const game = gameWith(1e18);
    const state = game.buySlotState(def.id);
    const max = state.slots.find((s) => s.slot === 'buyMax')!;
    const result = game.buy(def.id, max.count);
    expect(result.ok).toBe(true);
    expect(game.level(def.id)).toBe(max.count);
  });

  it('цена кнопки ×5 совпадает с проверкой покупки 5 уровней', () => {
    const def = leveledDef();
    const game = gameWith(1e18);
    const state = game.buySlotState(def.id);
    const buy5 = state.slots.find((s) => s.slot === 'buy5')!;
    expect(buy5.cost).toBe(game.checkBuy(def.id, 5).cost);
  });

  it('для покупки-действия одна кнопка с состоянием checkBuy', () => {
    const action = content.upgrades.find((u) => u.repeatable === true)!;
    const game = gameWith(1e18);
    const state = game.buySlotState(action.id);
    expect(state.slots).toHaveLength(1);
    expect(state.slots[0]!.slot).toBe('buy1');
    const check = game.checkBuy(action.id, 1);
    expect(state.slots[0]!.enabled).toBe(check.ok);
    expect(state.slots[0]!.reason).toBe(check.reason ?? 'ok');
  });
});
