import { describe, expect, it } from 'vitest';
import {
  allocateBatch,
  oilFlowsOf,
  affordableLevels,
  computeDerived,
  costFor,
  eventPayout,
  exportTonnes,
  isUnlocked,
  isWinReady,
  netForInterval,
  saleProceeds,
  sellOil,
  taxRateOf,
  totalCostFor,
  unlockBlocker,
  winCostOf,
} from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import { loadContent } from '../src/core/content';
import type { GameConfig, GameState, UpgradeDef } from '../src/core/types';

const content = loadContent();
const config = content.config;

function makeUpgrade(partial: Partial<UpgradeDef>): UpgradeDef {
  return {
    id: 'x',
    tab: 'technical',
    group: 'test',
    name: 'Тест',
    description: 'Тест',
    icon: 'well',
    type: 'passive',
    baseCost: 100,
    maxLevel: 10,
    effect: {},
    ...partial,
  };
}

function withUpgrades(levels: Record<string, number> = {}): GameState {
  const state = createInitialState(config, 1);
  state.levels = levels;
  return state;
}

describe('цены', () => {
  it('растут геометрически: baseCost · 1.15^level', () => {
    const def = makeUpgrade({ baseCost: 100 });
    expect(costFor(config, def, 0)).toBe(100);
    expect(costFor(config, def, 1)).toBe(115);
    expect(costFor(config, def, 2)).toBe(132);
    expect(costFor(config, def, 10)).toBe(Math.round(100 * Math.pow(1.15, 10)));
  });

  it('бесплатные покупки всегда стоят 0', () => {
    const def = makeUpgrade({ baseCost: 0, type: 'oneShot' });
    expect(costFor(config, def, 5)).toBe(0);
  });

  it('сумма уровней считается по каждому шагу', () => {
    const def = makeUpgrade({ baseCost: 100 });
    const expected = costFor(config, def, 2) + costFor(config, def, 3) + costFor(config, def, 4);
    expect(totalCostFor(config, def, 2, 3)).toBe(expected);
  });

  it('affordableLevels не превышает ни баланс, ни maxLevel, ни лимит за раз', () => {
    const def = makeUpgrade({ baseCost: 100, maxLevel: 100 });
    expect(affordableLevels(config, def, 0, 0)).toBe(0);
    expect(affordableLevels(config, def, 0, 100)).toBe(1);
    expect(affordableLevels(config, def, 0, 1000)).toBeGreaterThan(1);
    expect(affordableLevels(config, def, 0, Infinity)).toBe(config.maxBuyLevels);
    expect(affordableLevels(config, def, 100, Infinity)).toBe(0);
  });
});

describe('разблокировка покупок', () => {
  it('учитывает накопленный заработок', () => {
    const def = makeUpgrade({ unlockAt: { balance: 1000 } });
    const state = withUpgrades();
    state.totalEarned = 999;
    expect(isUnlocked(def, state)).toBe(false);
    expect(unlockBlocker(def, state)).toEqual({ kind: 'balance', value: 1000 });
    state.totalEarned = 1000;
    expect(isUnlocked(def, state)).toBe(true);
    expect(unlockBlocker(def, state)).toBeNull();
  });

  it('учитывает уровень другой покупки', () => {
    const locked = makeUpgrade({ id: 'b', unlockAt: { upgrade: 'a', level: 3 } });
    const state = withUpgrades({ a: 2 });
    expect(isUnlocked(locked, state)).toBe(false);
    expect(unlockBlocker(locked, state)).toEqual({ kind: 'upgrade', id: 'a', level: 3 });
    state.levels.a = 3;
    expect(isUnlocked(locked, state)).toBe(true);
  });
});

describe('производные показатели', () => {
  it('без покупок тап добывает базовые тонны, а денег ещё нет', () => {
    const d = computeDerived(config, content.upgrades, withUpgrades());
    // Тап добывает НЕФТЬ; базовое значение тапа — это tonnы из config.oil.
    expect(d.tapValue).toBeCloseTo(config.oil.tapTonnes, 6);
    // Контракты доступны с самого начала: сбыт есть, но нефти ещё нет,
    // поэтому «теоретический» доход без добычи нулевой.
    expect(d.oilPerSecond).toBe(0);
    expect(d.netPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('perTap складывается линейно и умножается на множители (с затуханием)', () => {
    const tap = makeUpgrade({ id: 'tap', type: 'perTap', effect: { value: 5 } });
    const mult = makeUpgrade({ id: 'mult', type: 'multiplier', effect: { factor: 2 } });
    const d = computeDerived(config, [tap, mult], withUpgrades({ tap: 3, mult: 2 }));
    // (oil.tapTonnes + 5*3) * 2^√2 — отдача множителей затухает,
    // иначе к концу игры цены и доходы «взрываются».
    expect(d.tapValue).toBeCloseTo((config.oil.tapTonnes + 15) * Math.pow(2, Math.SQRT2), 4);
  });

  it('скважины дают добычу, множитель пассива её усиливает', () => {
    const mult = makeUpgrade({ id: 'm', type: 'multiplier', effect: { factor: 1.5, scope: 'passive' } });
    const state = withUpgrades({ m: 2 });
    // Две скважины: обычная на 10 т/сут и хорошая на 60 т/сут.
    state.wells = [
      { kind: 'ordinary', dailyTonnes: 10 },
      { kind: 'good', dailyTonnes: 60 },
    ];
    const d = computeDerived(config, [mult], state);
    // 70 т/сут / секунд в сутках, дальше — множители пассива.
    const base = 70 / config.oil.wells.secondsPerDay;
    expect(d.oilPerSecond).toBeCloseTo(base * Math.pow(1.5, Math.SQRT2), 6);
  });

  it('множитель с scope=tap не влияет на добычу скважин', () => {
    const mult = makeUpgrade({ id: 'm', type: 'multiplier', effect: { factor: 3, scope: 'tap' } });
    const state = withUpgrades({ m: 1 });
    state.wells = [{ kind: 'ordinary', dailyTonnes: 10 }];
    const d = computeDerived(config, [mult], state);
    expect(d.oilPerSecond).toBeCloseTo(10 / config.oil.wells.secondsPerDay, 6);
    expect(d.tapValue).toBeCloseTo(config.oil.tapTonnes * 3, 4);
  });

  it('налог снижается влиянием и не опускается ниже минимума', () => {
    // Без влияния — базовая ставка.
    expect(taxRateOf(config, 0)).toBeCloseTo(config.tax.baseRate, 6);
    // С ростом влияния ставка только падает.
    const low = taxRateOf(config, 100);
    const high = taxRateOf(config, 300);
    expect(low).toBeLessThan(config.tax.baseRate);
    expect(high).toBeLessThan(low);
    // Даже при огромном влиянии ниже минимума не уходит.
    expect(taxRateOf(config, 10000)).toBeCloseTo(config.tax.minRate, 6);
  });

  it('дружба с чиновниками снижает налог, но не отменяет его совсем', () => {
    const cut = makeUpgrade({ id: 'cut', type: 'taxCut', effect: { percent: 3 } });
    const state = withUpgrades({ cut: 2 });
    const d = computeDerived(config, [cut], state);
    // 2 уровня × 3 п.п. = 6 п.п. ниже базовой ставки.
    expect(d.taxRate).toBeCloseTo(config.tax.baseRate - 0.06, 6);
    expect(d.taxRate).toBeGreaterThanOrEqual(config.tax.minRate);
  });

  it('цена победы берётся из winCost конфига', () => {
    expect(winCostOf(config, content.upgrades)).toBe(config.winCost);
  });

  it('чистый доход не уходит в минус даже при огромных расходах', () => {
    const bad = makeUpgrade({ id: 'bad', type: 'passive', effect: { value: 1, salaryAdd: 500 } });
    const d = computeDerived(config, [bad], withUpgrades({ bad: 10 }));
    expect(d.netPerSecond).toBeGreaterThanOrEqual(0);
    expect(netForInterval(d, 1)).toBeGreaterThanOrEqual(0);
  });

  it('налог не «прыгает»: временные буффы больше не меняют ставку', () => {
    const plain = computeDerived(config, [], withUpgrades());
    const buffed = computeDerived(config, [], withUpgrades(), [
      { id: 'buff', amount: 0.2, untilMs: 5000 },
    ]);
    // Ставка зависит только от влияния и чиновников, поэтому совпадает.
    expect(buffed.taxRate).toBeCloseTo(plain.taxRate, 9);
  });

  it('роскошь попадает в витрину и не даёт дохода', () => {
    const yacht = makeUpgrade({ id: 'y', type: 'luxury', effect: {} });
    const d = computeDerived(config, [yacht], withUpgrades({ y: 1 }));
    expect(d.luxuries).toContain('y');
    expect(d.tapValue).toBeCloseTo(config.oil.tapTonnes, 6);
  });
});

describe('условия победы', () => {
  it('требует денег и ключевых улучшений', () => {
    const state = withUpgrades();
    state.coins = config.winCost;
    const requirements = config.winRequirements;
    if (requirements.length === 0) {
      // Требований нет — достаточно денег.
      expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(true);
    } else {
      expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(false);
      for (const req of requirements) {
        if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
      }
      expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(true);
    }
    state.coins = config.winCost - 1;
    expect(isWinReady(config, content.upgrades, state, state.coins)).toBe(false);
  });
});

describe('выплаты событий', () => {
  const derived = computeDerived(
    config,
    content.upgrades,
    withUpgrades({ t_well: 10 }),
  );

  it('растут вместе с империей', () => {
    const def = content.byId.get('p_monarch') as UpgradeDef;
    const small = eventPayout(def, { ...derived, grossPerSecond: 1, oilPerSecond: 0 }, 1, 0);
    const big = eventPayout(def, { ...derived, grossPerSecond: 1000, oilPerSecond: 0 }, 1, 0);
    expect(big).toBeGreaterThan(small);
  });

  it('платный розыгрыш возвращает множитель от цены', () => {
    const def = content.byId.get('p_crisis') as UpgradeDef;
    const payout = eventPayout(def, derived, 1, 1000);
    expect(payout).toBe(1000 * (def.effect.factor ?? 1));
  });

  it('экспорт продаёт нефть со склада по цене канала', () => {
    const def = content.byId.get('p_export') as UpgradeDef;
    const cheap = { ...derived, channels: { ...derived.channels, export: { ...derived.channels.export, price: 10 } } };
    const dear = { ...derived, channels: { ...derived.channels, export: { ...derived.channels.export, price: 20 } } };
    const tonnes = 100;
    expect(saleProceeds(def, dear, tonnes)).toBeGreaterThan(saleProceeds(def, cheap, tonnes));
    // Разовая акция не может продать больше, чем лежит в резервуарах.
    expect(exportTonnes(config, derived, 5)).toBeLessThanOrEqual(5);
  });

  it('каналы делят нефть по приоритету «дорогой сначала»', () => {
    const custom = {
      ...derived,
      channels: {
        contract: { rate: 1, price: 1, sold: 1 },
        export: { rate: 1, price: 10, sold: 1 },
        refine: { rate: 1, price: 100, sold: 1 },
      },
    };
    const sold = sellOil(custom, 3, 10, []);
    // Вся нефть ушла через самый дорогой канал.
    expect(sold.byChannel.refine).toBeCloseTo(3, 6);
    expect(sold.gross).toBeCloseTo(300, 6);
    expect(sold.oil).toBeCloseTo(0, 6);
  });

  it('безлимитные контракты продают всё, что осталось', () => {
    const custom = {
      ...derived,
      channels: {
        contract: { rate: 0, price: 1, sold: 0 },
        export: { rate: 0, price: 10, sold: 0 },
        refine: { rate: 0, price: 100, sold: 0 },
      },
    };
    const sold = sellOil(custom, 50, 1, ['contract']);
    expect(sold.oil).toBeCloseTo(0, 6);
    expect(sold.byChannel.contract).toBeCloseTo(50, 6);
  });
});

describe('устойчивость формул', () => {
  it('не выдают NaN при пустом конфиге эффектов', () => {
    const weird: GameConfig = { ...config };
    const defs: UpgradeDef[] = [
      makeUpgrade({ id: 'a', type: 'multiplier', effect: {} }),
      makeUpgrade({ id: 'b', type: 'passive', effect: {} }),
    ];
    const d = computeDerived(weird, defs, withUpgrades({ a: 1, b: 1 }));
    expect(Number.isFinite(d.tapValue)).toBe(true);
    expect(Number.isFinite(d.netPerSecond)).toBe(true);
    expect(Number.isFinite(d.taxRate)).toBe(true);
  });
});

describe('регрессии экономики: выручка по фактической продаже', () => {
  it('безлимитные контракты входят в доход в секунду', () => {
    const state = createInitialState(config, 41);
    state.wells = [{ kind: 'ordinary', dailyTonnes: 9 }];
    const d = computeDerived(config, content.upgrades, state, [], content);
    // Вся добыча уходит в контракты: доход не может быть нулевым.
    expect(d.oilPerSecond).toBeGreaterThan(0);
    expect(d.grossPerSecond).toBeGreaterThan(d.oilPerSecond * d.domesticPricePerTon * 0.9);
    expect(d.netPerSecond).toBeGreaterThan(0);
  });

  it('чистая прибыль = EBT − налог на прибыль, как показано в панели', () => {
    const state = createInitialState(config, 42);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    state.levels = { t_azs: 20, s_brigade: 1, s_engineer: 1 };
    const d = computeDerived(config, content.upgrades, state, [], content);
    // Расходы в панели — итог по статьям: зарплаты + чиновники.
    expect(d.expensesPerSecond).toBeCloseTo(d.salaries + d.officials, 6);
    // EBT — прибыль до налога; налог берётся именно с неё.
    expect(d.ebtPerSecond).toBeCloseTo(d.grossPerSecond - d.expensesPerSecond, 6);
    expect(d.taxPaidPerSecond).toBeCloseTo(d.ebtPerSecond * d.taxRate, 6);
    expect(d.netPerSecond).toBeCloseTo(d.ebtPerSecond - d.taxPaidPerSecond, 6);
  });

  it('раскладка сбыта по каналам совпадает с суммой продаж', () => {
    const state = createInitialState(config, 43);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    const d = computeDerived(config, content.upgrades, state, [], content);
    const sum = d.salesByChannel.contract + d.salesByChannel.export + d.salesByChannel.refine;
    expect(sum).toBeCloseTo(d.sellPerSecond, 6);
    expect(d.sellPerSecond).toBeGreaterThan(0);
    // Дорогие каналы забирают первыми, остаток уходит в контракты.
    expect(d.salesByChannel.refine).toBeLessThanOrEqual(d.channels.refine.rate + 1e-9);
    expect(d.salesByChannel.export).toBeLessThanOrEqual(d.channels.export.rate + 1e-9);
  });
});

describe('товарная модель: сырая нефть → нефтепродукты', () => {
  /*
   * При равных ценах порядок задают цены каналов из конфига: переработка
   * (priceFactor 2.6) дороже экспорта (1.0), а внутренний рынок (0.35) —
   * самый дешёвый. То есть даже при «равных» переданных ценах нефть сначала
   * идёт в НПЗ, потом на экспорт, и только остаток — на внутренний рынок.
   */
  const capacities = {
    domestic: { crude: 100, products: 100 },
    export: { crude: 80, products: 100 },
    refine: 50,
  };
  const equalPrices = {
    crudeDomestic: 1,
    crudeExport: 1,
    productDomestic: 1,
    productExport: 1,
  };

  it('потоки сходятся: добыча = внутренний + экспорт + переработка', () => {
    const flows = oilFlowsOf(config, capacities, 300, { prices: equalPrices });
    expect(flows.domestic + flows.export + flows.refined + flows.backlog).toBeCloseTo(300, 6);
    // Мощности не превышены ни на тонну.
    expect(flows.domestic).toBeLessThanOrEqual(capacities.domestic.crude);
    expect(flows.export).toBeLessThanOrEqual(capacities.export.crude);
    expect(flows.refined).toBeLessThanOrEqual(capacities.refine);
  });

  it('переработка даёт нефтепродукты с учётом выхода', () => {
    const flows = oilFlowsOf(config, capacities, 300, { prices: equalPrices });
    expect(flows.productsProduced).toBeCloseTo(flows.refined * config.oil.refineryYield, 6);
    expect(flows.productsDomestic + flows.productsExport).toBeLessThanOrEqual(
      flows.productsProduced + 1e-9,
    );
  });

  it('мощности сбыта растут от построенных объектов', () => {
    const state = createInitialState(config, 61);
    // Добыча заведомо больше внутреннего рынка — иначе экспорту нечего брать.
    state.wells = [{ kind: 'unique', dailyTonnes: 50000 }];
    const before = computeDerived(config, content.upgrades, state, [], content);
    expect(before.flows.export).toBe(0); // без труб везти нечем
    state.levels = { t_azs: 3, t_pipeline: 2 };
    const after = computeDerived(config, content.upgrades, state, [], content);
    // АЗС расширяют внутренний рынок, трубы — экспорт.
    expect(after.capacities.domestic.crude).toBeGreaterThan(before.capacities.domestic.crude);
    expect(after.capacities.export.crude).toBeGreaterThan(before.capacities.export.crude);
    // Экспорт забирает всё, что не взял внутренний рынок (раньше его не было).
    expect(after.capacities.export.crude).toBeGreaterThan(before.capacities.export.crude);
    expect(after.flows.export).toBeGreaterThan(before.flows.export);
  });

  it('партия раскладывается по мощностям без потерь', () => {
    const plan = allocateBatch(config, capacities, 500, 1, equalPrices);
    expect(plan.domestic + plan.export + plan.refined + plan.rest).toBeCloseTo(500, 6);
    expect(plan.rest).toBeGreaterThan(0); // мощностей не хватило — осталось в резервуарах
    // Малая партия уходит в самый дорогой канал — переработку.
    const small = allocateBatch(config, capacities, 50, 1, equalPrices);
    expect(small.rest).toBe(0);
    expect(small.refined).toBeCloseTo(50, 6);
    expect(small.export).toBe(0);
    expect(small.domestic).toBe(0);
    // Когда НПЗ загружен, дальше идёт экспорт, а остаток — внутренний рынок.
    const rest = allocateBatch(config, capacities, 200, 1, equalPrices);
    expect(rest.refined).toBeCloseTo(50, 6);
    expect(rest.export).toBeCloseTo(80, 6);
    expect(rest.domestic).toBeCloseTo(70, 6);
  });

  it('экспорт забирает нефть первым и делится по видам транспорта', () => {
    // Заказчик купил экспортные карточки, а в панели стояло «0 т/с»:
    // безлимитный внутренний рынок съедал всю добычу раньше экспорта.
    const state = createInitialState(config, 64);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    state.levels = { t_pipeline: 2, x_cistern: 2, x_tanker: 2 };
    const d = computeDerived(config, content.upgrades, state, [], content);

    expect(d.capacities.export.crude).toBeGreaterThan(0);
    // Вся добыча уходит в экспорт: он дороже, а внутренний рынок — остаток.
    expect(d.flows.export).toBeCloseTo(d.flows.produced, 6);
    expect(d.flows.domestic).toBe(0);
    // Разбивка по транспорту сходится с общим экспортом.
    const byMode = d.flows.exportByMode;
    expect(byMode.pipeline + byMode.rail + byMode.tanker).toBeCloseTo(d.flows.export, 6);
    expect(byMode.pipeline).toBeGreaterThan(0); // труба есть
    expect(byMode.rail).toBeGreaterThan(0); // цистерны есть
    expect(byMode.tanker).toBeGreaterThan(0); // танкеры есть
    expect(d.hasPipeline).toBe(true);
  });

  it('без трубопровода нефть копится в резервуарах, с трубой — сразу продаётся', () => {
    const state = createInitialState(config, 65);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    // Экспорт есть (цистерны), но трубы нет: партия ждёт отправки.
    state.levels = { x_cistern: 2 };
    const noPipe = computeDerived(config, content.upgrades, state, [], content);
    expect(noPipe.hasPipeline).toBe(false);
    expect(noPipe.exportCapacityByMode.pipeline).toBe(0);

    state.levels['t_pipeline'] = 1;
    const withPipe = computeDerived(config, content.upgrades, state, [], content);
    expect(withPipe.hasPipeline).toBe(true);
    expect(withPipe.exportCapacityByMode.pipeline).toBeGreaterThan(0);
  });

  it('нефтебаза хранит нефтепродукты, а не сырую нефть', () => {
    const state = createInitialState(config, 66);
    state.levels = { t_tank: 2 };
    const before = computeDerived(config, content.upgrades, state, [], content);
    state.levels['t_depot'] = 3;
    const after = computeDerived(config, content.upgrades, state, [], content);
    // Ёмкость под сырую нефть не изменилась...
    expect(after.oilCapacity).toBe(before.oilCapacity);
    // ...а ёмкость нефтебаз под продукты выросла.
    expect(after.productCapacity).toBeGreaterThan(before.productCapacity);
    expect(after.flows.productCapacity).toBe(after.productCapacity);
  });

  it('поставки сами идут на более выгодный рынок', () => {
    // Заказчик: «поставки автоматически перераспределяются на более выгодные
    // рынки». Раньше порядок был зашит (экспорт → переработка → внутренний),
    // и при падении экспортных цен игрок молча терял деньги.
    const caps = {
      domestic: { crude: 60, products: 60 },
      export: { crude: 60, products: 60 },
      refine: 40,
    };
    const expensiveExport = oilFlowsOf(config, caps, 100, {
      prices: { crudeDomestic: 1, crudeExport: 2, productDomestic: 1, productExport: 3 },
    });
    expect(expensiveExport.export).toBeGreaterThan(expensiveExport.domestic);
    expect(expensiveExport.productsExport).toBeGreaterThan(expensiveExport.productsDomestic);

    const expensiveDomestic = oilFlowsOf(config, caps, 100, {
      prices: { crudeDomestic: 5, crudeExport: 1, productDomestic: 5, productExport: 1 },
    });
    expect(expensiveDomestic.domestic).toBeGreaterThan(expensiveDomestic.export);
    expect(expensiveDomestic.productsDomestic).toBeGreaterThan(expensiveDomestic.productsExport);

    // Ни при каком раскладе товар не теряется.
    expect(
      expensiveDomestic.domestic + expensiveDomestic.export + expensiveDomestic.refined +
        expensiveDomestic.stored,
    ).toBeCloseTo(100, 6);
  });

  it('у рынков свои доступные объёмы для сырья и нефтепродуктов', () => {
    const state = createInitialState(config, 67);
    const base = computeDerived(config, content.upgrades, state, [], content);
    // Стартовые контракты открыты для обоих товаров, но доли разные:
    // нефть забирает 60% полки, продукты — 100% (доли transportSplit).
    expect(base.capacities.domestic.crude).toBeGreaterThan(0);
    expect(base.capacities.domestic.products).toBeGreaterThan(0);
    expect(base.capacities.export.crude).toBe(0);

    // Трест расширяет только рынок сырья...
    state.levels = { c_local: 2 };
    const crudeOnly = computeDerived(config, content.upgrades, state, [], content);
    // Рынок продуктов не вырос ни на тонну — расширился только рынок сырья.
    expect(crudeOnly.capacities.domestic.products).toBeCloseTo(base.capacities.domestic.products, 6);
    expect(crudeOnly.capacities.domestic.crude).toBeGreaterThan(base.capacities.domestic.crude);

    // ...АЗС — оба рынка...
    state.levels = { t_azs: 2 };
    const both = computeDerived(config, content.upgrades, state, [], content);
    expect(both.capacities.domestic.products).toBeGreaterThan(0);

    // ...а трубопровод расширяет только экспорт сырья: рынок продуктов
    // остаётся ровно на базовой доле канала, ни на тонну больше.
    state.levels = { c_local: 0, t_azs: 0, t_pipeline: 2 };
    const pipe = computeDerived(config, content.upgrades, state, [], content);
    expect(pipe.capacities.export.crude).toBeGreaterThan(base.capacities.export.crude);
    expect(pipe.capacities.export.products).toBeCloseTo(base.capacities.export.products, 6);

    // Терминал под нефтепродукты расширяет именно экспорт продуктов.
    state.levels = { t_productport: 1 };
    const port = computeDerived(config, content.upgrades, state, [], content);
    expect(port.capacities.export.products).toBeGreaterThan(0);
  });

  it('цена канала в панели — та же, что в расчёте денег', () => {
    // Заказчик поймал расхождение: «внутренняя цена ₦1,37/т», а в строке
    // сбыта — «× ₦4,13/т». Надбавки сбытовых построек входили в цену продажи,
    // но не в подпись. Теперь подписанная цена и цена расчёта — одно число.
    const state = createInitialState(config, 63);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    state.levels = { c_local: 5, c_broker: 4, c_bourse: 3 };
    const d = computeDerived(config, content.upgrades, state, [], content);
    expect(d.domesticPricePerTon).toBeCloseTo(d.channels.contract.price, 9);
    expect(d.exportPricePerTon).toBeCloseTo(d.channels.export.price, 9);
    // Выручка в секунду собирается из ровно этих цен и потоков.
    expect(d.grossPerSecond).toBeCloseTo(
      d.flows.domestic * d.domesticPricePerTon +
        d.flows.export * d.exportPricePerTon +
        d.flows.productsDomestic * d.productPriceDomestic +
        d.flows.productsExport * d.productPriceExport,
      6,
    );
    // Надбавки сбыта действительно поднимают цену над стартовой.
    const basePrice = config.oil.basePricePerTon * config.oil.channels.contract.priceFactor;
    expect(d.domesticPricePerTon).toBeGreaterThan(basePrice * 1.05);
  });

  it('мировая цена двигается во времени и тянет за собой внутреннюю', () => {
    const state = createInitialState(config, 62);
    const low = computeDerived(config, content.upgrades, state, [], content);
    state.worldPrice = config.worldPrice.max;
    const high = computeDerived(config, content.upgrades, state, [], content);
    expect(high.oilPricePerTon).toBeGreaterThan(low.oilPricePerTon);
    expect(high.domesticPricePerTon).toBeGreaterThan(low.domesticPricePerTon);
  });
});
