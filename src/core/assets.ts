/**
 * Пути к статике. Единая точка, чтобы сборка работала и на GitHub Pages
 * из подпапки (Vite base: './'), и на корне домена.
 *
 * Vite подставляет BASE_URL = './' — значит относительные пути считаются
 * от index.html, а не от корня домена.
 */
const BASE = import.meta.env?.BASE_URL ?? './';

function withBase(path: string): string {
  // Путь всегда относительный: работает и из корня домена, и из подпапки
  // GitHub Pages. В dev BASE_URL = '/', в сборке — './'.
  const clean = path.replace(/^\.?\//, '');
  const base = BASE === '/' ? '' : BASE;
  return `${base}${clean}`;
}

/** Картинка из public/images. */
export function image(name: string): string {
  return withBase(`images/${name}`);
}

/** Иконка покупки: <icon>.svg. */
export function icon(name: string): string {
  return withBase(`images/icons/${name}.svg`);
}
