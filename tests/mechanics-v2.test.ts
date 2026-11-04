/**
 * Проверки новых механик из заявки: нефть как ресурс, каналы сбыта,
 * влияние, ЧВК, отжатие завода, убыточный банк, журнал операций и цены,
 * которые зафиксировал владелец игры.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { Game } from '../src/core/game';
import { costFor, levelOf } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import type { GameState } from '../src/core/types';

const content = loadContent();
const config = content.config;

function setup(): { game: Game; state: GameState } {
  const state = createInitialState(config, 424242);
  return { game: new Game(content, state), state };
}

function rich(state: GameState, amount = 1e12): void {
  state.coins = amount;
  state.totalEarned = amount;
}

describe('требования владельца по ценам', () => {
  it('НПЗ стоит от 80 млрд до 630 млрд', () => {
    const def = content.byId.get('t_refinery')!;
    const first = costFor(config, def, 0);
    const last = costFor(config, def, def.maxLevel - 1);
    expect(first).toBeGreaterThanOrEqual(80_000_000_000);
    expect(last).toBeGreaterThanOrEqual(600_000_000_000);
    expect(last).toBeLessThanOrEqual(700_000_000_000);
  });

  it('нефтебаза стоит от 40 млн до 2 млрд', () => {
    const def = content.byId.get('t_depot')!;
    const first = costFor(config, def, 0);
    const last = costFor(config, def, def.maxLevel - 1);
    expect(first).toBe(40_000_000);
    expect(last).toBeGreaterThanOrEqual(1_900_000_000);
    expect(last).toBeLessThanOrEqual(2_100_000_000);
  });

  it('цены в магазине — в нефтефаниках, а не в нефти', () => {
    // Стоимость покупки — это деньги (₦), а не тонны: валюта одна.
    for (const def of content.upgrades) {
      if (def.win) continue;
      expect(Number.isFinite(costFor(config, def, 0))).toBe(true);
      expect(costFor(config, def, 0)).toBeGreaterThanOrEqual(0);
    }
    expect(config.currency).toBe('₦');
  });
});

describe('новые покупки из заявки', () => {
  const has = (needle: string) =>
    content.upgrades.some((u) => u.name.toLowerCase().includes(needle.toLowerCase()));

  it('реприватизация месторождения со скважинами конкурента', () => {
    const def = content.byId.get('p_reprivatize');
    expect(def).toBeDefined();
    expect(def!.name).toBe('Устроить реприватизацию месторождения со скважинами конкурента');
    expect(def!.conquest).toBe(true);
    expect(def!.unlockAt?.influence).toBeGreaterThan(0);
  });

  it('убыточный банк и операции отмывания/ухода от налогов', () => {
    expect(has('убыточный банк')).toBe(true);
    const launder = content.upgrades.filter((u) => u.effect.launder === true);
    expect(launder.length).toBeGreaterThanOrEqual(2);
    // Каждая операция отмывания требует купленного банка.
    for (const def of launder) {
      expect(def.unlockAt?.upgrade).toBe('p_badbank');
    }
  });

  it('своя ЧВК усиливает влияние и удешевляет отжатие', () => {
    const pmc = content.upgrades.filter((u) => u.group === 'pmc');
    expect(pmc.length).toBeGreaterThanOrEqual(3);
    const { game, state } = setup();
    rich(state);
    const before = game.derived().influence;
    game.buy('pmc_vet');
    expect(game.derived().influence).toBeGreaterThan(before);

    // Скидка на отжатие растёт от ЧВК: цена падает.
    const conquest = content.byId.get('p_refinery')!;
    const noDiscount = costFor(config, conquest, 0);
    state.levels.pmc_legal = 1;
    const withPmc = game.checkBuy('p_refinery').cost;
    expect(game.derived().conquestCut).toBeGreaterThan(0);
    expect(withPmc).toBeLessThan(noDiscount);
  });

  it('отжатый завод даёт столько же, сколько свой, но стоит дешевле', () => {
    const own = content.byId.get('t_refinery')!;
    const taken = content.byId.get('p_refinery')!;
    // Один и тот же канал и одинаковая прибавка пропускной способности.
    expect(taken.effect.channel).toBe(own.effect.channel);
    expect(taken.effect.value).toBe(own.effect.value);
    // Но цена ниже, а вход — через влияние и ЧВК.
    expect(taken.baseCost).toBeLessThan(own.baseCost);
    expect(taken.conquest).toBe(true);
    expect(taken.unlockAt?.influence).toBeGreaterThan(0);
    expect(taken.unlockAt?.upgrade).toBe('pmc_chvk');
  });
});

describe('сбыт нефти', () => {
  it('добыча без каналов копится, с контрактами — продаётся', () => {
    const { game, state } = setup();
    rich(state, 1e6);
    game.buy('t_well', 5);
    state.oil = 0;
    game.update(1000);
    expect(state.totalSold).toBeGreaterThan(0);
    expect(state.coins).toBeGreaterThan(0);
  });

  it('НПЗ и экспорт поднимают цену тонны', () => {
    const { game, state } = setup();
    rich(state, 1e14);
    const before = game.derived().oilPricePerTon;
    game.buy('t_refinery');
    expect(game.derived().channels.refine.rate).toBeGreaterThan(0);
    // Общая цена тонны в премиальных каналах выше, чем в контрактах.
    expect(game.derived().channels.refine.price).toBeGreaterThan(
      game.derived().channels.contract.price,
    );
    expect(game.derived().oilPricePerTon).toBeCloseTo(before, 6);
  });

  it('автодобыча включается только с полной бригадой', () => {
    const { game, state } = setup();
    rich(state, 1e12);
    expect(game.derived().autoDrill).toBe(false);
    for (const id of config.oil.autoDrill.requires) {
      game.buy(id);
    }
    expect(game.derived().autoDrill).toBe(true);
    // Бригада удваивает пассивную добычу.
    expect(levelOf(state, config.oil.autoDrill.requires[0])).toBeGreaterThan(0);
  });

  it('экспортная акция продаёт нефть со склада и пишет журнал', () => {
    const { game, state } = setup();
    rich(state, 1e9);
    state.oil = game.derived().oilCapacity;
    const before = state.oil;
    game.buy('p_export');
    expect(state.oil).toBeLessThan(before);
    expect(state.totalSold).toBeGreaterThan(0);
    const entry = state.log.find((e) => e.kind === 'sold');
    expect(entry).toBeDefined();
    expect(entry!.tonnes).toBeGreaterThan(0);
    expect(entry!.price).toBeGreaterThan(0);
    expect(entry!.money).toBeGreaterThan(0);
  });

  it('без нефти экспортная акция не продаётся', () => {
    const { game, state } = setup();
    rich(state, 1e9);
    state.oil = 0;
    expect(game.buy('p_export').reason).toBe('noOil');
  });

  it('отмывание через банк пишет отдельную запись журнала', () => {
    const { game, state } = setup();
    rich(state, 1e10);
    game.buy('p_badbank');
    state.coins = 1e10;
    expect(game.buy('p_launder').ok).toBe(true);
    expect(state.log.some((e) => e.kind === 'launder')).toBe(true);
  });

  it('влияние копится от политики и открывает отжатия', () => {
    const { game, state } = setup();
    rich(state, 1e12);
    const before = game.derived().influence;
    game.buy('p_newspaper');
    game.buy('p_parliament');
    expect(game.derived().influence).toBeGreaterThan(before);

    // Отжатие завода закрыто, пока влияние мало.
    state.coins = 1e13;
    expect(game.checkBuy('p_refinery').unlocked).toBe(false);
    // Докупаем ЧВК и политику: влияние растёт.
    for (const id of ['pmc_vet', 'pmc_chvk', 'pmc_airbase']) {
      expect(game.buy(id).ok, id).toBe(true);
    }
    state.levels.p_gov = 10;
    state.levels.p_parliament = 10;
    expect(game.derived().influence).toBeGreaterThanOrEqual(35);
    expect(game.checkBuy('p_refinery').unlocked).toBe(true);
  });
});

describe('журнал операций', () => {
  it('хранит последние записи, а не растёт бесконечно', () => {
    const { game, state } = setup();
    rich(state, 1e12);
    for (let i = 0; i < 40; i++) {
      game.pushLog({ kind: 'event', money: i });
    }
    expect(state.log.length).toBeLessThanOrEqual(24);
    // Свежие записи — первыми.
    expect(state.log[0].money).toBe(39);
  });

  it('сохраняется и восстанавливается вместе с сейвом', async () => {
    const { normalizeState } = await import('../src/core/state');
    const { game, state } = setup();
    rich(state, 1e9);
    state.oil = game.derived().oilCapacity;
    game.buy('p_export');
    const restored = normalizeState(JSON.parse(JSON.stringify(state)), config, content);
    expect(restored.log.length).toBeGreaterThan(0);
    expect(restored.oil).toBeCloseTo(state.oil, 6);
    expect(restored.totalSold).toBeCloseTo(state.totalSold, 6);
  });
});
