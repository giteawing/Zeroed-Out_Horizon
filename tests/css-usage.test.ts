/**
 * Стили ↔ разметка (REVIEW C9).
 *
 * Правило CSS для класса, которого нет в разметке, ничем себя не выдаёт: файл
 * стилей растёт, а автор правит оформление блока, которого нет на экране.
 * И наоборот: класс без правила, который никто не ищет, — след убранного
 * оформления. Проверяются обе стороны:
 *
 *  1. каждый класс из селекторов `base.css` код ставит на какой-то элемент;
 *  2. у каждого класса, который код ставит на элемент, есть правило — либо
 *     его ищут селектором (код или тесты): тогда это крючок, а не оформление.
 *
 * Заодно: переменные (`--x`) и анимации (`@keyframes`) объявлены и
 * используются, селекторы по `data-*` совпадают с тем, что пишет код,
 * картинки из `url(...)` лежат в `public/`.
 *
 * Какие классы «код ставит на элемент», определяет разбор исходников
 * компилятором TypeScript:
 *  • значение свойства `class` в атрибутах `el(...)`;
 *  • аргументы `classList.add/remove/toggle/contains/replace` и `setClass`;
 *  • любое слово строкового литерала с разделителем БЭМ (`__` или `--`):
 *    так видны классы, которые передаются параметром помощника
 *    (`row('oil', label, 'hud__row-value--oil')`).
 *
 * Имя класса нельзя склеивать из кусков (`card--${type}`): такой класс не
 * найти поиском по проекту, и этот тест его тоже не увидит.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const CSS_FILE = 'src/styles/base.css';

// --------------------------------------------------------------------- CSS

/** Комментарии заменяются пробелами: номера строк остаются настоящими. */
const css = readFileSync(join(root, CSS_FILE), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

interface Block {
  /** Текст перед `{`: селектор или заголовок at-правила. */
  prelude: string;
  line: number;
  /** Объявления блока (без вложенных блоков). */
  body: string;
}

/** Разбор на блоки: достаточно для плоского CSS с `@media` и `@keyframes`. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  const open: Block[] = [];
  let pending = '';
  let pendingLine = 1;
  let line = 1;
  for (const ch of text) {
    if (ch === '\n') line += 1;
    if (ch === '{') {
      const block: Block = { prelude: pending.trim().replace(/\s+/g, ' '), line: pendingLine, body: '' };
      blocks.push(block);
      open.push(block);
      pending = '';
    } else if (ch === '}') {
      const block = open.pop();
      if (block) block.body += pending;
      pending = '';
    } else if (ch === ';') {
      const block = open[open.length - 1];
      if (block) block.body += `${pending};`;
      pending = '';
    } else {
      if (pending.trim() === '' && ch.trim() !== '') pendingLine = line;
      pending += ch;
    }
  }
  return blocks;
}

const blocks = blocksOf(css);
const rules = blocks.filter((block) => !block.prelude.startsWith('@') && !/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(block.prelude));
const declarations = blocks.map((block) => block.body).join('\n');

/** Класс → строка первого правила с ним. */
const styled = new Map<string, number>();
/** Селекторы по атрибуту со значением: `[data-kind='launder']`. */
const attributeSelectors: Array<{ name: string; value: string; line: number }> = [];
for (const rule of rules) {
  for (const match of rule.prelude.matchAll(/\[([\w-]+)\s*=\s*['"]?([^'"\]]*)['"]?\]/g)) {
    attributeSelectors.push({ name: match[1]!, value: match[2]!, line: rule.line });
  }
  // Значения атрибутов могут содержать точку — к классам они не относятся.
  const selector = rule.prelude.replace(/\[[^\]]*\]/g, '');
  for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    if (!styled.has(match[1]!)) styled.set(match[1]!, rule.line);
  }
}

// --------------------------------------------------------------- исходники

const filesIn = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return filesIn(path);
    return name.endsWith('.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });

interface Site {
  file: string;
  line: number;
}
const at = (site: Site): string => `${site.file}:${site.line}`;

/** Класс → где код впервые ставит его на элемент. */
const assigned = new Map<string, Site>();
/** Имена классов, склеенные из кусков. */
const glued: string[] = [];
/** Имена, которые встречаются в селекторах вида `.name` (код и тесты). */
const queried = new Set<string>();
/** Все строковые литералы `src/`: по ним ищутся значения `data-*` и имена переменных. */
const sourceLiterals = new Set<string>();

const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/;
const BEM_NAME = /^[a-zA-Z][\w-]*(?:__|--)[\w-]+$/;
const CLASS_LIST_METHODS = new Set(['add', 'remove', 'toggle', 'contains', 'replace']);

function scan(file: string, collectAssignments: boolean): void {
  const text = readFileSync(join(root, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const siteOf = (node: ts.Node): Site => ({
    file,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  });
  const assign = (value: string, node: ts.Node): void => {
    for (const word of value.split(/\s+/)) {
      if (CLASS_NAME.test(word) && !assigned.has(word)) assigned.set(word, siteOf(node));
    }
  };
  /** Выражение, значение которого становится списком классов. */
  const classExpression = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      assign(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      // `a ${x}` и `${x} b` — отдельные слова; `a--${x}` — склейка.
      if (node.head.text !== '' && !/\s$/.test(node.head.text)) glued.push(`${at(siteOf(node))}: ${node.getText(source)}`);
      assign(node.head.text, node);
      for (const span of node.templateSpans) {
        if (span.literal.text !== '' && !/^\s/.test(span.literal.text)) glued.push(`${at(siteOf(node))}: ${node.getText(source)}`);
        assign(span.literal.text, node);
        classExpression(span.expression);
      }
    } else {
      ts.forEachChild(node, classExpression);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const match of node.text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) queried.add(match[1]!);
      if (collectAssignments) {
        sourceLiterals.add(node.text);
        for (const word of node.text.split(/\s+/)) {
          if (BEM_NAME.test(word) && !assigned.has(word)) assigned.set(word, siteOf(node));
        }
      }
    }
    if (collectAssignments) {
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        node.name.text === 'class'
      ) {
        classExpression(node.initializer);
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          CLASS_LIST_METHODS.has(callee.name.text) &&
          ts.isPropertyAccessExpression(callee.expression) &&
          callee.expression.name.text === 'classList'
        ) {
          node.arguments.forEach(classExpression);
        }
        if (ts.isIdentifier(callee) && callee.text === 'setClass' && node.arguments[1]) {
          classExpression(node.arguments[1]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const file of filesIn('src')) scan(file, true);
for (const file of filesIn('tests')) scan(file, false);

// ------------------------------------------------------------------- тесты

describe('стили и разметка (REVIEW C9)', () => {
  it('разбор видит и стили, и разметку', () => {
    // Защита от пустого прохода: сломанный разбор «подтвердил» бы что угодно.
    expect(styled.size).toBeGreaterThan(100);
    expect(assigned.size).toBeGreaterThan(100);
    expect(styled.has('card__buy')).toBe(true);
    expect(assigned.has('card__buy')).toBe(true);
    // Класс, который приходит параметром помощника, и класс из classList.
    expect(assigned.has('hud__row-value--oil')).toBe(true);
    expect(assigned.has('start--hidden')).toBe(true);
    expect(queried.has('card__buy')).toBe(true);
  });

  it('имена классов не склеиваются из кусков', () => {
    expect(glued).toEqual([]);
  });

  it('у каждого класса из стилей есть элемент', () => {
    const dead = [...styled]
      .filter(([name]) => !assigned.has(name))
      .map(([name, line]) => `.${name} (${CSS_FILE}:${line})`);
    expect(dead, 'правила для классов, которых нет в разметке').toEqual([]);
  });

  it('у каждого класса из разметки есть правило или тот, кто его ищет', () => {
    const orphans = [...assigned]
      .filter(([name]) => !styled.has(name) && !queried.has(name))
      .map(([name, site]) => `${name} (${at(site)})`);
    expect(orphans, 'классы без правила, которые никто не ищет селектором').toEqual([]);
  });

  it('селекторы по data-атрибутам совпадают с тем, что пишет код', () => {
    // `[data-kind='launder']` бессилен, если код пишет другое значение.
    const camel = (name: string): string =>
      name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const sources = filesIn('src').map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
    const unknown = attributeSelectors
      .filter(({ name, value }) => {
        const written = name.startsWith('data-')
          ? sources.includes(`'${name}'`) || new RegExp(`dataset\\.${camel(name)}\\b`).test(sources)
          : sources.includes(`'${name}'`);
        return !written || !sourceLiterals.has(value);
      })
      .map(({ name, value, line }) => `[${name}='${value}'] (${CSS_FILE}:${line})`);
    expect(unknown).toEqual([]);
  });

  it('переменные CSS объявлены и используются', () => {
    const defined = new Set([...declarations.matchAll(/(?:^|[;\s])(--[\w-]+)\s*:/g)].map((match) => match[1]!));
    const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!));
    // Переменную может задавать и код: `style.setProperty('--x', …)`.
    const fromCode = new Set([...sourceLiterals].filter((literal) => /^--[\w-]+$/.test(literal)));
    expect(defined.size).toBeGreaterThan(10);
    expect([...defined].filter((name) => !used.has(name)), 'объявлены, но не используются').toEqual([]);
    expect([...used].filter((name) => !defined.has(name) && !fromCode.has(name)), 'используются, но не объявлены').toEqual([]);
  });

  it('анимации объявлены и используются', () => {
    const keyframes = blocks
      .filter((block) => block.prelude.startsWith('@keyframes'))
      .map((block) => block.prelude.split(/\s+/)[1]!);
    // Имя — первое слово каждой анимации; запятые внутри `cubic-bezier(...)`
    // список не делят.
    const animated = [...declarations.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)].flatMap((match) =>
      match[1]!.replace(/\([^)]*\)/g, '').split(',').map((part) => part.trim().split(/\s+/)[0]!),
    );
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.filter((name) => !animated.includes(name)), 'кадры без анимации').toEqual([]);
    expect(animated.filter((name) => !keyframes.includes(name)), 'анимации без кадров').toEqual([]);
  });

  it('картинки стилей лежат в public и заданы путём от корня', () => {
    // Путь от корня (`/images/x.svg`) — способ сослаться на `public/`:
    // сборка переписывает его относительно файла стилей (`base: './'`),
    // что проверяет tests/build-paths.test.ts.
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((match) => match[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, url).toMatch(/^\/[^/]/);
      expect(existsSync(join(root, 'public', url)), `public${url}`).toBe(true);
    }
  });
});
