import { describe, expect, it } from 'vitest';
import { FrameClock } from '../src/core/clock';

const options = { tickMs: 100, maxTicksPerFrame: 10, awayAfterMs: 10_000 };

/** Прожить `frames` кадров по `frameMs` и вернуть суммарные тики и отсутствие. */
function run(clock: FrameClock, startMs: number, frames: number, frameMs: number) {
  let now = startMs;
  let ticks = 0;
  let awayMs = 0;
  let maxPerFrame = 0;
  for (let i = 0; i < frames; i++) {
    now += frameMs;
    const step = clock.advance(now);
    ticks += step.ticks;
    awayMs += step.awayMs;
    maxPerFrame = Math.max(maxPerFrame, step.ticks);
  }
  return { now, ticks, awayMs, maxPerFrame };
}

describe('часы главного цикла (AUDIT F02/F05)', () => {
  it('обычные кадры дают ровно один тик на каждые tickMs', () => {
    const clock = new FrameClock(options);
    clock.reset(0);
    const result = run(clock, 0, 600, 1000 / 60);
    // 600 кадров по 16,67 мс = 10 секунд: прожитые тики плюс остаток меньше тика.
    expect(result.ticks * 100 + clock.pendingMs).toBeCloseTo(10_000, 6);
    expect(clock.pendingMs).toBeLessThan(100);
    expect(result.ticks).toBeGreaterThanOrEqual(99);
    expect(result.maxPerFrame).toBe(1);
    expect(result.awayMs).toBe(0);
  });

  it('видимое зависание на 10 секунд не теряет время: остаток переносится между кадрами', () => {
    const clock = new FrameClock(options);
    clock.reset(0);
    // Один «длинный кадр»: раньше в аккумулятор попадало только 250 мс.
    const stall = clock.advance(10_000);
    expect(stall.awayMs).toBe(0);
    expect(stall.ticks).toBe(options.maxTicksPerFrame);
    expect(clock.pendingMs).toBeCloseTo(10_000 - stall.ticks * 100, 6);

    // Дальше идут обычные кадры и догоняют очередь, не превышая бюджет кадра.
    const after = run(clock, 10_000, 120, 16);
    const totalMs = (stall.ticks + after.ticks) * 100 + clock.pendingMs;
    expect(totalMs).toBeCloseTo(10_000 + 120 * 16, 6);
    expect(after.maxPerFrame).toBeLessThanOrEqual(options.maxTicksPerFrame);
    expect(clock.pendingMs).toBeLessThan(100);
    expect(after.awayMs).toBe(0);
  });

  it('очень долгий простой целиком уходит в «отсутствие» и не проживается повторно', () => {
    const clock = new FrameClock(options);
    clock.reset(0);
    const sleep = clock.advance(3_600_000);
    expect(sleep.ticks).toBe(0);
    expect(sleep.awayMs).toBe(3_600_000);
    expect(clock.pendingMs).toBe(0);
    // Следующий кадр считает только своё время.
    const next = clock.advance(3_600_000 + 200);
    expect(next.ticks).toBe(2);
    expect(next.awayMs).toBe(0);
  });

  it('очередь, которую устройство не успевает проживать, тоже превращается в отсутствие', () => {
    const clock = new FrameClock(options);
    clock.reset(0);
    // Каждый кадр длится 3 с, а прожить можно только 1 с: очередь растёт.
    let now = 0;
    let ticks = 0;
    let awayMs = 0;
    for (let i = 0; i < 20; i++) {
      now += 3_000;
      const step = clock.advance(now);
      ticks += step.ticks;
      awayMs += step.awayMs;
    }
    expect(awayMs).toBeGreaterThan(0);
    // Ни одна миллисекунда не потеряна и не учтена дважды.
    expect(ticks * 100 + awayMs + clock.pendingMs).toBeCloseTo(now, 6);
    expect(clock.pendingMs).toBeLessThanOrEqual(options.awayAfterMs);
  });

  it('на паузе время не копится, reset начинает отсчёт заново', () => {
    const clock = new FrameClock(options);
    clock.reset(0);
    // Стартовый экран или скрытая вкладка: кадры идут, игра стоит.
    for (let now = 16; now < 30_000; now += 16) {
      const step = clock.advance(now, false);
      expect(step.ticks).toBe(0);
      expect(step.awayMs).toBe(0);
    }
    expect(clock.pendingMs).toBe(0);
    clock.reset(50_000);
    const step = clock.advance(50_100);
    expect(step.ticks).toBe(1);
    expect(step.awayMs).toBe(0);
  });

  it('некорректное время кадра не ломает очередь', () => {
    const clock = new FrameClock(options);
    clock.reset(1_000);
    expect(clock.advance(Number.NaN)).toEqual({ elapsedMs: 0, ticks: 0, awayMs: 0 });
    // Часы пошли назад (смена источника времени): отрицательный интервал = 0.
    expect(clock.advance(500)).toEqual({ elapsedMs: 0, ticks: 0, awayMs: 0 });
    expect(clock.advance(700).ticks).toBe(2);
  });
});
