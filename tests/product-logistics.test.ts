/**
 * «Логистика»: ручные и автоматические потоки нефтепродуктов.
 *
 * Пункт 2 плана доработок: к маршрутизации сырой нефти добавлены два рынка
 * топлива — «Экспорт нефтепродуктов» и «Продать нефтепродукты на внутреннем
 * рынке». Фиксированная заявка получает свою квоту первой, остаток «Авто»
 * делит по цене; мощности рынков при этом не превышаются.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { allocateBatch, computeDerived, oilFlowsOf } from '../src/core/economy';
import { Game } from '../src/core/game';
import { createInitialState, normalizeState } from '../src/core/state';
import type { Content, GameState } from '../src/core/types';

const content: Content = loadContent();
const { config } = content;

/** НПЗ с рынком внутри страны и наливным терминалом на экспорт. */
function refineryState(): GameState {
  const state = createInitialState(config, 2027);
  state.wells = [{ kind: 'unique', dailyTonnes: 500 }];
  state.levels = { t_refinery: 1, t_productdom: 1, t_productport: 1, t_depot: 1 };
  return state;
}

const derivedOf = (state: GameState) =>
  computeDerived(config, content.upgrades, state, [], content);

function withControls(
  controls: Partial<Record<'productDomestic' | 'productExport', number | 'auto'>>,
): GameState {
  const state = refineryState();
  for (const [key, value] of Object.entries(controls) as Array<
    ['productDomestic' | 'productExport', number | 'auto']
  >) {
    state.flowControl[key] = value === 'auto'
      ? { mode: 'auto', value: 0 }
      : { mode: 'fixed', value };
  }
  return state;
}

describe('«Логистика»: рынки нефтепродуктов', () => {
  it('в авторежиме топливо идёт на более дорогой экспорт', () => {
    const derived = derivedOf(refineryState());
    expect(derived.flows.productsProduced).toBeGreaterThan(0);
    expect(derived.productPriceExport).toBeGreaterThan(derived.productPriceDomestic);
    expect(derived.flows.productsExport).toBeGreaterThan(0);
    expect(derived.flows.productsDomestic).toBe(0);
  });

  it('фиксированная внутренняя квота получает свои тонны первой', () => {
    const derived = derivedOf(withControls({ productDomestic: 100 }));
    expect(derived.flows.productsProduced).toBeGreaterThan(100);
    expect(derived.flows.productsDomestic).toBeCloseTo(100, 6);
    expect(derived.flows.productsExport).toBeGreaterThan(0);
  });

  it('нулевая внутренняя квота отключает продажи внутри страны', () => {
    const derived = derivedOf(withControls({ productDomestic: 0 }));
    expect(derived.flows.productsDomestic).toBe(0);
    expect(derived.flows.productsExport).toBeGreaterThan(0);
  });

  it('нулевая экспортная квота оставляет всё топливо внутри страны', () => {
    const derived = derivedOf(withControls({ productExport: 0 }));
    expect(derived.flows.productsExport).toBe(0);
    expect(derived.flows.productsDomestic).toBeGreaterThan(0);
  });

  it('обе квоты в нуле отправляют топливо на склад, а не на рынок', () => {
    const state = withControls({ productExport: 0, productDomestic: 0 });
    // Нефть намеренно не продаём: проверяем именно судьбу продуктов НПЗ.
    state.flowControl.contract = { mode: 'fixed', value: 0 };
    state.flowControl.export = { mode: 'fixed', value: 0 };
    const derived = derivedOf(state);
    expect(derived.flows.productsExport).toBe(0);
    expect(derived.flows.productsDomestic).toBe(0);
    expect(derived.flows.productsProduced).toBeGreaterThan(0);
    expect(derived.flows.productsStored).toBeCloseTo(derived.flows.productsProduced, 6);
    expect(derived.flows.productsSpill).toBe(0);
  });

  it('фиксированная квота не может превысить мощность рынка', () => {
    const state = refineryState();
    const game = new Game(content, state);
    const derived = game.derived();
    const limits = derived.flowLimits;
    expect(limits.productDomestic).toBeGreaterThan(0);
    expect(limits.productExport).toBeGreaterThan(0);
    expect(game.setFlowControl('productDomestic', {
      mode: 'fixed', value: limits.productDomestic + 1,
    })).toBe(false);
    expect(game.setFlowControl('productDomestic', {
      mode: 'fixed', value: limits.productDomestic,
    })).toBe(true);
    expect(state.flowControl.productDomestic.mode).toBe('fixed');
  });

  it('складской запас расходует фиксированную квоту, а не удваивает её', () => {
    // Квота 150 т/с × 5 с = 750 т. Склад (1000 т) выбирает её целиком,
    // значит свежему выходу НПЗ внутренний рынок уже ничего не должен.
    const state = withControls({ productDomestic: 150 });
    state.products = 1000;
    const derived = derivedOf(state);
    const flows = oilFlowsOf(config, derived.capacities, derived.oilPerSecond, {
      prices: {
        crudeDomestic: derived.domesticPricePerTon,
        crudeExport: derived.exportPricePerTon,
        productDomestic: derived.productPriceDomestic,
        productExport: derived.productPriceExport,
      },
      productStorage: derived.productCapacity,
      productStorageFree: Math.max(0, derived.productCapacity - state.products),
      productInventory: state.products,
      storageHorizonSeconds: config.oil.shipDays * config.oil.wells.secondsPerDay,
      flowControl: state.flowControl,
    });
    // Без остатка квоты свежий выход получил бы ещё 150 т/с сверху.
    expect(flows.productsDomestic).toBe(0);
    expect(flows.productsProduced).toBeGreaterThan(0);
  });

  it('отгрузка партии не продаёт склад и свежий выход сверх квоты', () => {
    const state = withControls({ productDomestic: 150 });
    state.products = 1000;
    const derived = derivedOf(state);
    const plan = allocateBatch(
      config,
      derived.capacities,
      derived.oilPerSecond,
      config.oil.shipDays * config.oil.wells.secondsPerDay,
      {
        crudeDomestic: derived.domesticPricePerTon,
        crudeExport: derived.exportPricePerTon,
        productDomestic: derived.productPriceDomestic,
        productExport: derived.productPriceExport,
      },
      Math.max(0, derived.productCapacity - state.products),
      state.products,
      state.flowControl,
      derived.refineries.units,
    );
    // Склад уже выбрал квоту 150 т/с × 5 с; свежий выход не продаёт повторно.
    expect(plan.productsDomestic).toBe(0);
    expect(plan.products).toBeGreaterThan(0);
  });

  it('отгрузка партии делит топливо так же, как прогноз потоков', () => {
    const state = withControls({ productDomestic: 800, productExport: 'auto' });
    const derived = derivedOf(state);
    const seconds = 1;
    const plan = allocateBatch(
      config,
      derived.capacities,
      derived.oilPerSecond * seconds,
      seconds,
      {
        crudeDomestic: derived.domesticPricePerTon,
        crudeExport: derived.exportPricePerTon,
        productDomestic: derived.productPriceDomestic,
        productExport: derived.productPriceExport,
      },
      Math.max(0, derived.productCapacity - state.products),
      state.products,
      state.flowControl,
      derived.refineries.units,
    );
    expect(plan.productsDomestic).toBeCloseTo(derived.flows.productsDomestic * seconds, 6);
    expect(plan.productsExport).toBeCloseTo(derived.flows.productsExport * seconds, 6);
  });
});

describe('«Логистика»: сохранение старых сейвов', () => {
  it('потоковые направления по умолчанию в «Авто»', () => {
    const state = createInitialState(config, 1);
    expect(state.flowControl.productDomestic).toEqual({ mode: 'auto', value: 0 });
    expect(state.flowControl.productExport).toEqual({ mode: 'auto', value: 0 });
  });

  it('старый сейв без рынков топлива читается и получает «Авто»', () => {
    const legacy = createInitialState(config, 2) as unknown as {
      flowControl: Record<string, unknown>;
    };
    delete legacy.flowControl.productDomestic;
    delete legacy.flowControl.productExport;
    const restored = normalizeState(legacy, config, content);
    expect(restored.flowControl.productDomestic).toEqual({ mode: 'auto', value: 0 });
    expect(restored.flowControl.productExport).toEqual({ mode: 'auto', value: 0 });
  });
});
