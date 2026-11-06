/**
 * Три контрольных профиля прохождения: ленивый, обычный и упорный игрок.
 * Отделены от остальных баланс-проверок, чтобы один worker не выполнял
 * длинный синхронный файл дольше внутреннего RPC-порога Vitest.
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

describe('профили прохождения игры', () => {
  for (const profile of PROFILES) {
    it(`профиль «${profile.name}» проходит игру за 12–25 минут`, () => {
      const result = runSimulation(content, { ...profile.options, maxSeconds: 60 * 30 });
      const minutes = result.seconds / 60;
      expect(result.won, `бот не дошёл до победы (${minutes.toFixed(1)} мин)`).toBe(true);
      expect(minutes).toBeGreaterThanOrEqual(12);
      expect(minutes).toBeLessThanOrEqual(25);
    });
  }
});
