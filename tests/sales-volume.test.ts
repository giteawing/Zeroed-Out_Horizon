/**
 * REVIEW A5: договоры о сбыте умножают саму добычу.
 *
 * Карточки контрактов и экспортных соглашений (`type: sell` с `percent`)
 * не только расширяют свой рынок: добыча умножается на 1 + больший из двух
 * итогов — по контрактам или по экспорту. Это задуманная механика, но о ней
 * не знали ни «Правила», ни панель, а навык `economy-accounting` утверждал
 * обратное. Здесь закреплено, как она работает на самом деле.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { computeDerived } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import type { Channel, DerivedStats, UpgradeDef } from '../src/core/types';

const content = loadContent();
const { config, upgrades } = content;

const withPercent = (channel: Channel): UpgradeDef[] =>
  upgrades.filter((def) => def.type === 'sell' && def.effect.channel === channel && def.effect.percent);
const contractCards = withPercent('contract');
const exportCards = withPercent('export');
const refineCards = withPercent('refine');

function derivedWith(levels: Record<string, number>): DerivedStats {
  const state = createInitialState(config, 7);
  state.wells = [{ kind: 'unique', dailyTonnes: 1_000 }];
  state.levels = levels;
  return computeDerived(config, upgrades, state, [], content);
}

/** Сумма процентов купленных уровней, доля. */
const bonus = (cards: UpgradeDef[], levels: Record<string, number>): number =>
  cards.reduce((sum, def) => sum + (def.effect.percent! / 100) * (levels[def.id] ?? 0), 0);

describe('договоры о сбыте и добыча (REVIEW A5)', () => {
  it('в контенте есть договоры обоих видов и модернизация НПЗ', () => {
    expect(contractCards.length).toBeGreaterThan(1);
    expect(exportCards.length).toBeGreaterThan(1);
    expect(refineCards.length).toBeGreaterThan(0);
  });

  it('добыча умножается на 1 + больший из итогов по контрактам и по экспорту', () => {
    const base = derivedWith({});
    expect(base.salesVolumeMultiplier).toBe(1);

    const [contract] = contractCards;
    const [exported] = exportCards;
    const levels = { [contract!.id]: 3, [exported!.id]: 1 };
    const expected = 1 + Math.max(bonus(contractCards, levels), bonus(exportCards, levels));
    const derived = derivedWith(levels);
    expect(derived.salesVolumeMultiplier).toBeCloseTo(expected, 12);
    expect(derived.oilPerSecond).toBeCloseTo(base.oilPerSecond * expected, 6);
    // Итоги не складываются: работает только больший.
    expect(expected).toBeLessThan(1 + bonus(contractCards, levels) + bonus(exportCards, levels));
  });

  it('договор отстающей группы добычу не меняет, но свой рынок расширяет', () => {
    const [contract] = contractCards;
    const [exported] = exportCards;
    const leading = { [contract!.id]: 5 };
    const before = derivedWith(leading);
    const after = derivedWith({ ...leading, [exported!.id]: 1 });
    expect(bonus(exportCards, { [exported!.id]: 1 })).toBeLessThan(bonus(contractCards, leading));
    expect(after.salesVolumeMultiplier).toBe(before.salesVolumeMultiplier);
    expect(after.oilPerSecond).toBe(before.oilPerSecond);
    const exportCapacity = (derived: DerivedStats): number =>
      derived.capacities.export.crude + derived.capacities.export.products;
    expect(exportCapacity(after)).toBeGreaterThan(exportCapacity(before));
  });

  it('модернизация НПЗ на добычу не влияет: она расширяет только переработку', () => {
    const [refine] = refineCards;
    const before = derivedWith({ t_refinery: 2 });
    const after = derivedWith({ t_refinery: 2, [refine!.id]: 2 });
    expect(after.salesVolumeMultiplier).toBe(1);
    expect(after.oilPerSecond).toBe(before.oilPerSecond);
    expect(after.capacities.refine).toBeGreaterThan(before.capacities.refine);
  });

  it('полная прокачка договоров: множитель добычи — порядка ×25', () => {
    const all = Object.fromEntries([...contractCards, ...exportCards].map((def) => [def.id, def.maxLevel]));
    const contractTotal = bonus(contractCards, all);
    const exportTotal = bonus(exportCards, all);
    const derived = derivedWith(all);
    expect(derived.salesVolumeMultiplier).toBeCloseTo(1 + Math.max(contractTotal, exportTotal), 9);
    // Оценка ревизии: сумма процентов контрактов ≈ 2480 %.
    expect(contractTotal).toBeGreaterThan(24);
    expect(contractTotal).toBeLessThan(26);
    expect(derived.salesVolumeMultiplier).toBeGreaterThan(20);
  });

  it('все договоры лежат на вкладке сбыта: туда отправляют «Правила»', () => {
    for (const def of [...contractCards, ...exportCards]) {
      expect(def.tab, def.id).toBe('sales');
    }
  });

  it('описание договора говорит и о рынке, и о добыче — и о том, что считается больший итог', () => {
    for (const def of [...contractCards, ...exportCards]) {
      expect(def.description, def.id).toMatch(/добыч/);
      expect(def.description, def.id).toMatch(/больш/);
      // Прежняя формулировка обещала рост добычи за каждый уровень любой карточки.
      expect(def.description, def.id).not.toContain('эффективная добыча и реализация растут');
    }
    for (const def of refineCards) {
      expect(def.description, def.id).not.toMatch(/добыч/);
    }
  });
});
