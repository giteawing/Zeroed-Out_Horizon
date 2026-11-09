/** Дополнительные профили запускаются отдельно от базовых, чтобы
 * CPU-bound симуляции не конкурировали в одном длинном Vitest worker task.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { runSimulation, type SimulatorOptions } from '../src/core/simulator';

const content = loadContent();
const PROFILES: Array<{ name: string; options: SimulatorOptions }> = [
  { name: 'терпеливый экспорт', options: { exportPatienceSeconds: 60, seed: 303 } },
  { name: 'оптимизатор повторяемых действий', options: { exportPatienceSeconds: 40, seed: 404, strategy: 'optimizer' } },
];

describe('дополнительные профили прохождения игры', () => {
  for (const profile of PROFILES) {
    it(`профиль «${profile.name}» проходит игру за 12–25 минут`, () => {
      const result = runSimulation(content, { ...profile.options, maxSeconds: 60 * 30 });
      const minutes = result.seconds / 60;
      expect(
        result.won,
        `бот не дошёл до победы (${minutes.toFixed(1)} мин); earned=${result.totalEarned}; coins=${result.coins}; purchases=${result.purchases}`,
      ).toBe(true);
      expect(minutes).toBeGreaterThanOrEqual(12);
      expect(minutes).toBeLessThanOrEqual(25);
    });
  }
});
