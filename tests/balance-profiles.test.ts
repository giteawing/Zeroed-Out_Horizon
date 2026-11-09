/**
 * Два базовых профиля; остальные стратегии проверяются отдельно, оценивающий повторяемые действия.
 * Отделены от остальных баланс-проверок, чтобы один worker не выполнял
 * длинный синхронный файл дольше внутреннего RPC-порога Vitest.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { runSimulation, type SimulatorOptions } from '../src/core/simulator';

const content = loadContent();

const PROFILES: Array<{ name: string; options: SimulatorOptions }> = [
  { name: 'быстрый экспорт', options: { exportPatienceSeconds: 20, seed: 101 } },
  { name: 'сбалансированная логистика', options: { exportPatienceSeconds: 40, seed: 202 } },
  { name: 'терпеливый экспорт', options: { exportPatienceSeconds: 60, seed: 303 } },
  { name: 'оптимизатор повторяемых действий', options: { exportPatienceSeconds: 40, seed: 404, strategy: 'optimizer' } },
];

describe('профили прохождения игры', () => {
  for (const profile of PROFILES) {
    it(`профиль «${profile.name}» проходит игру за 12–25 минут`, () => {
      const result = runSimulation(content, { ...profile.options, maxSeconds: 60 * 30 });
      const minutes = result.seconds / 60;
      const lastSamples = result.samples.slice(-3).map(sample => ({
        second: sample.second,
        coins: sample.coins,
        earned: sample.totalEarned,
        netPerSecond: sample.netPerSecond,
        purchases: sample.purchases,
      }));
      expect(
        result.won,
        `бот не дошёл до победы (${minutes.toFixed(1)} мин); earned=${result.totalEarned}; coins=${result.coins}; purchases=${result.purchases}; last=${JSON.stringify(lastSamples)}`,
      ).toBe(true);
      expect(minutes).toBeGreaterThanOrEqual(12);
      expect(minutes).toBeLessThanOrEqual(25);
    });
  }
});
