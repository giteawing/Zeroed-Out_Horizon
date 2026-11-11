/**
 * Тексты ↔ код (REVIEW H6, C2).
 *
 * `Texts.get()` при опечатке возвращает сам ключ, а лишняя строка в
 * `texts.json` ничему не мешает — поэтому обе ошибки ничем себя не выдают:
 * игрок видит «hud.exportRail» вместо подписи, а автор правит текст,
 * которого нет на экране. Здесь проверяются обе стороны:
 *
 *  1. каждый ключ, который код запрашивает, есть в `texts.json`;
 *  2. каждая строка `texts.json` кем-то запрашивается.
 *
 * Обращения к текстам ищет разбор исходников компилятором TypeScript, а не
 * регулярное выражение: так видны ключи в условных выражениях
 * (`cond ? 'a.b' : 'a.c'`), в локальных константах и в помощниках вида
 * `t = (key) => texts.get(`shop.${key}`)`.
 *
 * Ключ, который собирается из данных (`wells.${kind}`), нельзя проверить по
 * исходнику. Такие обращения перечислены в таблице DYNAMIC вместе с
 * источником значений — настоящим списком из ядра или конфигурации.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadContent } from '../src/core/content';
import { CHANNELS } from '../src/core/economy';
import { SPILL_PLACES } from '../src/core/game';

const root = resolve(__dirname, '..');
const content = loadContent();

// --------------------------------------------------------------- texts.json

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type LeafKind = 'string' | 'list';

const textsJson = JSON.parse(readFileSync(join(root, 'src/content/texts.json'), 'utf8')) as Json;

/** Лист — строка или массив целиком: массив запрашивают одним обращением. */
function leavesOf(node: Json, path: string[] = []): Array<{ path: string; kind: LeafKind }> {
  if (typeof node === 'string') return [{ path: path.join('.'), kind: 'string' }];
  if (Array.isArray(node)) return [{ path: path.join('.'), kind: 'list' }];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leavesOf(value, [...path, key]));
  }
  throw new Error(`texts.json: по пути «${path.join('.')}» не строка, не список и не раздел`);
}

const leaves = leavesOf(textsJson);
const leafKind = new Map(leaves.map((leaf) => [leaf.path, leaf.kind]));

// ---------------------------------------------------------------- исходники

const filesIn = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return filesIn(path);
    return name.endsWith('.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });

const sourceFiles = filesIn('src');

interface Site {
  file: string;
  line: number;
}
/** Обращение с ключом, известным из исходника. */
interface KeyUse extends Site {
  key: string;
  kind: LeafKind;
}
/** Обращение, ключ которого собирается во время игры. */
interface DynamicUse extends Site {
  prefix: string;
  code: string;
}
/** Функция, которая дописывает к своему аргументу префикс и идёт в тексты. */
interface Helper {
  file: string;
  name: string;
  prefix: string;
  index: number;
  kind: LeafKind;
  /** Есть вызовы, аргумент которых по исходнику не вычислить. */
  indirect: boolean;
}

const keyUses: KeyUse[] = [];
const dynamicUses: DynamicUse[] = [];
const helpers: Helper[] = [];
/** Строковые литералы каждого файла: комментарии сюда не попадают. */
const literalsByFile = new Map<string, Set<string>>();
/** Прямые обращения `texts.data.раздел.ключ`. */
const dataPaths: Array<Site & { path: string }> = [];
/** Имена переменных и полей типа `Texts`. */
const textsNames = new Set<string>();

type FunctionLike = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration;

const isFunctionLike = (node: ts.Node): node is FunctionLike =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);

function analyse(file: string): void {
  const source = ts.createSourceFile(
    file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS,
  );
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const site = (node: ts.Node): Site => ({ file, line: lineOf(node) });

  const literals = new Set<string>();
  literalsByFile.set(file, literals);
  /** `const имя = …` файла: по ним раскрывается ключ, положенный в константу. */
  const constants = new Map<string, ts.Expression[]>();
  const calls: ts.CallExpression[] = [];

  const collect = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      constants.set(node.name.text, [...(constants.get(node.name.text) ?? []), node.initializer]);
    }
    if (ts.isCallExpression(node)) calls.push(node);
    // Переменная, параметр или поле с типом `Texts`.
    if (
      (ts.isParameter(node) || ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node) ||
        ts.isPropertySignature(node)) &&
      node.type && ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === 'Texts'
    ) {
      textsNames.add(node.name.getText(source));
    }
    // texts.data.раздел.ключ — берём самую длинную цепочку.
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const match = /(?:^|\.)texts\.data\.([\w.]+)$/.exec(node.getText(source));
      if (match) dataPaths.push({ ...site(node), path: match[1] });
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  /**
   * Строки, которые может дать выражение, если это видно из исходника:
   * литерал, тернарный выбор из литералов или константа с таким значением.
   */
  const literalsIn = (expr: ts.Expression, seen: Set<string> = new Set()): string[] | null => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
    if (ts.isParenthesizedExpression(expr)) return literalsIn(expr.expression, seen);
    if (ts.isConditionalExpression(expr)) {
      const whenTrue = literalsIn(expr.whenTrue, seen);
      const whenFalse = literalsIn(expr.whenFalse, seen);
      return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
    }
    if (ts.isIdentifier(expr) && !seen.has(expr.text)) {
      const declared = constants.get(expr.text);
      // Одноимённые константы в разных функциях — не угадываем, какая из них.
      if (declared?.length === 1) return literalsIn(declared[0], new Set([...seen, expr.text]));
    }
    return null;
  };

  /** Функция, параметром которой является идентификатор, и номер параметра. */
  const parameterOf = (id: ts.Identifier): { fn: FunctionLike; index: number } | null => {
    for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
      if (!isFunctionLike(node)) continue;
      const index = node.parameters.findIndex(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === id.text,
      );
      if (index >= 0) return { fn: node, index };
    }
    return null;
  };
  const nameOf = (fn: FunctionLike): string | null => {
    if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText(source);
    if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
    return null;
  };

  /**
   * Разбор аргумента-ключа. `prefix` — то, что к аргументу допишет помощник.
   * Возвращает false, если ключ по исходнику вычислить нельзя.
   */
  const useKey = (expr: ts.Expression, prefix: string, kind: LeafKind): boolean => {
    const known = literalsIn(expr);
    if (known) {
      for (const text of known) keyUses.push({ ...site(expr), key: prefix + text, kind });
      return true;
    }
    // Ключ — параметр функции: сама функция становится помощником.
    let head = '';
    let id: ts.Expression = expr;
    if (
      ts.isTemplateExpression(expr) && expr.templateSpans.length === 1 &&
      expr.templateSpans[0].literal.text === ''
    ) {
      head = expr.head.text;
      id = expr.templateSpans[0].expression;
    }
    if (ts.isIdentifier(id)) {
      const parameter = parameterOf(id);
      const name = parameter && nameOf(parameter.fn);
      if (parameter && name) {
        const known = helpers.some((helper) => helper.file === file && helper.name === name);
        if (!known) {
          helpers.push({ file, name, prefix: prefix + head, index: parameter.index, kind, indirect: false });
        }
        return true;
      }
    }
    return false;
  };

  const isTexts = (expr: ts.Expression): boolean => /(?:^|\.)texts$/.test(expr.getText(source));

  for (const call of calls) {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee) || !isTexts(callee.expression)) continue;
    const method = callee.name.text;
    if (method === 'get' && call.arguments.length > 0) {
      const key = call.arguments[0];
      if (!useKey(key, '', 'string')) {
        dynamicUses.push({
          ...site(key),
          prefix: ts.isTemplateExpression(key) ? key.head.text : '',
          code: key.getText(source),
        });
      }
    }
    if (method === 'list' && call.arguments.length >= 2) {
      const section = literalsIn(call.arguments[0]);
      const key = call.arguments[1];
      if (section?.length === 1) {
        if (!useKey(key, `${section[0]}.`, 'list')) {
          dynamicUses.push({ ...site(key), prefix: `${section[0]}.`, code: call.getText(source) });
        }
      } else {
        dynamicUses.push({ ...site(call), prefix: '', code: call.getText(source) });
      }
    }
  }

  // Вызовы помощников. Помощник может вызывать помощника, поэтому идём до
  // тех пор, пока появляются новые.
  const done = new Set<Helper>();
  for (;;) {
    const pending = helpers.filter((helper) => helper.file === file && !done.has(helper));
    if (pending.length === 0) break;
    for (const helper of pending) {
      done.add(helper);
      for (const call of calls) {
        const callee = call.expression;
        const called = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword
            ? callee.name.text
            : null;
        if (called !== helper.name || call.arguments.length <= helper.index) continue;
        if (!useKey(call.arguments[helper.index], helper.prefix, helper.kind)) helper.indirect = true;
      }
    }
  }
}

for (const file of sourceFiles) analyse(file);

/**
 * Ключи, которые собираются во время игры: префикс → все значения, которые
 * игра может подставить. Значения берутся из тех же списков, что и в игре.
 */
const DYNAMIC: Record<string, () => readonly string[]> = {
  // Класс скважины: событие бурения, строка эффекта, «Правила».
  'wells.': () => content.config.oil.wells.classes.map((cls) => cls.key),
  // Вкладки магазина: вкладка есть, пока в ней есть хоть одна покупка.
  'tabs.': () => [...new Set(content.upgrades.map((upgrade) => upgrade.tab))],
  // Рынки сбыта: поля потоков и подпись рынка на карточке.
  'flows.': () => CHANNELS,
  'sales.': () => CHANNELS,
  // Место разлива выбирает ядро из своего списка.
  'spill.places.': () => SPILL_PLACES,
};

/**
 * Разделы, которые читаются целиком методами `Texts`, а не по ключу:
 *  - `upgrades` — `upgradeName(id)`: названия покупок для журнала;
 *  - `achievements.list` — `achievementName(id)`;
 *  - `news` — `newsCategories()`: случайная новость берёт любую рубрику.
 * То, что методы вызываются, проверяет tests/dead-code.test.ts.
 */
const READ_WHOLE = ['upgrades.', 'achievements.list', 'news.'];

describe('тексты и код согласованы (REVIEW H6)', () => {
  const allLiterals = new Set([...literalsByFile.values()].flatMap((set) => [...set]));
  const at = (use: Site): string => `${use.file}:${use.line}`;

  it('разбор видит обращения к текстам', () => {
    expect(sourceFiles.length).toBeGreaterThan(30);
    expect(leaves.length).toBeGreaterThan(400);
    expect(keyUses.length).toBeGreaterThan(300);
    expect(keyUses.some((use) => use.key === 'shop.buy')).toBe(true);
    // Помощник строки эффекта: t('effectStorage') → shop.effectStorage.
    expect(helpers.some((helper) => helper.file === 'src/ui/effect-line.ts' && helper.prefix === 'shop.')).toBe(true);
    expect(keyUses.some((use) => use.key === 'shop.effectStorage' && use.file === 'src/ui/effect-line.ts')).toBe(true);
    // Ключ в тернарном выражении и ключ в константе.
    expect(keyUses.some((use) => use.key === 'save.corruptBackupFailed')).toBe(true);
    expect(keyUses.some((use) => use.key === 'shop.scopeProducts')).toBe(true);
    // Объект текстов везде называется одинаково — иначе обращения не найти.
    expect([...textsNames]).toEqual(['texts']);
    // Два помощника с одним именем в файле разбор не различает.
    const names = helpers.map((helper) => `${helper.file}#${helper.name}`);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it('каждый ключ, который запрашивает код, есть в texts.json', () => {
    const missing = keyUses
      .filter((use) => leafKind.get(use.key) !== use.kind)
      .map((use) => `${at(use)}: ${use.key}`);
    expect(missing).toEqual([]);

    const badData = dataPaths
      .filter(({ path }) => !leaves.some((leaf) => leaf.path === path || leaf.path.startsWith(`${path}.`) ||
        path.startsWith(`${leaf.path}.`)))
      .map((use) => `${at(use)}: texts.data.${use.path}`);
    expect(badData).toEqual([]);
  });

  it('ключи, которые собираются во время игры, объявлены и существуют', () => {
    // Новое обращение вида texts.get(`раздел.${значение}`) нужно внести в
    // DYNAMIC и указать, откуда берутся значения.
    const undeclared = dynamicUses
      .filter((use) => !(use.prefix in DYNAMIC))
      .map((use) => `${at(use)}: ${use.code}`);
    expect(undeclared).toEqual([]);

    for (const [prefix, values] of Object.entries(DYNAMIC)) {
      expect(dynamicUses.some((use) => use.prefix === prefix), `${prefix}: обращения больше нет`).toBe(true);
      expect(values().length, prefix).toBeGreaterThan(0);
      for (const value of values()) {
        expect(leafKind.get(prefix + value), `${prefix}${value}`).toBe('string');
      }
    }
  });

  it('помощники получают ключ, который видно в исходнике', () => {
    // Иначе «ключ используется» пришлось бы угадывать по совпадению слов.
    // Разделы, которые читаются целиком, сверяются ниже по содержимому.
    const indirect = helpers
      .filter((helper) => helper.indirect && !READ_WHOLE.includes(helper.prefix))
      .map((helper) => `${helper.file}#${helper.name}`);
    expect(indirect).toEqual([]);
  });

  it('в texts.json нет строк, которые игра не показывает', () => {
    const requested = new Set(keyUses.map((use) => use.key));
    const dynamic = new Set(Object.entries(DYNAMIC).flatMap(([prefix, values]) =>
      values().map((value) => prefix + value)));
    const read = dataPaths.map((use) => use.path);

    const unused = leaves
      .map((leaf) => leaf.path)
      .filter((path) =>
        !requested.has(path) &&
        // Ключ целиком лежит в таблице или передаётся дальше как значение.
        !allLiterals.has(path) &&
        !dynamic.has(path) &&
        !read.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)) &&
        !READ_WHOLE.some((prefix) => path === prefix || path.startsWith(prefix)));
    // Что делать, если тест упал: показать строку в игре или удалить её из
    // texts.json. Оставлять «на будущее» не нужно — git помнит.
    expect(unused).toEqual([]);
  });

  it('названия покупок в texts.json — это покупки игры', () => {
    const names = (textsJson as { upgrades: Record<string, string> }).upgrades;
    const ids = content.upgrades.map((upgrade) => upgrade.id).sort();
    expect(Object.keys(names).sort()).toEqual(ids);
  });
});
