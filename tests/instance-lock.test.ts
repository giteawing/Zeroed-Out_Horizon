/**
 * REVIEW C8: сохранение одно на все вкладки. Его пишет только та вкладка,
 * что открылась первой; остальные узнают, что оно занято, и ждут.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeLocks, settleLocks } from './helpers/fake-locks';
import { claimSave } from '../src/core/instance-lock';
import { SAVE_KEY } from '../src/core/state';

function handlers(): { onBusy: ReturnType<typeof vi.fn<() => void>>; onFree: ReturnType<typeof vi.fn<() => void>> } {
  return { onBusy: vi.fn<() => void>(), onFree: vi.fn<() => void>() };
}

describe('одна игра — одна вкладка (REVIEW C8)', () => {
  it('первая вкладка получает сохранение молча и держит его', async () => {
    const locks = new FakeLocks();
    const first = handlers();
    claimSave(first, locks);
    await settleLocks();
    expect(first.onBusy).not.toHaveBeenCalled();
    expect(first.onFree).not.toHaveBeenCalled();
    // Замок назван по ключу сохранения: спорят только вкладки одной игры.
    expect(locks.requested).toEqual([SAVE_KEY]);
    expect(locks.isHeld(SAVE_KEY)).toBe(true);
  });

  it('вторая вкладка узнаёт, что сохранение занято, и встаёт в очередь', async () => {
    const locks = new FakeLocks();
    claimSave(handlers(), locks);
    await settleLocks();
    const second = handlers();
    claimSave(second, locks);
    await settleLocks();
    expect(second.onBusy).toHaveBeenCalledTimes(1);
    expect(second.onFree).not.toHaveBeenCalled();
    expect(locks.waitingFor(SAVE_KEY)).toBe(1);
  });

  it('когда первая вкладка закрылась, вторая узнаёт об этом и держит сохранение сама', async () => {
    const locks = new FakeLocks();
    const firstTab = locks.openOtherTab(SAVE_KEY);
    await settleLocks();
    const second = handlers();
    claimSave(second, locks);
    await settleLocks();
    expect(second.onBusy).toHaveBeenCalledTimes(1);

    firstTab.close();
    await settleLocks();
    expect(second.onFree).toHaveBeenCalledTimes(1);
    expect(second.onBusy).toHaveBeenCalledTimes(1);

    // Третья вкладка теперь ждёт вторую.
    const third = handlers();
    claimSave(third, locks);
    await settleLocks();
    expect(third.onBusy).toHaveBeenCalledTimes(1);
    expect(third.onFree).not.toHaveBeenCalled();
  });

  it('без Web Locks игра работает как раньше', async () => {
    const lonely = handlers();
    expect(() => claimSave(lonely, null)).not.toThrow();
    await settleLocks();
    expect(lonely.onBusy).not.toHaveBeenCalled();
    expect(lonely.onFree).not.toHaveBeenCalled();
  });

  it('отказ браузера не роняет игру и не блокирует её', async () => {
    // Так ведёт себя браузер, когда хранилище запрещено для страницы.
    const unhandled = vi.fn<(reason: unknown) => void>();
    process.on('unhandledRejection', unhandled);
    try {
      const refused = handlers();
      const locks = { request: () => Promise.reject(new DOMException('denied', 'SecurityError')) };
      expect(() => claimSave(refused, locks)).not.toThrow();
      const throwing = handlers();
      expect(() => claimSave(throwing, { request: () => { throw new Error('boom'); } })).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(refused.onBusy).not.toHaveBeenCalled();
      expect(throwing.onBusy).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
