/**
 * Мировая цена — чистая функция логических часов и постоянного seed партии.
 * Сохранение игрового RNG не меняет фазу биржи.
 */
import type { GameConfig } from '../types';

export type WorldPriceSettings = Pick<GameConfig['worldPrice'], 'min' | 'max' | 'startPrice' | 'periodSeconds'>;

export function worldPriceAt(settings: WorldPriceSettings, seed: number, clockMs: number): number {
  const min = Math.min(settings.min, settings.max);
  const max = Math.max(settings.min, settings.max);
  const start = Math.min(max, Math.max(min, settings.startPrice));
  if (max - min <= 1e-12) return min;

  const period = Math.max(3, settings.periodSeconds);
  const phase = ((seed >>> 0) % 360) * (Math.PI / 180);
  const seconds = Math.max(0, clockMs) / 1000;
  const first = Math.sin((seconds / period) * Math.PI * 2 + phase);
  const second = Math.sin((seconds / (period * 2.7)) * Math.PI * 2 + phase * 0.6);
  const firstAtStart = Math.sin(phase);
  const secondAtStart = Math.sin(phase * 0.6);
  const wave = (0.8 * (first - firstAtStart) + 0.2 * (second - secondAtStart)) / 2;
  const price = wave >= 0 ? start + wave * (max - start) : start + wave * (start - min);
  return Math.min(max, Math.max(min, price));
}
