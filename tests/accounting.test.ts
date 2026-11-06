import { describe, expect, it } from 'vitest';
import { calculateSaleSettlement } from '../src/core/accounting';

describe('единая касса продаж', () => {
  it('сначала вычитает накопленные расходы, затем считает налог с EBT', () => {
    expect(calculateSaleSettlement(1_000, 200, 0.25)).toEqual({
      gross: 1_000, expenses: 200, tax: 200, net: 600,
    });
  });

  it('не начисляет деньги при убытке и не создаёт отрицательный баланс', () => {
    expect(calculateSaleSettlement(100, 150, 0.2)).toEqual({
      gross: 100, expenses: 150, tax: 0, net: 0,
    });
  });

  it('не принимает отрицательные накопленные расходы', () => {
    expect(calculateSaleSettlement(100, -50, 0.1)).toEqual({
      gross: 100, expenses: 0, tax: 10, net: 90,
    });
  });
});
