/**
 * Управляемое время для DOM-тестов главного цикла.
 *
 * happy-dom прокручивает requestAnimationFrame неравномерно, а реальные часы
 * делают тесты медленными и мигающими. Здесь кадры, `performance.now()` и
 * `Date.now()` двигаются только по команде теста, причём синхронно: секунда
 * кадров — это секунда настенных часов.
 */
import { vi } from 'vitest';

export interface FrameDriver {
  /** Текущее время кадра, мс. */
  now(): number;
  /** Прожить `ms` обычными кадрами по `frameMs`. */
  run(ms: number, frameMs?: number): void;
  /** Один длинный кадр: видимая вкладка «зависла» на `ms`. */
  stall(ms: number): void;
  /** Время идёт, а кадров нет (скрытая вкладка). */
  skip(ms: number): void;
}

export function installFrameDriver(): FrameDriver {
  const wallBase = 1_750_000_000_000;
  let now = 1_000;
  let queue: FrameRequestCallback[] = [];

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Date, 'now').mockImplementation(() => wallBase + now);

  const flush = (): void => {
    const frames = queue;
    queue = [];
    for (const callback of frames) callback(now);
  };

  return {
    now: () => now,
    run(ms, frameMs = 50) {
      for (let passed = 0; passed < ms; passed += frameMs) {
        now += frameMs;
        flush();
      }
    },
    stall(ms) {
      now += ms;
      flush();
    },
    skip(ms) {
      now += ms;
    },
  };
}

/** Переключить видимость вкладки так же, как это делает браузер. */
export function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}
