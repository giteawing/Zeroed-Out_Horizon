/**
 * Типы той части арт-движка, которую используют тесты (`tests/svg.test.ts`).
 * Сами примитивы рисования остаются в `art.mjs` и типов не требуют.
 */

/** Общие градиенты иконок (`<defs>`). */
export const DEFS: string;

/** Проблемы готового SVG: битые `url(#id)`, `undefined`, `NaN`. Пусто — файл цел. */
export function svgProblems(svg: string): string[];

/** Вернуть SVG или упасть с понятной ошибкой, если ресурс битый. */
export function assertSvg(name: string, svg: string): string;

/** Запущен ли модуль как скрипт, а не импортирован. */
export function isMainModule(metaUrl: string): boolean;

/** Значение аргумента `--name value` из командной строки. */
export function argValue(name: string, argv?: string[]): string | undefined;

/** Собрать готовый SVG-файл иконки из тела. */
export function icon(body: string): string;
