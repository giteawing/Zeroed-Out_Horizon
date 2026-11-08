import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const imageRoot = resolve(__dirname, '../public/images');

function listSvgFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listSvgFiles(path) : entry.name.endsWith('.svg') ? [path] : [];
  });
}

describe('целостность SVG-ресурсов', () => {
  it('каждый url(#id) ссылается на определённый id, неопределённых заливок нет', () => {
    for (const path of listSvgFiles(imageRoot)) {
      const source = readFileSync(path, 'utf8');
      const ids = new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
      const refs = [...source.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
      const missing = [...new Set(refs.filter((id) => !ids.has(id)))];
      expect(missing, path).toEqual([]);
      expect(source, path).not.toContain('undefined');
    }
  });
});
