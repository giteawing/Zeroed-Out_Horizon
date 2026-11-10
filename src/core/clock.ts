/**
 * Учёт реального времени для главного цикла.
 *
 * Раньше кадр обрезал прошедшее время до 250 мс: если видимая вкладка
 * подвисала на 10 секунд (сборка мусора, тяжёлая соседняя вкладка, отладчик),
 * игра получала 0,25 с вместо десяти — время и доход молча терялись.
 *
 * Политика теперь такая:
 *   • всё реальное время между кадрами попадает в очередь (backlog);
 *   • за один кадр проживается не больше `maxTicksPerFrame` тиков — остаток
 *     переносится на следующие кадры, поэтому один кадр не бывает бесконечным;
 *   • если очередь выросла больше `awayAfterMs` (ноутбук спал при открытой
 *     вкладке, устройство не успевает считать), она целиком объявляется
 *     «отсутствием»: вызывающий код начисляет её по правилам офлайн-дохода,
 *     как для скрытой вкладки. Дважды одно и то же время не считается.
 *
 * Модуль не знает о DOM и движке: только арифметика времени, поэтому
 * тестируется без браузера.
 */
export interface FrameClockOptions {
  /** Длина экономического тика, мс. */
  tickMs: number;
  /** Сколько тиков можно прожить за один кадр. */
  maxTicksPerFrame: number;
  /** Очередь длиннее этого значения считается отсутствием игрока, мс. */
  awayAfterMs: number;
}

export interface FrameAdvance {
  /** Реальное время с прошлого кадра, мс. */
  elapsedMs: number;
  /** Сколько тиков нужно прожить в этом кадре. */
  ticks: number;
  /** Время, которое нужно начислить как отсутствие (офлайн), мс. */
  awayMs: number;
}

export class FrameClock {
  private lastMs: number | null = null;
  private backlogMs = 0;

  constructor(private readonly options: FrameClockOptions) {}

  /** Непрожитый остаток времени, мс. */
  get pendingMs(): number {
    return this.backlogMs;
  }

  /** Начать отсчёт заново: старт партии, возврат во вкладку, новая игра. */
  reset(nowMs: number): void {
    this.lastMs = nowMs;
    this.backlogMs = 0;
  }

  /**
   * Учесть новый кадр.
   *
   * `running = false` — игра на паузе (стартовый экран, скрытая вкладка):
   * время идёт мимо очереди и не будет начислено позже.
   */
  advance(nowMs: number, running = true): FrameAdvance {
    const elapsedMs = this.lastMs === null || !Number.isFinite(nowMs)
      ? 0
      : Math.max(0, nowMs - this.lastMs);
    if (Number.isFinite(nowMs)) this.lastMs = nowMs;
    if (!running) {
      this.backlogMs = 0;
      return { elapsedMs, ticks: 0, awayMs: 0 };
    }

    this.backlogMs += elapsedMs;
    if (this.backlogMs > this.options.awayAfterMs) {
      const awayMs = this.backlogMs;
      this.backlogMs = 0;
      return { elapsedMs, ticks: 0, awayMs };
    }

    const tickMs = Math.max(1, this.options.tickMs);
    const ticks = Math.min(
      Math.max(0, Math.floor(this.options.maxTicksPerFrame)),
      Math.floor(this.backlogMs / tickMs),
    );
    this.backlogMs -= ticks * tickMs;
    return { elapsedMs, ticks, awayMs: 0 };
  }
}
