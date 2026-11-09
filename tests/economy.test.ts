import { describe, expect, it } from 'vitest';
import {
  adjustCurrencyCost,
  allocateBatch,
  assetValueBreakdownOf,
  bankScaleOf,
  reprivatizationPrize,
  fineFactorOf,
  fineFor,
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
  worldPriceAt,
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
  it('без скважин и производственных улучшений добычи нет', () => {
    const d = computeDerived(config, content.upgrades, withUpgrades());
    expect(d.oilPerSecond).toBe(0);
    expect(d.netPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('производственные улучшения складываются и усиливаются общим множителем', () => {
    const production = makeUpgrade({ id: 'production', type: 'production', effect: { value: 5 } });
    const mult = makeUpgrade({ id: 'mult', type: 'multiplier', effect: { factor: 2 } });
    const state = withUpgrades({ production: 3, mult: 2 });
    state.wells = [{ kind: 'ordinary', dailyTonnes: 10 }];
    const d = computeDerived(config, [production, mult], state);
    const base = 10 / config.oil.wells.secondsPerDay;
    expect(d.oilPerSecond).toBeCloseTo((base + 15) * Math.pow(2, Math.SQRT2), 4);
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

  it('множитель production усиливает добычу скважин', () => {
    const production = makeUpgrade({ id: 'production', type: 'production', effect: { value: 5 } });
    const mult = makeUpgrade({ id: 'm', type: 'multiplier', effect: { factor: 3, scope: 'production' } });
    const state = withUpgrades({ production: 1, m: 1 });
    state.wells = [{ kind: 'ordinary', dailyTonnes: 10 }];
    const d = computeDerived(config, [production, mult], state);
    expect(d.oilPerSecond).toBeCloseTo(
      10 / config.oil.wells.secondsPerDay + 5 * 3,
      6,
    );
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

  it('максимальное влияние действительно приводит к минимальной ставке налога', () => {
    expect(taxRateOf(config, config.influence.cap)).toBeCloseTo(config.tax.minRate, 9);
  });

  it('принадлежность к группе не начисляет влияние без явного эффекта', () => {
    const media = makeUpgrade({ id: 'media', tab: 'political', group: 'media', type: 'priceBoost', effect: { factor: 1 } });
    const derived = computeDerived(config, [media], withUpgrades({ media: 1 }));
    expect(derived.influence).toBe(0);
  });

  it('влияние продолжает расти выше базового ориентира 400', () => {
    const influence = makeUpgrade({
      id: 'influence-stack',
      effect: { influence: config.influence.cap + 750 },
    });
    const derived = computeDerived(config, [influence], withUpgrades({ 'influence-stack': 1 }));
    expect(derived.influence).toBe(config.influence.cap + 750);
  });

  it('монопольный сговор повышает только внутренние цены один раз', () => {
    const cartel = makeUpgrade({ id: 'domestic-cartel', type: 'priceBoost', effect: { domesticPriceMultiplier: 1.12 } });
    const state = withUpgrades();
    const before = computeDerived(config, [], state);
    state.levels[cartel.id] = 1;
    const after = computeDerived(config, [cartel], state);
    expect(after.domesticPricePerTon).toBeCloseTo(before.domesticPricePerTon * 1.12, 8);
    expect(after.productPriceDomestic).toBeCloseTo(before.productPriceDomestic * 1.12, 8);
    expect(after.exportPricePerTon).toBeCloseTo(before.exportPricePerTon, 8);
    expect(after.productPriceExport).toBeCloseTo(before.productPriceExport, 8);
  });

  it('международный картель повышает только экспортные цены один раз', () => {
    const cartel = makeUpgrade({ id: 'export-cartel', type: 'priceBoost', effect: { exportPriceMultiplier: 1.18 } });
    const state = withUpgrades();
    const before = computeDerived(config, [], state);
    state.levels[cartel.id] = 1;
    const after = computeDerived(config, [cartel], state);
    expect(after.exportPricePerTon).toBeCloseTo(before.exportPricePerTon * 1.18, 8);
    expect(after.productPriceExport).toBeCloseTo(before.productPriceExport * 1.18, 8);
    expect(after.domesticPricePerTon).toBeCloseTo(before.domesticPricePerTon, 8);
    expect(after.productPriceDomestic).toBeCloseTo(before.productPriceDomestic, 8);
  });

  it('девальвация повышает экспортную выручку, но не внутренние цены', () => {
    const devalue = makeUpgrade({ id: 'devalue', type: 'priceBoost', effect: { exchangeRateDevaluation: 0.05 } });
    const state = withUpgrades();
    const before = computeDerived(config, [], state);
    state.levels[devalue.id] = 2;
    const after = computeDerived(config, [devalue], state);
    expect(after.exchangeRate).toBeCloseTo(config.exchangeRate.initial * 1.05 ** 2, 10);
    expect(after.exportPricePerTon).toBeCloseTo(before.exportPricePerTon * 1.05 ** 2, 8);
    expect(after.productPriceExport).toBeCloseTo(before.productPriceExport * 1.05 ** 2, 8);
    expect(after.domesticPricePerTon).toBeCloseTo(before.domesticPricePerTon, 8);
    expect(after.productPriceDomestic).toBeCloseTo(before.productPriceDomestic, 8);
  });

  it('волна мировой цены начинается с заданной цены и остаётся в границах', () => {
    const settings = config.worldPrice;
    expect(worldPriceAt(settings, 1234, 0)).toBeCloseTo(settings.startPrice, 12);
    for (let seconds = 0; seconds <= 120; seconds += 3) {
      const value = worldPriceAt(settings, 1234, seconds * 1000);
      expect(value).toBeGreaterThanOrEqual(settings.min);
      expect(value).toBeLessThanOrEqual(settings.max);
    }
  });

  it('распределяет малую экспортную мощность между всеми видами транспорта', () => {
    const flows = oilFlowsOf(config, {
      domestic: { crude: 0, products: 0 },
      export: { crude: 1, products: 0 },
      refine: 0,
    }, 0.5, {
      modeShares: { pipeline: 0.2, rail: 0.3, tanker: 0.5 },
      productStorage: 0,
    });
    expect(flows.exportByMode.pipeline).toBeCloseTo(0.1, 9);
    expect(flows.exportByMode.rail).toBeCloseTo(0.15, 9);
    expect(flows.exportByMode.tanker).toBeCloseTo(0.25, 9);
  });

  it('цена победы проходит через общую кривую валюты', () => {
    expect(winCostOf(config, content.upgrades)).toBe(adjustCurrencyCost(config, config.winCost));
  });

  it('общая кривая сохраняет ранние цены и сжимает поздние цены', () => {
    const early = makeUpgrade({ id: 'early', baseCost: 50_000 });
    const late = makeUpgrade({ id: 'late', baseCost: 1_000_000_000_000 });
    expect(costFor(config, early, 0)).toBe(50_000);
    expect(costFor(config, late, 0)).toBe(adjustCurrencyCost(config, late.baseCost));
    expect(costFor(config, late, 0)).toBeLessThan(late.baseCost);
  });

  it('девальвация индексирует только строительные активы', () => {
    const factory = makeUpgrade({ id: 'factory', type: 'sell', assetKind: 'refinery', baseCost: 100_000 });
    const well = makeUpgrade({ id: 'well', type: 'well', baseCost: 100_000 });
    const political = makeUpgrade({ id: 'bribe', type: 'oneShot', baseCost: 100_000 });
    expect(costFor(config, factory, 0, 2)).toBeGreaterThan(costFor(config, factory, 0, 1));
    expect(costFor(config, well, 0, 2)).toBeGreaterThan(costFor(config, well, 0, 1));
    expect(costFor(config, political, 0, 2)).toBe(costFor(config, political, 0, 1));
  });

  it('денежные требования открытия используют ту же кривую', () => {
    const threshold = adjustCurrencyCost(config, 1_000_000_000_000);
    const def = makeUpgrade({ id: 'unlock-test', unlockAt: { balance: 1_000_000_000_000 } });
    const state = createInitialState(config, 74);
    state.totalEarned = threshold - 1;
    expect(unlockBlocker(def, state, 0, config)).toEqual({ kind: 'balance', value: threshold });
    state.totalEarned = threshold;
    expect(unlockBlocker(def, state, 0, config)).toBeNull();
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
    expect(d.oilPerSecond).toBe(0);
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
    state.coins = winCostOf(config, content.upgrades) - 1;
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
    expect(Number.isFinite(d.oilPerSecond)).toBe(true);
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

describe('штраф за разлив', () => {
  it('считается по тоннам и виду товара', () => {
    const crude = fineFor(config, 'crude', 1000, 0);
    const products = fineFor(config, 'products', 1000, 0);
    expect(crude).toBeCloseTo(1000 * config.fines.oilPerTon, 6);
    expect(products).toBeCloseTo(1000 * config.fines.productPerTon, 6);
    // Нефтепродукты дороже — и разлив дороже.
    expect(products).toBeGreaterThan(crude);
    // Ничего не разлилось — нечего и штрафовать.
    expect(fineFor(config, 'crude', 0, 0)).toBe(0);
  });

  it('влияние снижает штраф, но не до нуля', () => {
    const none = fineFactorOf(config, 0);
    const some = fineFactorOf(config, 50);
    const lots = fineFactorOf(config, 400);
    expect(none).toBe(1);
    expect(some).toBeLessThan(none);
    expect(lots).toBeLessThan(some);
    // Потолок скидки: даже при влиянии выше cap платим minFactor.
    expect(lots).toBeGreaterThan(0);
    expect(lots).toBeCloseTo(0.001, 9);
    expect(fineFactorOf(config, 100000)).toBeCloseTo(0.001, 9);
  });

  it('норматив штрафа входит в расходы и виден в EBT', () => {
    const state = createInitialState(config, 71);
    state.levels = { t_well: 20, c_local: 5 };
    state.wells = [{ kind: 'unique', dailyTonnes: 4000 }];
    state.spillCrudePerSecond = 500;
    const d = computeDerived(config, content.upgrades, state, [], content);
    expect(d.finePerSecond).toBeGreaterThan(0);
    // Расходы = зарплаты + чиновники + штраф: таблица сходится построчно.
    expect(d.expensesPerSecond).toBeCloseTo(d.salaries + d.officials + d.finePerSecond, 6);
    // Штраф уменьшает EBT.
    const clean = computeDerived(
      config, content.upgrades, { ...state, spillCrudePerSecond: 0 }, [], content,
    );
    expect(d.ebtPerSecond).toBeLessThan(clean.ebtPerSecond);
  });

  it('влияние империи реально смягчает норматив', () => {
    const state = createInitialState(config, 72);
    state.spillProductsPerSecond = 800;
    const poor = computeDerived(config, content.upgrades, state, [], content);
    const rich = computeDerived(
      config,
      content.upgrades,
      { ...state, levels: { pmc_vet: 10, pmc_chvk: 10, pmc_airbase: 10, pmc_army: 5 } },
      [],
      content,
    );
    expect(rich.influence).toBeGreaterThan(poor.influence);
    expect(rich.finePerSecond).toBeLessThan(poor.finePerSecond);
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
  const limitedConfig: GameConfig = {
    ...config,
    oil: {
      ...config.oil,
      channels: {
        ...config.oil.channels,
        contract: { ...config.oil.channels.contract, unlimited: false },
      },
    },
  };

  it('потоки сходятся: добыча = внутренний + экспорт + переработка', () => {
    const flows = oilFlowsOf(limitedConfig, capacities, 300, { prices: equalPrices });
    expect(flows.domestic + flows.export + flows.refined + flows.backlog).toBeCloseTo(300, 6);
    // Мощности не превышены ни на тонну.
    expect(flows.domestic).toBeLessThanOrEqual(capacities.domestic.crude);
    expect(flows.export).toBeLessThanOrEqual(capacities.export.crude);
    expect(flows.refined).toBeLessThanOrEqual(capacities.refine);
  });

  it('переработка даёт нефтепродукты с учётом выхода', () => {
    const flows = oilFlowsOf(limitedConfig, capacities, 300, { prices: equalPrices });
    expect(flows.productsProduced).toBeCloseTo(flows.refined * config.oil.refineryYield, 6);
    expect(flows.productsDomestic + flows.productsExport).toBeLessThanOrEqual(
      flows.productsProduced + 1e-9,
    );
  });

  it('влияние даётся только покупками с явным effect.influence', () => {
    const state = createInitialState(config, 62);
    state.levels = { p_optimize: 8, pmc_chvk: 1 };
    const derived = computeDerived(config, content.upgrades, state, [], content);
    expect(derived.influence).toBeCloseTo(12, 9);
  });

  it('ожидаемая выплата гэмблов не превышает их стоимость', () => {
    for (const id of ['p_crisis', 'p_fuelcrisis']) {
      const effect = content.byId.get(id)!.effect;
      expect((effect.chance ?? 0.5) * (effect.factor ?? 1)).toBeLessThan(1);
    }
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
    // Сами контракты безлимитны, а численная мощность продолжает расти.
    expect(after.channels.contract.rate).toBeGreaterThan(before.channels.contract.rate);
    expect(after.capacities.export.crude).toBeGreaterThan(before.capacities.export.crude);
    // Экспорт забирает всё, что не взял внутренний рынок (раньше его не было).
    expect(after.capacities.export.crude).toBeGreaterThan(before.capacities.export.crude);
    expect(after.flows.export).toBeGreaterThan(before.flows.export);
  });

  it('партия раскладывается по мощностям без потерь', () => {
    const plan = allocateBatch(limitedConfig, capacities, 500, 1, equalPrices);
    expect(plan.domestic + plan.export + plan.refined + plan.rest).toBeCloseTo(500, 6);
    expect(plan.rest).toBeGreaterThan(0); // мощностей не хватило — осталось в резервуарах
    // Малая партия уходит в самый дорогой канал — переработку.
    const small = allocateBatch(limitedConfig, capacities, 50, 1, equalPrices);
    expect(small.rest).toBe(0);
    expect(small.refined).toBeCloseTo(50, 6);
    expect(small.export).toBe(0);
    expect(small.domestic).toBe(0);
    // Когда НПЗ загружен, дальше идёт экспорт, а остаток — внутренний рынок.
    const rest = allocateBatch(limitedConfig, capacities, 200, 1, equalPrices);
    expect(rest.refined).toBeCloseTo(50, 6);
    expect(rest.export).toBeCloseTo(80, 6);
    expect(rest.domestic).toBeCloseTo(70, 6);
  });

  it('запас нефтепродуктов использует рыночную мощность до свежего выхода НПЗ', () => {
    const caps = {
      domestic: { crude: 100, products: 10 },
      export: { crude: 0, products: 10 },
      refine: 1000,
    };
    const withoutStock = oilFlowsOf(limitedConfig, caps, 1000, {
      prices: equalPrices,
      productStorage: 0,
      productStorageFree: 0,
      storageHorizonSeconds: 5,
    });
    const withStock = oilFlowsOf(limitedConfig, caps, 1000, {
      prices: equalPrices,
      productStorage: 0,
      productStorageFree: 0,
      productInventory: 100,
      storageHorizonSeconds: 5,
    });
    expect(withoutStock.refined).toBeGreaterThan(0);
    expect(withStock.refined).toBe(0);
    expect(withStock.domestic).toBeGreaterThan(0);
  });

  it('не обнуляет выпуск НПЗ из-за запаса в конце окна отгрузки', () => {
    const localContent = structuredClone(content);
    const state = createInitialState(localContent.config, 68);
    state.levels = { t_refinery: 1, t_depot: 1 };
    state.wells = [{ kind: 'good', dailyTonnes: 1000 }];
    state.products = 25_000;
    // До отправки осталось 1 с, но пакетная отгрузка использует
    // мощности за всё пятисекундное окно: 25 000 т запаса не занимают
    // рынок целиком (9000 × 5 = 45 000 т).
    state.shipTimerMs = 4_000;

    const derived = computeDerived(
      localContent.config,
      localContent.upgrades,
      state,
      [],
      localContent,
    );

    expect(derived.productCapacity).toBe(25_000);
    expect(derived.flows.refined).toBeGreaterThan(0);
    expect(derived.flows.productsProduced).toBeCloseTo(900 * localContent.config.oil.refineryYield, 6);
  });

  it('прямой трубопровод резервирует мощность до маршрутизации остатка', () => {
    const pipeFirst = oilFlowsOf(
      limitedConfig,
      { domestic: { crude: 0, products: 0 }, export: { crude: 80, products: 0 }, refine: 0 },
      50,
      {
        pipeline: 0.5,
        modeShares: { pipeline: 0.5, rail: 0.5, tanker: 0 },
        prices: { ...equalPrices, crudeExport: 10 },
      },
    );
    expect(pipeFirst.export).toBeCloseTo(50, 6);
    expect(pipeFirst.exportByMode.pipeline).toBeCloseTo(40, 6);
    expect(pipeFirst.exportByMode.rail).toBeCloseTo(10, 6);
    expect(pipeFirst.exportByMode.tanker).toBe(0);
  });

  it('экспорт забирает нефть первым и делится по видам транспорта', () => {
    // Заказчик купил экспортные карточки, а в панели стояло «0 т/с»:
    // безлимитный внутренний рынок съедал всю добычу раньше экспорта.
    const state = createInitialState(config, 64);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    state.levels = { t_pipeline: 2, x_cistern: 2, t_terminal: 2 };
    const d = computeDerived(config, content.upgrades, state, [], content);

    expect(d.capacities.export.crude).toBeGreaterThan(0);
    // Вся добыча уходит в экспорт: он дороже, а внутренний рынок — остаток.
    expect(d.flows.export).toBeCloseTo(d.flows.produced, 6);
    expect(d.flows.domestic).toBe(0);
    // Разбивка по транспорту сходится с общим экспортом.
    const byMode = d.flows.exportByMode;
    expect(byMode.pipeline + byMode.rail + byMode.tanker).toBeCloseTo(d.flows.export, 6);
    // Прямая труба имеет приоритет и забирает всю малую добычу.
    expect(byMode.pipeline).toBeCloseTo(d.flows.export, 6);
    expect(byMode.rail).toBe(0);
    expect(byMode.tanker).toBe(0);
    // Остальные виды транспорта всё равно имеют собственную пропускную способность.
    expect(d.exportCapacityByMode.rail).toBeGreaterThan(0);
    expect(d.exportCapacityByMode.tanker).toBeGreaterThan(0);
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
    const expensiveExport = oilFlowsOf(limitedConfig, caps, 100, {
      prices: { crudeDomestic: 1, crudeExport: 2, productDomestic: 1, productExport: 3 },
    });
    expect(expensiveExport.export).toBeGreaterThan(expensiveExport.domestic);
    expect(expensiveExport.productsExport).toBeGreaterThan(expensiveExport.productsDomestic);

    const expensiveDomestic = oilFlowsOf(limitedConfig, caps, 100, {
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

  it('производство продуктов не превышает доступные рынки и свободное место складов', () => {
    // НПЗ не должен перерабатывать нефть, если выход некуда продать или положить.
    const noOutlet = oilFlowsOf(
      limitedConfig,
      { domestic: { crude: 1000, products: 0 }, export: { crude: 0, products: 0 }, refine: 1000 },
      1000,
      { prices: equalPrices, productStorage: 100, storageHorizonSeconds: 5, productStorageFree: 100 },
    );
    expect(noOutlet.refined * config.oil.refineryYield).toBeLessThanOrEqual(20 + 1e-9);
    expect(noOutlet.productsStored).toBeCloseTo(noOutlet.productsProduced, 6);
    expect(noOutlet.productsSpill).toBe(0);
    expect(noOutlet.domestic).toBeGreaterThan(0);

    // Поток хранения — т/с: 100 тонн свободной ёмкости на пять секунд дают 20 т/с.
    const limitedStorage = oilFlowsOf(
      limitedConfig,
      { domestic: { crude: 0, products: 0 }, export: { crude: 0, products: 0 }, refine: 1000 },
      1000,
      { prices: equalPrices, productStorage: 100, storageHorizonSeconds: 5, productStorageFree: 100 },
    );
    expect(limitedStorage.productsStored).toBeLessThanOrEqual(20 + 1e-9);
    expect(limitedStorage.productsStored + limitedStorage.productsSpill)
      .toBeCloseTo(limitedStorage.productsProduced, 6);
  });

  it('у рынков свои доступные объёмы для сырья и нефтепродуктов', () => {
    const state = createInitialState(config, 67);
    const base = computeDerived(config, content.upgrades, state, [], content);
    // Стартовые контракты безлимитны для сырья; продукты ограничены своей
    // отдельной мощностью и не становятся безлимитными вместе с нефтью.
    expect(base.capacities.domestic.crude).toBe(Number.POSITIVE_INFINITY);
    expect(base.capacities.domestic.products).toBeGreaterThan(0);
    expect(base.capacities.export.crude).toBe(0);

    // Трест расширяет только рынок сырья...
    state.levels = { c_local: 2 };
    const crudeOnly = computeDerived(config, content.upgrades, state, [], content);
    // Рынок продуктов не вырос ни на тонну — расширился только рынок сырья.
    expect(crudeOnly.capacities.domestic.products).toBeGreaterThan(base.capacities.domestic.products);
    expect(crudeOnly.channels.contract.rate).toBeGreaterThan(base.channels.contract.rate);

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

  it('карточки сбыта больше не повышают цену, а выручка раскрывается по потокам', () => {
    // Заказчик поймал расхождение: «внутренняя цена ₦1,37/т», а в строке
    // сбыта — «× ₦4,13/т». Надбавки сбытовых построек входили в цену продажи,
    // но не в подпись. Теперь подписанная цена и цена расчёта — одно число.
    const state = createInitialState(config, 63);
    state.wells = [{ kind: 'good', dailyTonnes: 60 }];
    state.levels = { c_local: 5, c_broker: 4, c_bourse: 3 };
    const d = computeDerived(config, content.upgrades, state, [], content);
    expect(d.domesticPricePerTon).toBeCloseTo(d.channels.contract.price, 9);
    expect(d.exportPricePerTon).toBeCloseTo(d.channels.export.price, 9);
    const basePrice = config.oil.basePricePerTon * config.worldPrice.startPrice;
    expect(d.domesticPricePerTon).toBeCloseTo(basePrice * config.oil.channels.contract.priceFactor, 8);
    expect(d.crudeExportIncomePerSecond).toBeCloseTo(d.flows.export * d.exportPricePerTon, 8);
    expect(d.productsExportIncomePerSecond).toBeCloseTo(d.flows.productsExport * d.productPriceExport, 8);
    expect(d.crudeDomesticIncomePerSecond).toBeCloseTo(d.flows.domestic * d.domesticPricePerTon, 8);
    expect(d.productsDomesticIncomePerSecond).toBeCloseTo(d.flows.productsDomestic * d.productPriceDomestic, 8);
    const marketGross = d.crudeExportIncomePerSecond + d.productsExportIncomePerSecond +
      d.crudeDomesticIncomePerSecond + d.productsDomesticIncomePerSecond;
    expect(d.grossPerSecond).toBeCloseTo(marketGross + d.investmentIncomePerSecond, 6);
  });

  it('инвестиционная ставка зависит от влияния: от 1% до 20% годовых', () => {
    const state = createInitialState(config, 64);
    state.coins = 36_000;
    const low = computeDerived(config, content.upgrades, state, [], content);
    expect(low.investmentRatePercent).toBeCloseTo(1, 9);
    expect(low.investmentIncomePerSecond).toBeCloseTo(36_000 * 0.01 / (360 * config.oil.wells.secondsPerDay), 9);

    const maxInfluence = {
      ...content.upgrades.find((u) => u.id === 'p_secretary')!,
      id: 'test_max_influence',
      type: 'passive' as const,
      effect: { influence: config.influence.cap },
    };
    state.levels[maxInfluence.id] = 1;
    const high = computeDerived(config, [...content.upgrades, maxInfluence], state, [], content);
    expect(high.investmentRatePercent).toBeCloseTo(20, 9);
    expect(high.investmentIncomePerSecond).toBeCloseTo(36_000 * 0.2 / (360 * config.oil.wells.secondsPerDay), 9);
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


describe('потолок добычи и состав собственности', () => {
  it('в активы включает оборудование, медиа, инфраструктуру, скважины и роскошь — не действия и персонал', () => {
    const state = createInitialState(config, 71);
    state.levels = {
      t_pump1: 2,
      t_imager: 1,
      p_newspaper: 1,
      p_tvchannel: 1,
      pmc_airbase: 1,
      t_pipeline: 1,
      p_monarch: 1,
      p_puppy: 1,
      s_geonav: 1,
      g_capital_flight: 1,
      t_mud: 1,
      l_boat: 1,
    };
    state.luxurySpent = 203;
    state.wells = [{ kind: 'ordinary', dailyTonnes: 10 }];
    const ids = assetValueBreakdownOf(config, content.upgrades, state).map(line => line.id);

    expect(ids).toContain('t_pump1');
    expect(ids).toContain('t_imager');
    expect(ids).toContain('p_newspaper');
    expect(ids).toContain('p_tvchannel');
    expect(ids).toContain('pmc_airbase');
    expect(ids).toContain('t_pipeline');
    expect(ids).toContain('wells');
    expect(ids).toContain('luxury');
    for (const excluded of ['p_monarch', 'p_puppy', 's_geonav', 'g_capital_flight', 't_mud']) {
      expect(ids).not.toContain(excluded);
    }
  });

  it('все скважины и месторождения на максимуме не превышают 10 млн т/с даже со всеми множителями', () => {
    const wellUpgrade = content.byId.get('t_well');
    const fieldUpgrade = content.byId.get('p_field');
    const reprivatization = content.byId.get('p_reprivatize');
    expect(wellUpgrade && fieldUpgrade && reprivatization).toBeTruthy();

    const fieldPurchaseCost =
      totalCostFor(config, fieldUpgrade!, 0, fieldUpgrade!.maxLevel) +
      totalCostFor(config, reprivatization!, 0, reprivatization!.maxLevel);
    const uniqueMax = config.oil.wells.classes.find(well => well.key === 'unique')!.maxDailyTonnes;
    const dailyTonnesAtAllMax =
      wellUpgrade!.maxLevel * uniqueMax +
      fieldPurchaseCost * 10 / (config.oil.basePricePerTon * config.oil.wells.priceSeconds);

    const state = createInitialState(config, 72);
    state.levels = Object.fromEntries(content.upgrades.map(def => [def.id, def.maxLevel]));
    state.wells = [{ kind: 'unique', dailyTonnes: dailyTonnesAtAllMax }];
    const uncappedConfig = structuredClone(config);
    uncappedConfig.oil.maxProductionPerSecond = Number.MAX_SAFE_INTEGER;
    const uncapped = computeDerived(uncappedConfig, content.upgrades, state, [], content);
    const derived = computeDerived(config, content.upgrades, state, [], content);

    expect(uncapped.oilPerSecond).toBeGreaterThan(10_000_000);
    expect(derived.oilPerSecond).toBe(config.oil.maxProductionPerSecond);
    expect(derived.oilPerSecond).toBeLessThanOrEqual(10_000_000);
  });

  it('жёсткий предел сохраняется для старых сохранений с аномальным дебитом', () => {
    const state = createInitialState(config, 73);
    state.levels = Object.fromEntries(content.upgrades.map(def => [def.id, def.maxLevel]));
    state.wells = [{ kind: 'unique', dailyTonnes: 1_000_000_000_000 }];
    const derived = computeDerived(config, content.upgrades, state, [], content);
    expect(derived.oilPerSecond).toBe(config.oil.maxProductionPerSecond);
  });
});


describe('регрессии аудита: периодика, банк, рынки и скважины', () => {
  it('уровни периодической покупки масштабируют фактическую выплату', () => {
    const def = content.byId.get('t_core')!;
    const derived = computeDerived(config, content.upgrades, withUpgrades());
    const first = eventPayout(def, derived, 1, 0);
    const fifth = eventPayout(def, derived, 5, 0);
    expect(fifth).toBeGreaterThan(first);
    expect(fifth).toBe(first * 5);
  });

  it('операции банка не увеличивают bankScale — это делает только покупка масштаба', () => {
    const state = withUpgrades({
      p_bank_scale: 2,
      p_launder: 1,
      p_hideprofit: 1,
      p_tranche: 1,
    });
    expect(bankScaleOf(content.upgrades, state)).toBeCloseTo(1 + 0.35 * 2, 9);
  });

  it('АЗС добавляет мощность нефтепродуктов поверх базовой мощности внутреннего рынка', () => {
    const state = withUpgrades();
    const before = computeDerived(config, content.upgrades, state, [], content);
    const azs = content.byId.get('t_azs')!;
    state.levels.t_azs = 1;
    const after = computeDerived(config, content.upgrades, state, [], content);
    expect(config.oil.channels.contract.baseRate).toBeGreaterThan(0);
    expect(after.capacities.domestic.products - before.capacities.domestic.products)
      .toBeCloseTo(azs.effect.value ?? 0, 8);
  });

  it('терминал нефтепродуктов не создаёт мощность танкерного экспорта сырой нефти', () => {
    const state = withUpgrades({ t_exptanker: 1 });
    const derived = computeDerived(config, content.upgrades, state, [], content);
    expect(derived.capacities.export.products).toBeGreaterThan(0);
    expect(derived.capacities.export.crude).toBe(0);
    expect(derived.exportCapacityByMode.tanker).toBe(0);
  });

  it('реприватизация возвращает точные положительные доли дебита скважин', () => {
    const prize = reprivatizationPrize(config, 1_000_000, config.oil.basePricePerTon, () => 0.5);
    expect(prize.shares).toHaveLength(prize.wells);
    expect(prize.shares.every((share) => share >= 1)).toBe(true);
    expect(prize.shares.reduce((sum, share) => sum + share, 0)).toBe(prize.dailyTonnes);
  });
});
