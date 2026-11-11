// @vitest-environment happy-dom

/**
 * Панель империи показывает множитель добычи от договоров (REVIEW A5):
 * без этой строки игрок видит, что добыча выросла, но не видит почему.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { computeDerived } from '../../src/core/economy';
import { formatNumber } from '../../src/core/format';
import { createInitialState } from '../../src/core/state';
import { Hud } from '../../src/ui/hud';
import { Texts } from '../../src/ui/texts';

const content = loadContent();
const texts = new Texts(content.texts);

function hudFor(levels: Record<string, number>): { hud: Hud; multiplier: number } {
  const state = createInitialState(content.config, 7);
  state.levels = levels;
  const derived = computeDerived(content.config, content.upgrades, state, [], content);
  const hud = new Hud(texts, content.config.currency, content.config);
  hud.update(state, derived);
  return { hud, multiplier: derived.salesVolumeMultiplier };
}

const rowOf = (hud: Hud, key: string): { label: string; value: string } => {
  const row = hud.root.querySelector(`[data-row="${key}"]`);
  expect(row, `нет строки ${key}`).not.toBeNull();
  return {
    label: row!.querySelector('.hud__row-label')?.textContent ?? '',
    value: row!.querySelector('.hud__row-value')?.textContent ?? '',
  };
};

describe('панель империи: потолок добычи', () => {
  /** Одна скважина с заданным дебитом: добыча либо под потолком, либо упирается в него. */
  const hudWithWell = (dailyTonnes: number) => {
    const state = createInitialState(content.config, 7);
    state.wells = [{ kind: 'unique', dailyTonnes }];
    const derived = computeDerived(content.config, content.upgrades, state, [], content);
    const hud = new Hud(texts, content.config.currency, content.config);
    hud.update(state, derived);
    return { hud, derived };
  };
  const cap = content.config.oil.maxProductionPerSecond;

  it('ядро сообщает, что добыча срезана потолком', () => {
    const free = hudWithWell(100).derived;
    expect(free.oilPerSecond).toBeLessThan(cap);
    expect(free.productionCapped).toBe(false);
    const capped = hudWithWell(cap * 1_000).derived;
    expect(capped.oilPerSecond).toBe(cap);
    expect(capped.productionCapped).toBe(true);
  });

  it('строка добычи помечена, только когда потолок достигнут', () => {
    const mark = texts.get('hud.productionCap');
    expect(mark).not.toBe('hud.productionCap');
    expect(rowOf(hudWithWell(100).hud, 'produced').value).not.toContain(mark);
    const capped = rowOf(hudWithWell(cap * 1_000).hud, 'produced').value;
    expect(capped).toContain(mark);
    expect(capped).toContain(formatNumber(cap));
  });

  it('пометка исчезает, когда добыча снова под потолком', () => {
    const state = createInitialState(content.config, 7);
    const hud = new Hud(texts, content.config.currency, content.config);
    const show = (dailyTonnes: number): string => {
      state.wells = [{ kind: 'unique', dailyTonnes }];
      hud.update(state, computeDerived(content.config, content.upgrades, state, [], content));
      return rowOf(hud, 'produced').value;
    };
    expect(show(cap * 1_000)).toContain(texts.get('hud.productionCap'));
    expect(show(100)).not.toContain(texts.get('hud.productionCap'));
  });
});

describe('панель империи: множитель добычи от договоров (REVIEW A5)', () => {
  it('строка стоит сразу под добычей и подписана текстом из texts.json', () => {
    const { hud } = hudFor({});
    const rows = [...hud.root.querySelectorAll('[data-section="crude"] [data-row]')]
      .map((row) => row.getAttribute('data-row'));
    expect(rows.indexOf('salesBoost')).toBe(rows.indexOf('produced') + 1);
    expect(rowOf(hud, 'salesBoost').label).toBe(texts.get('hud.salesBoost'));
    expect(texts.get('hud.salesBoost')).not.toBe('hud.salesBoost');
  });

  it('без договоров множитель равен единице', () => {
    const { hud, multiplier } = hudFor({});
    expect(multiplier).toBe(1);
    expect(rowOf(hud, 'salesBoost').value).toBe('×1');
  });

  it('с договорами строка показывает тот же множитель, на который умножена добыча', () => {
    const { hud, multiplier } = hudFor({ c_local: 3 });
    const percent = content.byId.get('c_local')!.effect.percent!;
    expect(multiplier).toBeCloseTo(1 + (percent / 100) * 3, 12);
    expect(rowOf(hud, 'salesBoost').value).toBe(`×${formatNumber(multiplier)}`);
    expect(rowOf(hud, 'salesBoost').value).not.toBe('×1');
  });
});
