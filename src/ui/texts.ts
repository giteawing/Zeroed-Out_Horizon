/**
 * Доступ к текстам: единственный способ получить строку в интерфейсе.
 * Позволяет заменить любой текст правкой JSON, не трогая код.
 */
import type { TextsFile } from '../core/types';
import { interpolate } from '../core/format';

export class Texts {
  constructor(readonly data: TextsFile) {}

  /**
   * Строка по пути вида «shop.buy» или «spill.places.sea».
   * Вложенность любая: локации разлива лежат на третьем уровне.
   * Возвращает сам путь, если не нашлось.
   */
  get(path: string, params: Record<string, string | number> = {}): string {
    let value: unknown = this.data;
    for (const part of path.split('.')) {
      if (!value || typeof value !== 'object') return path;
      value = (value as Record<string, unknown>)[part];
    }
    if (typeof value !== 'string') return path;
    return Object.keys(params).length > 0 ? interpolate(value, params) : value;
  }

  /** Массив строк (новости, подсказки, катсцена). */
  list(section: string, key: string): string[] {
    const group = (this.data as unknown as Record<string, unknown>)[section];
    const value = group && typeof group === 'object' ? (group as Record<string, unknown>)[key] : undefined;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }

  /** Название покупки — из texts.json (upgrades), чтобы журнал не хардкодил строки. */
  upgradeName(id: string): string {
    const names = (this.data as unknown as { upgrades?: Record<string, string> }).upgrades;
    return names?.[id] ?? id;
  }

  /** Название достижения по id. */
  achievementName(id: string): string {
    return this.data.achievements.list.find((a) => a.id === id)?.name ?? id;
  }

  /** Все категории новостей, кроме служебных. */
  newsCategories(): string[] {
    return Object.keys(this.data.news).filter((key) => key !== 'prefix');
  }
}
