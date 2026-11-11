/**
 * Общие обозначения экономики и небольшие преобразования контента.
 */
import type { Channel, ExportMode, Product, UpgradeDef } from '../types';

export function exportModeOf(def: UpgradeDef): ExportMode {
  return def.effect.exportMode ?? 'tanker';
}

/**
 * Покупка приносит месторождение — пакет скважин разом. Это отжатие
 * (`type: 'field'`) и реприватизация: у неё тип `well`, но бурит она не одну
 * скважину. Одно правило для ядра и для подписи на карточке.
 */
export function grantsField(def: Pick<UpgradeDef, 'id' | 'type'>): boolean {
  return def.type === 'field' || def.id === 'p_reprivatize';
}

/** @deprecated Временные налоговые скидки намеренно не применяются. */
export interface TaxBuff {
  id: string;
  amount: number;
  untilMs: number;
}

export const CHANNELS: Channel[] = ['contract', 'export', 'refine'];

/**
 * Проценты на остаток счёта, годовых: минимум — без влияния, максимум — при
 * влиянии `config.influence.cap` и выше. Те же числа печатают «Правила».
 */
export const INVESTMENT_RATE_MIN_PERCENT = 1;
export const INVESTMENT_RATE_MAX_PERCENT = 20;
/** Банковский год в игровых сутках: проценты начисляются ежедневно. */
export const INVESTMENT_YEAR_DAYS = 360;
export const PRODUCTS: Product[] = ['crude', 'products'];

export function stagedNameOf(def: UpgradeDef, level: number): string {
  const names = def.stagedNames;
  if (!names || names.length === 0) return def.name;
  const index = Math.max(0, Math.min(names.length - 1, level - 1));
  return names[index] ?? def.name;
}
