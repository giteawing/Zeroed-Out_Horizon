import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/core/format';

describe('formatMoney: округление на границах единиц', () => {
  it('не показывает значения 1000 в единице меньшего порядка', () => {
    expect(formatMoney(999)).toBe('₦999');
    expect(formatMoney(999.5)).toBe('₦1 тыс.');
    expect(formatMoney(999_600)).toBe('₦1 млн');
    expect(formatMoney(999_999)).toBe('₦1 млн');
    expect(formatMoney(999_999_999)).toBe('₦1 млрд');
  });
});
