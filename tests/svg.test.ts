import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadContent } from '../src/core/content';
import { buildIcon, generatedIconNames, planIcons } from '../scripts/generate-icons.mjs';
import { buildScenes } from '../scripts/generate-scenes.mjs';
import { PALETTE, assertSvg, character, svgProblems } from '../scripts/lib/art.mjs';

const imageRoot = resolve(__dirname, '../public/images');
const iconRoot = resolve(imageRoot, 'icons');
const content = loadContent();

function listSvgFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listSvgFiles(path) : entry.name.endsWith('.svg') ? [path] : [];
  });
}

const renders = (source: string): number =>
  new Resvg(source, { fitTo: { mode: 'width', value: 128 } }).render().asPng().byteLength;

describe('целостность SVG-ресурсов', () => {
  it('каждый url(#id) ссылается на определённый id, неопределённых заливок нет', () => {
    for (const path of listSvgFiles(imageRoot)) {
      const source = readFileSync(path, 'utf8');
      const ids = new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
      const refs = [...source.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
      const missing = [...new Set(refs.filter((id) => !ids.has(id)))];
      expect(missing, path).toEqual([]);
      expect(source, path).not.toContain('undefined');
      const rendered = new Resvg(source, { fitTo: { mode: 'width', value: 128 } }).render();
      expect(rendered.asPng().byteLength, path).toBeGreaterThan(0);
    }
  });
});

/**
 * REVIEW A2: `npm run art` уничтожал исправленную графику. Сцены получали
 * ссылки на несуществующие градиенты (`url(#gold)` в logo.svg и finale.svg),
 * иконка `well` — `fill="undefined"`, а три рукописные иконки заменялись
 * заглушками. Генераторы теперь импортируются и проверяются без записи файлов.
 */
describe('генераторы графики не портят ресурсы (REVIEW A2)', () => {
  it('проверка SVG ловит битые ссылки и незаполненные шаблоны', () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gold"/></defs>' +
      '<circle r="3" fill="url(#gold)"/></svg>';
    expect(svgProblems(ok)).toEqual([]);
    expect(assertSvg('ok.svg', ok)).toBe(ok);

    const dangling = ok.replace('id="gold"', 'id="goldGrad"');
    expect(svgProblems(dangling)).toEqual(['ссылка на неопределённый id: url(#gold)']);
    expect(() => assertSvg('logo.svg', dangling)).toThrow(/logo\.svg.*url\(#gold\)/);

    const undefinedFill = ok.replace('fill="url(#gold)"', 'fill="undefined"');
    expect(svgProblems(undefinedFill)).toEqual(['в разметке есть undefined']);
    expect(() => assertSvg('well.svg', undefinedFill)).toThrow(/well\.svg.*undefined/);

    expect(svgProblems(ok.replace('r="3"', 'r="NaN"'))).toEqual(['в разметке есть NaN']);
  });

  it('сцены генератора целы и совпадают с закоммиченными файлами', () => {
    const scenes = buildScenes();
    expect(Object.keys(scenes).sort()).toEqual(['bg.svg', 'finale.svg', 'logo.svg']);
    for (const [name, svg] of Object.entries(scenes)) {
      expect(svgProblems(svg), name).toEqual([]);
      expect(renders(svg), name).toBeGreaterThan(0);
      // Побайтное равенство: повторный `npm run art` не меняет сцены, а
      // расхождение генератора и готового файла сразу видно в тесте.
      expect(svg === readFileSync(resolve(imageRoot, name), 'utf8'), `${name} совпадает с файлом`)
        .toBe(true);
    }
  });

  it('каждая иконка генератора цела и отрисовывается', () => {
    const names = generatedIconNames();
    expect(names.length).toBeGreaterThan(100);
    for (const name of names) {
      const svg = buildIcon(name);
      expect(svg, name).not.toBeNull();
      expect(svgProblems(svg!), name).toEqual([]);
      expect(renders(svg!), name).toBeGreaterThan(0);
    }
    expect(buildIcon('нет-такой-иконки')).toBeNull();
  });

  it('по умолчанию генератор не перезаписывает существующие иконки', () => {
    const exists = (name: string): boolean => existsSync(resolve(iconRoot, `${name}.svg`));
    const plan = planIcons(content.upgrades, { exists });
    expect(plan.write).toEqual([]);
    expect(plan.fallback).toEqual([]);
    const icons = new Set(content.upgrades.map((def) => def.icon));
    expect(plan.kept.length + plan.handmade.length).toBe(icons.size);
  });

  it('даже --force не заменяет рукописные иконки заглушками', () => {
    const exists = (name: string): boolean => existsSync(resolve(iconRoot, `${name}.svg`));
    const plan = planIcons(content.upgrades, { exists, force: true });
    const written = plan.write.map((entry) => entry.name);
    const handmade = ['devalue', 'domestic-cartel', 'export-cartel'];
    expect([...plan.handmade].sort()).toEqual(handmade);
    for (const name of handmade) expect(written, name).not.toContain(name);
    expect(plan.fallback).toEqual([]);
    expect(new Set(written).size).toBe(written.length);
    for (const entry of plan.write) expect(svgProblems(entry.svg), entry.name).toEqual([]);
  });

  it('генератор уважает размер и опору персонажа из определения иконки', () => {
    // Раньше `person()` перекрывал переданные `baseY` и `scale` своими, и
    // сенат, правительство, бригада и секретарь рисовались не тем размером,
    // который записан в их определении: `npm run art:force` менял ручную
    // графику другой, а не восстанавливал её.
    // Определение сената: `person({ suit: P.oil, baseY: 82, scale: 0.55, cx: 50 })`.
    // Иконка обязана содержать ровно такого персонажа — и не содержать того,
    // которого рисовал прежний `person()` со своими 0,95 и 86.
    const senate = buildIcon('senate');
    expect(senate).not.toBeNull();
    const asDefined = character({ suit: PALETTE.oil, baseY: 82, scale: 0.55, cx: 50 });
    const asBefore = character({ suit: PALETTE.oil, baseY: 86, scale: 0.95, cx: 50 });
    expect(senate).toContain(asDefined);
    expect(senate).not.toContain(asBefore);
    expect(svgProblems(senate!)).toEqual([]);
    expect(renders(senate!)).toBeGreaterThan(0);
  });

  it('недостающая иконка создаётся: из словаря или из заглушки вкладки', () => {
    const missing = new Set(['well', 'devalue']);
    const plan = planIcons(content.upgrades, { exists: (name) => !missing.has(name) });
    expect(plan.write.map((entry) => entry.name).sort()).toEqual(['devalue', 'well']);
    expect(plan.fallback).toEqual(['devalue']);
    for (const entry of plan.write) {
      expect(svgProblems(entry.svg), entry.name).toEqual([]);
      expect(renders(entry.svg), entry.name).toBeGreaterThan(0);
    }
  });
});
