/**
 * Общая формула финансового закрытия продажи.
 * Функция считает результат, но не изменяет состояние игры.
 */
export interface SaleSettlement {
  gross: number;
  expenses: number;
  tax: number;
  net: number;
}

/**
 * EBT = max(0, gross - accruedExpenses)
 * tax = EBT * taxRate
 * net = max(0, EBT - tax)
 */
export function calculateSaleSettlement(
  gross: number,
  accruedExpenses: number,
  taxRate: number,
): SaleSettlement {
  const expenses = Math.max(0, accruedExpenses);
  const ebt = Math.max(0, gross - expenses);
  const tax = ebt * taxRate;
  const net = Math.max(0, ebt - tax);
  return { gross, expenses, tax, net };
}
