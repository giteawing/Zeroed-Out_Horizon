export interface IconPlan {
  /** Файлы, которые генератор запишет. */
  write: Array<{ name: string; svg: string }>;
  /** Существующие файлы с рисунком в генераторе, оставленные как есть. */
  kept: string[];
  /** Рукописные иконки без рисунка в генераторе: не трогаются никогда. */
  handmade: string[];
  /** Недостающие иконки, собранные из заглушки вкладки. */
  fallback: string[];
}

/** Имена иконок, для которых в генераторе есть рисунок. */
export function generatedIconNames(): string[];

/** SVG иконки из словаря генератора или null, если рисунка нет. */
export function buildIcon(iconName: string): string | null;

/** План работы генератора без записи на диск. */
export function planIcons(
  upgrades: ReadonlyArray<{ icon: string; tab: string }>,
  options: { exists: (iconName: string) => boolean; force?: boolean },
): IconPlan;
