/**
 * Детерминированный ГПСЧ (mulberry32): один и тот же сид -> одна и та же игра.
 * Это важно для симулятора баланса и для воспроизводимых тестов.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Следующее число в [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Текущее состояние — чтобы сохранить игру вместе с «зерном». */
  getSeed(): number {
    return this.state >>> 0;
  }

  /** Случайный элемент массива. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }
}

export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
