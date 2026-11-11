/**
 * Сборка работает из подпапки (REVIEW C9).
 *
 * Игра публикуется на GitHub Pages по адресу вида `/<репозиторий>/`, поэтому
 * ни один адрес в сборке не должен начинаться от корня домена: `/images/x`
 * там указывает мимо игры. В исходном CSS путь от корня — законный способ
 * сослаться на `public/`: сборка переписывает его относительно файла стилей
 * (`base: './'`). Поэтому проверяется результат сборки, а не исходник.
 *
 * Сборка идёт в память и занимает около секунды. В браузере то же самое
 * проверяет сценарий «игра работает из подпапки» в tests/e2e/smoke.spec.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { existsSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

const root = resolve(__dirname, '..');

interface Emitted {
  fileName: string;
  text: string;
}
let emitted: Emitted[] = [];

beforeAll(async () => {
  const result = await build({ root, mode: 'production', logLevel: 'silent', build: { write: false } });
  const outputs = Array.isArray(result) ? result : [result];
  emitted = outputs.flatMap((output) =>
    'output' in output
      ? output.output.map((item) => ({
          fileName: item.fileName,
          text: item.type === 'chunk' ? item.code : String(item.source),
        }))
      : [],
  );
}, 120_000);

const only = (extension: string): Emitted[] => emitted.filter((item) => item.fileName.endsWith(extension));

/** Адрес из файла сборки указывает на другой файл сборки или на файл из `public/`. */
function resolves(from: string, url: string): boolean {
  const target = posix.normalize(posix.join(posix.dirname(from), url.replace(/[?#].*$/, '')));
  if (target.startsWith('..')) return false;
  return emitted.some((item) => item.fileName === target) || existsSync(join(root, 'public', target));
}

describe('сборка работает из подпапки (REVIEW C9)', () => {
  it('собраны страница, стили и код', () => {
    expect(only('.html').map((item) => item.fileName)).toEqual(['index.html']);
    expect(only('.css')).toHaveLength(1);
    expect(only('.js').length).toBeGreaterThan(0);
  });

  it('страница ссылается на файлы относительно себя', () => {
    const [html] = only('.html');
    const links = [...html!.text.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) {
      expect(link, link).toMatch(/^\.\//);
      expect(resolves(html!.fileName, link), `${link} — такого файла в сборке нет`).toBe(true);
    }
  });

  it('стили ссылаются на картинки относительно себя', () => {
    const [css] = only('.css');
    const urls = [...css!.text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((match) => match[1]!);
    // Фон игры задан в стилях: без него проверять было бы нечего.
    expect(urls.some((url) => url.endsWith('images/bg.svg'))).toBe(true);
    for (const url of urls) {
      expect(url, url).not.toMatch(/^(\/|[a-z]+:)/i);
      expect(resolves(css!.fileName, url), `${url} — такого файла в сборке нет`).toBe(true);
    }
  });

  it('в коде нет адресов от корня домена', () => {
    // Пути к картинкам собирает core/assets.ts от BASE_URL = './'.
    for (const chunk of only('.js')) {
      const absolute = chunk.text.match(/["'`]\/(?!\/)[\w./-]*\.(?:svg|png|jpe?g|webp|gif|css|js|json|txt|woff2?)\b/g) ?? [];
      expect(absolute, chunk.fileName).toEqual([]);
      expect(chunk.text, chunk.fileName).not.toMatch(/["'`]\/(?:images|assets)\//);
    }
  });
});
