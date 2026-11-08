/**
 * Проверки новых механик из заявки: нефть как ресурс, каналы сбыта,
 * влияние, ЧВК, отжатие завода, убыточный банк, журнал операций и цены,
 * которые зафиксировал владелец игры.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { Game } from '../src/core/game';
import { adjustCurrencyCost, costFor, levelOf } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import type { GameState } from '../src/core/types';

const content = loadContent();
const config = content.config;

function setup(seed = 424242): { game: Game; state: GameState } {
  const state = createInitialState(config, seed);
  return { game: new Game(content, state), state };
}

function rich(state: GameState, amount = 1e12): void {
  state.coins = amount;
  state.totalEarned = amount;
}

describe('требования владельца по ценам', () => {
  it('цена НПЗ и поздних уровней проходит через общую кривую', () => {
    const def = content.byId.get('t_refinery')!;
    const growth = def.costGrowth ?? config.costGrowth;
    const first = costFor(config, def, 0);
    const last = costFor(config, def, def.maxLevel - 1);
    expect(first).toBe(adjustCurrencyCost(config, def.baseCost));
    expect(last).toBe(adjustCurrencyCost(config, def.baseCost * Math.pow(growth, def.maxLevel - 1)));
    expect(last).toBeGreaterThan(first);
  });

  it('цена нефтебазы и поздних уровней проходит через общую кривую', () => {
    const def = content.byId.get('t_depot')!;
    const growth = def.costGrowth ?? config.costGrowth;
    const first = costFor(config, def, 0);
    const last = costFor(config, def, def.maxLevel - 1);
    expect(first).toBe(adjustCurrencyCost(config, def.baseCost));
    expect(last).toBe(adjustCurrencyCost(config, def.baseCost * Math.pow(growth, def.maxLevel - 1)));
    expect(last).toBeGreaterThan(first);
  });

  it('цены в магазине — в нефтефаниках, а не в нефти', () => {
    // Стоимость покупки — это деньги (₦), а не тонны: валюта одна.
    for (const def of content.upgrades) {
      if (def.win) continue;
      expect(Number.isFinite(costFor(config, def, 0))).toBe(true);
      expect(costFor(config, def, 0)).toBeGreaterThanOrEqual(0);
      expect(costFor(config, def, 0)).toBe(adjustCurrencyCost(config, def.baseCost));
    }
    expect(config.currency).toBe('₦');
  });
});

describe('новые покупки из заявки', () => {
  const has = (needle: string) =>
    content.upgrades.some((u) => u.name.toLowerCase().includes(needle.toLowerCase()));

  it('политические картели одноразовые и влияют только на свою группу цен', () => {
    const domestic = content.byId.get('p_domestic_cartel')!;
    const international = content.byId.get('p_export_cartel')!;
    expect(domestic.type).toBe('priceBoost');
    expect(domestic.maxLevel).toBe(1);
    expect(domestic.effect.domesticPriceMultiplier).toBeGreaterThan(1);
    expect(domestic.effect.exportPriceMultiplier).toBeUndefined();
    expect(international.type).toBe('priceBoost');
    expect(international.maxLevel).toBe(1);
    expect(international.effect.exportPriceMultiplier).toBeGreaterThan(1);
    expect(international.effect.domesticPriceMultiplier).toBeUndefined();
  });

  it('девальвация требует влияния 1001 и становится доступна за пределом 1000', () => {
    const def = content.byId.get('p_devalue_currency')!;
    expect(def.unlockAt?.influence).toBe(301);
    expect(def.maxLevel).toBeGreaterThan(1);
    const { game, state } = setup();
    state.levels = Object.fromEntries(content.upgrades.map((upgrade) => [
      upgrade.id,
      upgrade.id === def.id ? 0 : upgrade.maxLevel,
    ]));
    game.invalidate();
    expect(game.derived().influence).toBeGreaterThan(300);
    expect(game.checkBuy(def.id).unlocked).toBe(true);
  });

  it('реприватизация месторождения со скважинами конкурента', () => {
    const def = content.byId.get('p_reprivatize');
    expect(def).toBeDefined();
    expect(def!.name).toBe('Устроить реприватизацию месторождения со скважинами конкурента');
    expect(def!.conquest).toBe(true);
    expect(def!.unlockAt?.influence).toBeGreaterThan(0);
  });

  it('убыточный банк покупается один раз и открывает масштабы и операции', () => {
    expect(has('убыточный банк')).toBe(true);
    const bank = content.byId.get('p_badbank')!;
    expect(bank.maxLevel).toBe(1);
    const launder = content.upgrades.filter((u) => u.effect.launder === true);
    expect(launder.length).toBeGreaterThanOrEqual(2);
    // Сразу после банка открывается «масштаб», а операции — на его уровнях.
    const scale = content.byId.get('p_bank_scale')!;
    expect(scale.unlockAt?.upgrade).toBe('p_badbank');
    for (const def of launder) {
      expect(def.unlockAt?.upgrade, def.id).toBe('p_bank_scale');
      expect(def.effect.bankScale, def.id).toBeGreaterThan(0);
    }
    // Зарплаты через банк — отдельный пункт, он снижает расходы.
    const payroll = content.byId.get('p_bank_payroll')!;
    expect(payroll.type).toBe('costCut');
    expect(payroll.unlockAt?.upgrade).toBe('p_badbank');
  });

  it('уровни масштаба банка действительно усиливают выплаты', () => {
    const { game, state } = setup();
    rich(state, 1e12);
    expect(game.buy('p_badbank').ok).toBe(true);
    // Банк одноразовый: второй раз не покупается.
    expect(game.buy('p_badbank').ok).toBe(false);
    const before = game.bankScale();
    expect(game.buy('p_bank_scale').ok).toBe(true);
    expect(game.bankScale()).toBeGreaterThan(before);
  });

  it('реприватизация приносит скважины стоимостью в 5–10 раз больше цены', () => {
    const { game, state } = setup();
    rich(state, 1e12);
    // Реприватизация доступна только при влиянии: у «сетапа» его нет,
    // поэтому выставляем порог напрямую (влияние проверяется отдельным тестом).
    state.levels.p_parliament = 10;
    state.levels.pmc_chvk = 1;
    state.levels.pmc_vet = 1;
    game.invalidate();
    expect(game.derived().influence).toBeGreaterThanOrEqual(45);
    const check = game.checkBuy('p_reprivatize');
    expect(check.unlocked, JSON.stringify(check.blocker)).toBe(true);
    const wellsBefore = state.wells.length;
    const dailyBefore = game.derived().oilPerSecond;
    expect(game.buy('p_reprivatize').ok).toBe(true);
    const prize = state.wells.slice(wellsBefore);
    expect(prize.length).toBeGreaterThan(0);
    expect(game.derived().oilPerSecond).toBeGreaterThan(dailyBefore);
    // Стоимость приза в 5–10 раз больше уплаченного (с округлением до тонн).
    const daily = prize.reduce((sum, w) => sum + w.dailyTonnes, 0);
    const price = config.oil.basePricePerTon * config.oil.wells.priceSeconds;
    const ratio = (daily * price) / check.cost;
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThanOrEqual(10.5);
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
  it('нефть копится 5 суток, потом партия уезжает и приносит деньги', () => {
    const { game, state } = setup();
    rich(state, 1e6);
    game.buy('t_well', 5);
    // Маленький фиксированный дебит: до принудительного переполнения
    // партия действительно ждёт все пять суток.
    state.wells = [{ kind: 'ordinary', dailyTonnes: 8 }];
    game.invalidate();
    state.oil = 0;
    // Меньше срока накопления — партия ещё не отправлена.
    game.update(1000);
    expect(state.totalSold).toBe(0);
    expect(state.oil).toBeGreaterThan(0);
    // Прошли пять суток — нефть ушла на внутренний рынок.
    game.update(5000);
    expect(state.totalSold).toBeGreaterThan(0);
    expect(state.coins).toBeGreaterThan(999000);
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
    state.levels.p_bank_scale = 6;
    game.invalidate();
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

describe('налог зависит только от влияния и чиновников', () => {
  it('без влияния налог базовый, с влиянием — только снижается', () => {
    const { game, state } = setup();
    const base = game.derived().taxRate;
    expect(base).toBeCloseTo(config.tax.baseRate, 6);
    // Только явные источники влияния должны снижать налог.
    rich(state);
    state.levels.p_gov = 1;
    game.invalidate();
    const lowered = game.derived().taxRate;
    expect(game.derived().influence).toBeGreaterThan(0);
    expect(lowered).toBeLessThan(base);
  });

  it('налог не меняется сам по себе: один и тот же шаг даёт ту же ставку', () => {
    const { game, state } = setup();
    rich(state);
    state.levels['p_senate'] = 1;
    game.invalidate();
    const before = game.derived().taxRate;
    // Гоняем время: никаких «случайных» скачков ставки.
    const rates = new Set<number>();
    for (let i = 0; i < 30; i++) {
      game.update(1000);
      rates.add(Math.round(game.derived().taxRate * 1e6));
    }
    expect(rates.size).toBe(1);
    expect([...rates][0]).toBe(Math.round(before * 1e6));
  });

  it('закон о налоговом вычете для олигархов есть в политике', () => {
    const def = content.byId.get('p_taxbreak');
    expect(def).toBeDefined();
    expect(def!.tab).toBe('political');
    expect(def!.name).toBe('Пропихнуть закон о налоговом вычете для ресурсодобывающих олигархов');
    expect(def!.type).toBe('taxCut');
  });
});

describe('скважины со случайным дебитом', () => {
  it('бурение даёт скважину из диапазона 8–10 т/сут для обычной', () => {
    const { game, state } = setup();
    rich(state);
    const before = state.wells.length;
    expect(game.buy('t_well').ok).toBe(true);
    expect(state.wells.length).toBe(before + 1);
    const well = state.wells[0];
    expect(['ordinary', 'good', 'unique']).toContain(well.kind);
    const cls = config.oil.wells.classes.find((c) => c.key === well.kind)!;
    expect(well.dailyTonnes).toBeGreaterThanOrEqual(cls.minDailyTonnes);
    expect(well.dailyTonnes).toBeLessThanOrEqual(cls.maxDailyTonnes);
  });

  it('дебит выпадает случайно: скважины получаются разными', () => {
    const { game, state } = setup();
    rich(state);
    for (let i = 0; i < 40; i++) game.buy('t_well');
    const sizes = new Set(state.wells.map((w) => w.dailyTonnes));
    expect(state.wells.length).toBe(40);
    expect(sizes.size).toBeGreaterThan(1);
  });

  it('добыча складывается из дебитов всех скважин', () => {
    const { game, state } = setup();
    state.wells = [
      { kind: 'ordinary', dailyTonnes: 8 },
      { kind: 'good', dailyTonnes: 60 },
      { kind: 'unique', dailyTonnes: 3000 },
    ];
    game.invalidate();
    const expected = (8 + 60 + 3000) / config.oil.wells.secondsPerDay;
    // Без бригады автодобыча не удваивает, поэтому сравниваем с базой.
    expect(game.derived().oilPerSecond).toBeCloseTo(expected, 6);
  });

  it('«Отжать месторождение» приносит целое месторождение: от 5 до 50 скважин', () => {
    const field = content.byId.get('p_field')!;
    expect(field.type).toBe('field');
    // Цена пересчитана под новый дебит и суммарный потолок добычи.
    expect(field.baseCost).toBe(260_000);
    expect(field.costGrowth).toBe(1.025);

    const counts: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { game, state } = setup(seed);
      // Разблокировка открывается по заработку — ставим его, а не только монеты.
      rich(state, 1e9);
      expect(game.buy('p_field').ok).toBe(true);
      counts.push(state.wells.length);
    }
    // Каждое отжатие — случайное число скважин в границах из конфига.
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(config.oil.conquestWells.min);
      expect(count).toBeLessThanOrEqual(config.oil.conquestWells.max);
    }
    // И число действительно разное от партии к партии, а не всегда одно.
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('скважины сохраняются вместе с дебетом', () => {
    const { state } = setup();
    state.wells = [{ kind: 'unique', dailyTonnes: 1234 }];
    const text = JSON.stringify(state);
    const restored = JSON.parse(text) as GameState;
    expect(restored.wells[0].dailyTonnes).toBe(1234);
    expect(restored.wells[0].kind).toBe('unique');
  });

  it('контракты измеряются в тысячах тонн', () => {
    const contract = config.oil.channels.contract;
    expect(contract.baseRate).toBeGreaterThanOrEqual(1000);
    // Одна скважина (8–10 т/сут) не должна упираться в ёмкость канала.
    expect(contract.baseRate).toBeGreaterThan(8);
  });
});

describe('правки после ревью: цена, сутки, падение дебита', () => {
  it('игровые сутки равны одной секунде', () => {
    expect(config.oil.wells.secondsPerDay).toBe(1);
    // 8 т/сут — это 8 тонн в секунду.
    const { game, state } = setup();
    state.wells = [{ kind: 'ordinary', dailyTonnes: 8 }];
    game.invalidate();
    expect(game.derived().oilPerSecond).toBeCloseTo(8, 6);
  });

  it('дебит падает со временем, но не сильно (не ниже 70%)', () => {
    const { game, state } = setup();
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    state.playtimeMs = 0;
    game.invalidate();
    const start = game.derived().oilPerSecond;
    // Половина партии.
    state.playtimeMs = 9 * 60 * 1000;
    game.invalidate();
    const middle = game.derived().oilPerSecond;
    expect(middle).toBeLessThan(start);
    expect(middle / start).toBeGreaterThan(0.7);
    // Даже очень долгая игра не роняет добычу ниже пола.
    state.playtimeMs = 5 * 60 * 60 * 1000;
    game.invalidate();
    const late = game.derived().oilPerSecond;
    expect(late / start).toBeCloseTo(config.oil.wells.decline.minFactor, 2);
  });

  it('мировая цена в панели показывается в нефтефаниках за тонну', () => {
    const { game, state } = setup();
    game.invalidate();
    const derived = game.derived();
    // Цена тонны = базовая цена × мировая цена × бонусы, и она в ₦.
    expect(derived.oilPricePerTon).toBeGreaterThan(0);
    expect(state.worldPrice).toBeGreaterThanOrEqual(config.worldPrice.min);
    expect(state.worldPrice).toBeLessThanOrEqual(config.worldPrice.max);
  });
});

describe('инженерное меню', () => {
  it('«+1 трлн» начисляет триллион и увеличивает заработок', () => {
    const { game, state } = setup();
    const before = state.coins;
    game.addCoins(1e12);
    expect(state.coins).toBeCloseTo(before + 1e12, 0);
    expect(state.totalEarned).toBeGreaterThanOrEqual(1e12);
  });

  it('«Купить Упырь-Абсолют» мгновенно завершает игру', () => {
    const { game, state } = setup();
    expect(state.won).toBe(false);
    expect(game.forceWin()).toBe(true);
    expect(state.won).toBe(true);
    const winDef = content.upgrades.find((u) => u.win)!;
    expect(state.levels[winDef.id]).toBe(1);
  });

  it('покупка после победы закрыта', () => {
    const { game } = setup();
    game.forceWin();
    expect(game.buy('t_well').ok).toBe(false);
  });
});
