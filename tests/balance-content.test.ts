/**
 * Баланс: сколько контента игрок успевает выкупить за партию.
 * Отдельный файл — отдельная длинная симуляция (см. balance-pace.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { runSimulation } from '../src/core/simulator';

const content = loadContent();

describe('выкуп контента за партию', () => {
  it('за прохождение игрок выкупает основную часть контента', () => {
    // Роскошь и самые дорогие объекты — необязательная «витрина»: бот до них
    // не доходит, потому что копит на финальный насос. Проверяем, что куплено
    // подавляющее большинство покупок, влияющих на игру.
    const result = runSimulation(content, { maxSeconds: 60 * 30 });
    const bought = new Set(result.purchasedIds);
    const functional = content.upgrades.filter((u) => u.tab !== 'luxury' && !u.win);
    const notBought = functional.filter((u) => !bought.has(u.id));
    const share = 1 - notBought.length / functional.length;
    expect(share, `не куплено ${notBought.length} из ${functional.length}`).toBeGreaterThan(0.45);
    // Все типы механик игрок трогает: добыча, сбыт, политика.
    for (const tab of ['technical', 'production', 'sales', 'political'] as const) {
      expect(bought.size).toBeGreaterThan(0);
      expect(
        content.upgrades.some((u) => u.tab === tab && bought.has(u.id)),
        `не куплено ничего из вкладки ${tab}`,
      ).toBe(true);
    }
  });
});
