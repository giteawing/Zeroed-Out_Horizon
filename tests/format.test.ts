import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMoney } from '../src/core/format';

describe('formatMoney: округление на границах единиц', () => {
  it('не показывает значения 1000 в единице меньшего порядка', () => {
    expect(formatMoney(999)).toBe('₦999');
    expect(formatMoney(999.5)).toBe('₦1 тыс.');
    expect(formatMoney(999_600)).toBe('₦1 млн');
    expect(formatMoney(999_999)).toBe('₦1 млн');
    expect(formatMoney(999_999_999)).toBe('₦1 млрд');
  });
});

describe('formatDateTime: дата и время событий журнала', () => {
  it('форматирует отметку времени как DD.MM.YYYY HH:MM:SS', () => {
    const sample = new Date(2026, 10, 5, 9, 4, 7).getTime();
    expect(formatDateTime(sample)).toBe('05.11.2026 09:04:07');
    expect(formatDateTime(0)).toBe('');
    expect(formatDateTime(Number.NaN)).toBe('');
  });
});
