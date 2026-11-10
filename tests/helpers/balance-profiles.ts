/**
 * Профили прохождения: общий прогон для двух тест-файлов.
 *
 * Профили поделены на два файла, чтобы один worker не выполнял длинный
 * синхронный файл дольше внутреннего RPC-порога Vitest. Список профилей
 * один — `BALANCE_PROFILES` в симуляторе; каждый профиль попадает ровно
 * в одну половину (это проверяет tests/harness.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { BALANCE_PROFILES, runSimulation, type BalanceProfile } from '../../src/core/simulator';

/** Допустимое время прохождения, минут (ТЗ §5.3). */
export const PLAYTHROUGH_MINUTES = { min: 12, max: 25 } as const;

/** Половина списка профилей: «base» — первые два, «extra» — остальные. */
export function balanceProfiles(part: 'base' | 'extra'): BalanceProfile[] {
  return part === 'base' ? BALANCE_PROFILES.slice(0, 2) : BALANCE_PROFILES.slice(2);
}

export function describeBalanceProfiles(part: 'base' | 'extra', title: string): void {
  const content = loadContent();
  describe(title, () => {
    for (const profile of balanceProfiles(part)) {
      it(`профиль «${profile.name}» проходит игру за 12–25 минут`, () => {
        const result = runSimulation(content, { ...profile.options, maxSeconds: 60 * 30 });
        const minutes = result.seconds / 60;
        const lastSamples = result.samples.slice(-3).map((sample) => ({
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
        expect(minutes).toBeGreaterThanOrEqual(PLAYTHROUGH_MINUTES.min);
        expect(minutes).toBeLessThanOrEqual(PLAYTHROUGH_MINUTES.max);
      });
    }
  });
}
