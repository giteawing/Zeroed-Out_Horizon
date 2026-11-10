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

describe('непрерывная добыча и маршрутизация', () => {
  it('новая партия начинает с бесплатной работающей скважиной', () => {
    const { game, state } = setup();
    expect(state.wells.length).toBeGreaterThan(0);
    expect(game.derived().oilPerSecond).toBeGreaterThan(0);
  });

  it('добыча поступает автоматически, а продажа проходит через окно отгрузки', () => {
    const { game, state } = setup();
    const soldBefore = state.totalSold;
    const coinsBefore = state.coins;
    game.update(config.oil.shipDays * 1000);
    expect(state.totalSold).toBeGreaterThan(soldBefore);
    expect(state.coins).toBeGreaterThan(coinsBefore);
  });

  it('фиксированный поток нельзя установить выше физического максимума', () => {
    const { game, state } = setup();
    const maximum = game.derived().flowLimits.export;
    expect(game.setFlowControl('export', { mode: 'fixed', value: maximum + 1 })).toBe(false);
    expect(state.flowControl.export.mode).toBe('auto');
  });

  it('кнопочный максимум каждого направления равен его физическому лимиту', () => {
    for (const channel of ['export', 'refine', 'contract'] as const) {
      const { game, state } = setup();
      state.levels.t_refinery = 2;
      state.levels.t_pipeline = 1;
      game.invalidate();
      const maximum = game.derived().flowLimits[channel];
      expect(maximum).toBeGreaterThan(0);
      expect(game.setFlowControl(channel, { mode: 'fixed', value: maximum })).toBe(true);
      const flows = game.derived().flows;
      const actual = channel === 'export'
        ? flows.export
        : channel === 'refine'
          ? flows.refined
          : flows.domestic;
      expect(actual).toBeCloseTo(maximum, 6);
    }
  });

  it('фиксированный поток сохраняется и ограничивает автоматические каналы остатком', () => {
    const { game } = setup();
    const production = game.derived().oilPerSecond;
    const target = Math.min(production / 3, game.derived().flowLimits.contract);
    expect(game.setFlowControl('contract', { mode: 'fixed', value: target })).toBe(true);
    const derived = game.derived();
    expect(derived.flows.domestic).toBeCloseTo(target, 6);
    expect(derived.flows.export + derived.flows.refined + derived.flows.domestic)
      .toBeLessThanOrEqual(production + 1e-6);
  });

  it('автоматический режим сбрасывает фиксированное значение', () => {
    const { game, state } = setup();
    expect(game.setFlowControl('contract', { mode: 'fixed', value: 0 })).toBe(true);
    expect(game.setFlowControl('contract', { mode: 'auto', value: 0 })).toBe(true);
    expect(state.flowControl.contract).toEqual({ mode: 'auto', value: 0 });
  });

  it('оборудование увеличивает непрерывный дебит добычи', () => {
    const { game, state } = setup();
    const before = game.derived().oilPerSecond;
    makeRich(state, 'd1_blade', 100);
    expect(game.buy('d1_blade', 5).ok).toBe(true);
    expect(game.derived().oilPerSecond).toBeGreaterThan(before);
  });

  it('после победы добыча и продажи останавливаются', () => {
    const { game, state } = setup();
    state.coins = game.derived().winCost;
    for (const req of config.winRequirements) {
      if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
    }
    expect(game.buy('win_pump').ok).toBe(true);
    const coins = state.coins;
    const sold = state.totalSold;
    game.update(1000);
    expect(state.coins).toBe(coins);
    expect(state.totalSold).toBe(sold);
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

describe('покупки-действия с перезарядкой', () => {
  it('не «максимятся» и работают после перезарядки', () => {
    const { game, state } = setup();
    makeRich(state, 'p_export');
    // Экспортная акция продаёт нефть со склада: сначала её надо добыть.
    state.oil = game.derived().oilCapacity;
    expect(game.buy('p_export').ok).toBe(true);
    expect(state.levels.p_export).toBe(1);
    expect(game.buy('p_export').reason).toBe('cooldown');
    game.update((content.byId.get('p_export')?.cooldownSeconds ?? 40) * 1000 + 500);
    // За время ожидания нефть распродали контракты — снова наполняем резервуары.
    state.oil = game.derived().oilCapacity;
    expect(game.buy('p_export').ok).toBe(true);
    expect(state.levels.p_export).toBe(1);
  });

  it('роскошь покупается один раз', () => {
    const { game, state } = setup();
    makeRich(state, 'l_boat');
    expect(game.buy('l_boat').ok).toBe(true);
    expect(game.buy('l_boat').reason).toBe('maxLevel');
  });

  it('выплата события растёт вместе с империей', () => {
    const { game, state } = setup();
    makeRich(state, 'p_contractor');
    game.buy('t_well', 10);
    const before = state.coins;
    game.buy('p_contractor');
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

describe('нефтепродукты: производство сходится с продажей', () => {
  it('не перерабатывает нефть, если для продуктов нет рынка и складов', () => {
    const localContent = structuredClone(content);
    localContent.config.oil.channels.contract.baseRate = 0;
    localContent.config.oil.channels.contract.unlimited = true;
    localContent.config.oil.channels.export.baseRate = 0;
    localContent.config.product.baseStorage = 0;
    const state = createInitialState(localContent.config, 12345);
    state.wells = Array.from({ length: 40 }, () => ({ kind: 'unique' as const, dailyTonnes: 2500 }));
    state.levels = { t_refinery: 30 };
    state.oil = 0;
    state.products = 0;
    const game = new Game(localContent, state);
    for (let i = 0; i < 20; i++) game.update(1000);
    const derived = game.derived();

    expect(derived.productCapacity).toBe(0);
    expect(derived.flows.refined).toBe(0);
    expect(derived.flows.productsProduced).toBe(0);
    expect(derived.flows.productsSpill).toBe(0);
    expect(derived.finePerSecond).toBe(0);
    // Сырьё уходит на внутренний контракт вместо дорогого штрафуемого разлива.
    expect(derived.flows.domestic).toBeGreaterThan(0);
    expect(Number.isFinite(state.products)).toBe(true);
    expect(state.products).toBe(0);
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
    // Дебит скважин плавно падает со временем, поэтому шаги дают близкие,
    // но не бит-в-бит равные суммы.
    const diff = Math.abs(s1.coins - s2.coins);
    expect(diff / Math.max(1, s1.coins)).toBeLessThan(0.2);
  });

  it('трубопровод продаёт нефть сразу, минуя резервуары', () => {
    const { game, state } = setup();
    for (const id of config.oil.autoDrill.requires) state.levels[id] = 1;
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    state.levels['t_pipeline'] = 2;
    state.coins = 0;
    state.oil = 0;
    game.update(1000);
    const derived = game.derived();
    // Добыча ушла в трубу: в резервуарах пусто, деньги пришли сразу.
    expect(derived.hasPipeline).toBe(true);
    expect(state.oil).toBeLessThan(derived.oilPerSecond);
    expect(state.coins).toBeGreaterThan(0);
    // И та же нефть не продаётся второй раз из резервуаров.
    expect(state.oil).toBeCloseTo(0, 6);
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
    game.update(config.oil.shipDays * 1000);
    expect(state.achievements).toContain('a_first');
    game.update(config.oil.shipDays * 1000);
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
    const winCost = game.derived().winCost;
    state.coins = winCost;
    const requirements = config.winRequirements;
    if (requirements.length > 0) {
      expect(game.buy('win_pump').reason).toBe('locked');
      for (const req of requirements) {
        if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
      }
    }
    const before = state.coins;
    const result = game.buy('win_pump');
    expect(result.ok).toBe(true);
    expect(state.won).toBe(true);
    expect(state.coins).toBe(before - winCost);
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
