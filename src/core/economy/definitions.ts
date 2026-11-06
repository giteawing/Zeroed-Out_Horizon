/**
 * Общие обозначения экономики и небольшие преобразования контента.
 */
import type { Channel, ExportMode, Product, UpgradeDef } from '../types';

export function exportModeOf(def: UpgradeDef): ExportMode {
  return def.effect.exportMode ?? 'tanker';
}

/** @deprecated Временные налоговые скидки намеренно не применяются. */
export interface TaxBuff {
  id: string;
  amount: number;
  untilMs: number;
}

export const CHANNELS: Channel[] = ['contract', 'export', 'refine'];
export const PRODUCTS: Product[] = ['crude', 'products'];

export function stagedNameOf(def: UpgradeDef, level: number): string {
  const names = def.stagedNames;
  if (!names || names.length === 0) return def.name;
  const index = Math.max(0, Math.min(names.length - 1, level - 1));
  return names[index] ?? def.name;
}
