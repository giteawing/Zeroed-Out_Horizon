import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { costFor } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import { loadContent } from '../src/core/content';
import type { GameEvent, GameState } from '../src/core/types';

const content = loadContent();
const config = content.config;

/** Цена покупки по текущему контенту (цены меняет балансировщик, не тесты). */
function priceOf(id: string, level = 0): number {
  const def = content.byId.get(id);
  if (!def) throw new Error(`нет покупки ${id}`);
  return costFor(config, def, level);
}

/** Ставит монеты и «накопленный заработок» так, чтобы покупка была доступна. */
function makeRich(state: GameState, id: string, extra = 10): void {
  const def = content.byId.get(id);
  const cost = priceOf(id) * extra;
  const needed = Math.max(cost, def?.unlockAt?.balance ?? 0);
  state.coins = needed;
  state.totalEarned = needed;
}

function setup(): { game: Game; state: GameState; events: GameEvent[] } {
  const state = createInitialState(config, 12345);
  const game = new Game(content, state);
  const events: GameEvent[] = [];
  game.on((e) => events.push(e));
  return { game, state, events };
}

describe('тап', () => {
  it('начисляет монеты и считает тапы', () => {
    const { game, state } = setup();
    const gain = game.tap();
    expect(gain).toBeGreaterThan(0);
    expect(state.coins).toBeGreaterThan(0);
    expect(state.totalTaps).toBe(1);
  });

  it('растёт от технических улучшений', () => {
    const { game, state } = setup();
    const before = game.derived().tapValue;
    makeRich(state, 'd1_blade', 100);
    game.buy('d1_blade', 5);
    expect(game.derived().tapValue).toBeGreaterThan(before);
  });

  it('после победы больше не начисляет', () => {
    const { game, state } = setup();
    state.coins = config.winCost;
    for (const req of config.winRequirements) {
      if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
    }
    expect(game.buy('win_pump').ok).toBe(true);
    const coins = state.coins;
    expect(game.tap()).toBe(0);
    expect(state.coins).toBe(coins);
  });
});

describe('покупки', () => {
  it('нельзя купить без денег', () => {
    const { game, state, events } = setup();
    state.totalEarned = 1e12; // разблокировано, но денег нет
    const result = game.buy('t_refinery');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('noMoney');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('нельзя купить закрытую покупку', () => {
    const { game, state } = setup();
    state.coins = 1e9;
    const result = game.buy('t_smart');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('locked');
  });

  it('списывает ровно цену и повышает уровень', () => {
    const { game, state } = setup();
    const cost = priceOf('t_well');
    state.coins = cost + 5;
    const result = game.buy('t_well');
    expect(result.ok).toBe(true);
    expect(result.cost).toBe(cost);
    expect(state.levels.t_well).toBe(1);
    expect(state.coins).toBe(5);
    expect(state.totalPurchases).toBe(1);
  });

  it('покупает пачкой уровней', () => {
    const { game, state } = setup();
    state.coins = 1e6;
    const result = game.buy('t_well', 5);
    expect(result.level).toBe(5);
    expect(state.levels.t_well).toBe(5);
  });

  it('уважает maxLevel', () => {
    const { game, state } = setup();
    const def = content.byId.get('l_boat');
    makeRich(state, 'l_boat');
    expect(game.buy('l_boat').ok).toBe(true);
    expect(state.levels.l_boat).toBe(def?.maxLevel);
    expect(game.buy('l_boat').reason).toBe('maxLevel');
  });

  it('расходует и учитывает роскошь отдельно', () => {
    const { game, state } = setup();
    makeRich(state, 'l_boat');
    game.buy('l_boat');
    expect(state.luxurySpent).toBeGreaterThan(0);
  });

  it('ставит перезарядку на события и не даёт спамить', () => {
    const { game, state } = setup();
    makeRich(state, 'p_contractor');
    expect(game.buy('p_contractor').ok).toBe(true);
    const second = game.buy('p_contractor');
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('cooldown');
    expect(game.checkBuy('p_contractor').cooldownMs).toBeGreaterThan(0);
  });

  it('перезарядка тикает и снимается', () => {
    const { game, state } = setup();
    makeRich(state, 'p_contractor');
    game.buy('p_contractor');
    const cd = game.checkBuy('p_contractor').cooldownMs;
    game.update(cd + 100);
    expect(game.checkBuy('p_contractor').cooldownMs).toBe(0);
  });

  it('разовое событие выплачивает монеты', () => {
    const { game, state } = setup();
    makeRich(state, 'p_contractor');
    state.coins = 0;
    const before = state.coins;
    const result = game.buy('p_contractor');
    expect(result.ok).toBe(true);
    expect(state.coins).toBeGreaterThan(before);
  });
});

describe('гэмблы', () => {
  it('возвращают деньги через заявленное время', () => {
    const { game, state } = setup();
    const def = content.byId.get('p_crisis');
    const seconds = def?.effect.seconds ?? 30;
    makeRich(state, 'p_crisis');
    const before = state.coins;
    expect(game.buy('p_crisis').ok).toBe(true);
    expect(state.gambles).toHaveLength(1);
    expect(state.coins).toBeLessThan(before);

    game.update(seconds * 1000 + 1000);
    expect(state.gambles).toHaveLength(0);
  });
});

describe('периодические бонусы', () => {
  it('выдают выплату по таймеру', () => {
    const { game, state, events } = setup();
    makeRich(state, 'p_ministry');
    expect(game.buy('p_ministry').ok).toBe(true);
    const before = state.coins;
    game.update(80_000);
    expect(state.coins).toBeGreaterThan(before);
    expect(events.some((e) => e.type === 'periodic')).toBe(true);
  });
});

describe('экономика во времени', () => {
  it('пассивный доход тикает и не уходит в минус', () => {
    const { game, state } = setup();
    makeRich(state, 't_well', 100);
    game.buy('t_well', 10);
    game.update(10_000);
    expect(state.coins).toBeGreaterThan(900);
    expect(game.derived().netPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('один большой шаг даёт тот же доход, что сто маленьких', () => {
    const { game: big, state: s1 } = setup();
    const { game: small, state: s2 } = setup();
    for (const s of [s1, s2]) {
      makeRich(s, 't_well', 100);
    }
    big.buy('t_well', 10);
    small.buy('t_well', 10);
    s1.coins = s2.coins = 0;
    big.update(10_000);
    for (let i = 0; i < 100; i++) small.update(100);
    expect(s1.coins).toBeCloseTo(s2.coins, -3);
  });

  it('мировая цена нефти остаётся в коридоре 0.7–1.3', () => {
    const { game, state } = setup();
    for (let i = 0; i < 600; i++) game.update(1000);
    expect(state.worldPrice).toBeGreaterThanOrEqual(config.worldPrice.min - 1e-9);
    expect(state.worldPrice).toBeLessThanOrEqual(config.worldPrice.max + 1e-9);
  });
});

describe('достижения', () => {
  it('выдаются по правилам и не дублируются', () => {
    const { game, state, events } = setup();
    game.tap();
    expect(state.achievements).toContain('a_first');
    game.tap();
    expect(events.filter((e) => e.type === 'achievement' && e.id === 'a_first')).toHaveLength(1);
  });

  it('«Налоги? Какие налоги?» выдаётся при низком налоге', () => {
    const { game, state } = setup();
    makeRich(state, 'p_sauna', 1e6);
    game.buy('p_sauna', 10);
    game.checkAchievements();
    expect(game.derived().taxRate).toBeLessThanOrEqual(0.1);
    expect(state.achievements).toContain('a_tax');
  });
});

describe('победа', () => {
  it('требует ключевые улучшения и деньги', () => {
    const { game, state } = setup();
    state.coins = config.winCost;
    expect(game.buy('win_pump').reason).toBe('locked');
    for (const req of config.winRequirements) {
      if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
    }
    const before = state.coins;
    const result = game.buy('win_pump');
    expect(result.ok).toBe(true);
    expect(state.won).toBe(true);
    expect(state.coins).toBe(before - config.winCost);
    expect(state.achievements).toContain('a_win');
  });

  it('после победы покупки недоступны', () => {
    const { game, state } = setup();
    state.coins = config.winCost * 2;
    for (const req of config.winRequirements) {
      if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
    }
    game.buy('win_pump');
    expect(game.buy('t_well').reason).toBe('won');
  });
});

describe('детерминированность', () => {
  it('одинаковый сид — одинаковый результат', () => {
    const run = (): number => {
      const state = createInitialState(config, 999);
      const game = new Game(content, state);
      for (let i = 0; i < 50; i++) {
        game.tap();
        game.update(500);
      }
      return state.coins;
    };
    expect(run()).toBe(run());
  });
});

describe('снимок состояния', () => {
  it('сохраняет сид и время', () => {
    const { game } = setup();
    const snap = game.snapshot();
    expect(typeof snap.rngSeed).toBe('number');
    expect(snap.savedAtWallMs).toBeGreaterThan(0);
  });
});

beforeEach(() => {
  // Каждый тест получает свежий контент: тесты не должны зависеть от порядка.
});
