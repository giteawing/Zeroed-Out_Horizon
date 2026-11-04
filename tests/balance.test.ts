/**
 * Тест баланса (ТЗ §5.3): бот играет 4–6 тапов в секунду и покупает самое
 * выгодное. Прохождение должно укладываться в 12–25 минут, цель — 15–20.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { runSimulation, type SimulatorOptions } from '../src/core/simulator';

const content = loadContent();

const PROFILES: Array<{ name: string; options: SimulatorOptions }> = [
  { name: 'ленивый (4 тапа/с)', options: { tapsPerSecond: 4, tapDiligence: 0.7, seed: 101 } },
  { name: 'обычный (5 тапов/с)', options: { tapsPerSecond: 5, tapDiligence: 0.85, seed: 202 } },
  { name: 'упорный (6 тапов/с)', options: { tapsPerSecond: 6, tapDiligence: 0.95, seed: 303 } },
];

describe('прохождение игры ботом', () => {
  for (const profile of PROFILES) {
    it(`профиль «${profile.name}» проходит игру за 12–25 минут`, () => {
      const result = runSimulation(content, { ...profile.options, maxSeconds: 60 * 30 });
      const minutes = result.seconds / 60;
      expect(result.won, `бот не дошёл до победы (${minutes.toFixed(1)} мин)`).toBe(true);
      expect(minutes).toBeGreaterThanOrEqual(12);
      expect(minutes).toBeLessThanOrEqual(25);
    });
  }

  it('целевой темп 15–20 минут выдерживается на обычном профиле', () => {
    const result = runSimulation(content, { tapsPerSecond: 5, tapDiligence: 0.85, seed: 202 });
    const minutes = result.seconds / 60;
    expect(minutes).toBeGreaterThanOrEqual(15);
    expect(minutes).toBeLessThanOrEqual(20);
  });

  it('за прохождение игрок успевает купить весь контент', () => {
    const result = runSimulation(content, { maxSeconds: 60 * 30 });
    const notBought = content.upgrades.filter((u) => !result.purchasedIds.includes(u.id));
    expect(notBought.map((u) => u.id)).toEqual([]);
  });

  it('доход растёт, а не стоит на месте', () => {
    const result = runSimulation(content, { maxSeconds: 60 * 20, seed: 7 });
    const first = result.samples.find((s) => s.second >= 120);
    const last = result.samples.find((s) => s.second >= 900);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(last!.netPerSecond).toBeGreaterThan(first!.netPerSecond * 100);
    expect(last!.tapValue).toBeGreaterThan(first!.tapValue * 10);
  });

  it('симулятор детерминирован при одном сиде', () => {
    const a = runSimulation(content, { seed: 555, maxSeconds: 300 });
    const b = runSimulation(content, { seed: 555, maxSeconds: 300 });
    expect(a.totalEarned).toBe(b.totalEarned);
    expect(a.totalTaps).toBe(b.totalTaps);
  });
});
