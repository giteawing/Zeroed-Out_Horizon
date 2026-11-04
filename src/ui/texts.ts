/**
 * Доступ к текстам: единственный способ получить строку в интерфейсе.
 * Позволяет заменить любой текст правкой JSON, не трогая код.
 */
import type { TextsFile } from '../core/types';
import { interpolate } from '../core/format';

export class Texts {
  constructor(readonly data: TextsFile) {}

  /** Строка по пути вида «shop.buy». Возвращает сам путь, если не нашлось. */
  get(path: string, params: Record<string, string | number> = {}): string {
    const [section, key] = path.split('.');
    const group = (this.data as unknown as Record<string, unknown>)[section];
    let value: unknown = group;
    if (key !== undefined) {
      value = group && typeof group === 'object' ? (group as Record<string, unknown>)[key] : undefined;
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

  /** Все категории новостей, кроме служебных. */
  newsCategories(): string[] {
    return Object.keys(this.data.news).filter((key) => key !== 'prefix');
  }
}
