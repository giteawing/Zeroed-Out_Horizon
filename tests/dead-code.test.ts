/**
 * Мёртвый код (REVIEW C1, C12).
 *
 * Функция, которой игра не пользуется, но которую вызывают тесты, создаёт
 * видимость проверенной механики: `sellOil`, `saleProceeds`, `exportTonnes` и
 * `netForInterval` проходили свои тесты, пока игра продавала нефть другим
 * кодом. Здесь это ловится для всего `src/`: на каждый экспорт и на
 * каждый публичный член класса должна быть ссылка из кода игры или из
 * скриптов разработчика. Ссылки из тестов не считаются.
 *
 * Поиск ссылок выполняет языковой сервис TypeScript — тот же «Найти все
 * ссылки», что в редакторе, поэтому одноимённые локальные переменные и
 * свойства чужих объектов с экспортом не путаются.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '..');

const filesIn = (dir: string, pattern: RegExp): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return filesIn(path, pattern);
    return pattern.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });

/** Код игры и инструменты разработчика: оба — законные потребители ядра. */
const sourceFiles = filesIn('src', /\.ts$/);
const consumerFiles = [...sourceFiles, ...filesIn('scripts', /\.ts$/)];
const testFiles = filesIn('tests', /\.ts$/);

/**
 * Публичные члены классов, на которые код игры не ссылается по имени класса.
 * Причины две, и обе нужно называть:
 *  - «окно Escape»: объект передаётся в список окон `main.ts` как
 *    `{ visible, close }` — поиск ссылок такие обращения с классом не связывает;
 *  - «наблюдение»: геттер без логики, по которому тест видит внутреннее
 *    состояние. Тест проверяет, что такой член действительно читают тесты.
 */
const ALLOWED_MEMBERS: Record<string, 'окно Escape' | 'наблюдение'> = {
  'src/ui/asset-details.ts#AssetDetails.visible': 'окно Escape',
  'src/ui/dev.ts#DevMenu.visible': 'окно Escape',
  'src/ui/settings.ts#Settings.visible': 'окно Escape',
  'src/ui/wealth.ts#Wealth.visible': 'окно Escape',
  'src/audio/sound.ts#SoundEngine.isEnabled': 'наблюдение',
  'src/core/clock.ts#FrameClock.pendingMs': 'наблюдение',
  'src/ui/shop.ts#Shop.cardCount': 'наблюдение',
};

interface Declared {
  /** `путь#Имя` или `путь#Класс.член`. */
  id: string;
  name: string;
  file: string;
  position: number;
  member: boolean;
}

function createService(): ts.LanguageService {
  const absolute = consumerFiles.map((file) => join(root, file));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    resolveJsonModule: true,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    types: ['node'],
  };
  return ts.createLanguageService({
    getScriptFileNames: () => absolute,
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) =>
      ts.sys.fileExists(name) ? ts.ScriptSnapshot.fromString(readFileSync(name, 'utf8')) : undefined,
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  });
}

/** Экспорты верхнего уровня и публичные члены экспортируемых классов файла. */
function declaredIn(source: ts.SourceFile, file: string): Declared[] {
  const found: Declared[] = [];
  const add = (node: ts.Node, name: string, owner?: string): void => {
    found.push({
      id: `${file}#${owner ? `${owner}.` : ''}${name}`,
      name,
      file,
      position: node.getStart(source),
      member: owner !== undefined,
    });
  };
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name, declaration.name.text);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name
    ) {
      add(statement.name, statement.name.text);
      continue;
    }
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;
    const owner = statement.name.text;
    add(statement.name, owner);
    for (const member of statement.members) {
      if (!(ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member) ||
        ts.isPropertyDeclaration(member))) continue;
      const hidden = ts.getModifiers(member)?.some((modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
      if (hidden || !ts.isIdentifier(member.name)) continue;
      add(member.name, member.name.text, owner);
    }
  }
  return found;
}

describe('в игре нет кода, которым пользуются только тесты (REVIEW C1)', () => {
  const service = createService();
  const program = service.getProgram()!;
  const declared = sourceFiles.flatMap((file) => declaredIn(program.getSourceFile(join(root, file))!, file));

  /** Сколько раз на объявление ссылаются из кода игры и скриптов (само объявление не в счёт). */
  const usesOf = (item: Declared): number => {
    let uses = 0;
    for (const group of service.findReferences(join(root, item.file), item.position) ?? []) {
      for (const reference of group.references) if (!reference.isDefinition) uses += 1;
    }
    return uses;
  };
  const unused = declared.filter((item) => usesOf(item) === 0);

  it('анализ видит код: экспорты и члены классов найдены', () => {
    expect(sourceFiles.length).toBeGreaterThan(30);
    expect(declared.length).toBeGreaterThan(200);
    expect(declared.some((item) => item.id === 'src/core/game.ts#Game.buy')).toBe(true);
    expect(declared.some((item) => item.id === 'src/core/economy/sales.ts#allocateBatch')).toBe(true);
    // Используемый код не попадает в список: проверка не красит всё подряд.
    expect(unused.some((item) => item.id === 'src/core/game.ts#Game.buy')).toBe(false);
    expect(unused.some((item) => item.id === 'src/core/economy/derived.ts#computeDerived')).toBe(false);
  });

  it('на каждый экспорт ссылается код игры или скрипт', () => {
    // Что делать, если тест упал: подключить функцию к игре, удалить её вместе
    // с её тестами или убрать `export`, если она нужна только своему файлу.
    expect(unused.filter((item) => !item.member).map((item) => item.id)).toEqual([]);
  });

  it('на каждый публичный член класса ссылается код игры — или он в списке исключений', () => {
    // Что делать, если тест упал: вызвать метод из игры, сделать его `private`,
    // удалить или внести в ALLOWED_MEMBERS с причиной.
    const offenders = unused
      .filter((item) => item.member && !(item.id in ALLOWED_MEMBERS))
      .map((item) => item.id);
    expect(offenders).toEqual([]);
  });

  it('список исключений не устарел', () => {
    const unusedIds = new Set(unused.map((item) => item.id));
    const stale = Object.keys(ALLOWED_MEMBERS).filter((id) => !unusedIds.has(id));
    // Член класса удалён или на него появилась прямая ссылка — запись лишняя.
    expect(stale).toEqual([]);

    const tests = testFiles.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
    for (const [id, reason] of Object.entries(ALLOWED_MEMBERS)) {
      const member = id.slice(id.lastIndexOf('.') + 1);
      if (reason === 'наблюдение') {
        expect(tests, `${id}: «наблюдение», которое не читает ни один тест`).toMatch(new RegExp(`\\.${member}\\b`));
      } else {
        // Список окон в main.ts действительно обращается к этому члену.
        expect(main, id).toMatch(new RegExp(`Array<\\{[^}]*\\b${member}\\b`));
      }
    }
  });
});

describe('разметка не собирается из строк (REVIEW C12)', () => {
  /** Исходник без комментариев: в них упоминать innerHTML можно. */
  const code = (file: string): string =>
    readFileSync(join(root, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('в src/ нет innerHTML, outerHTML, insertAdjacentHTML и document.write', () => {
    // Тексты приходят из texts.json: пока узлы создаются через textContent,
    // подменённый JSON не может стать разметкой или скриптом.
    const offenders = sourceFiles
      .filter((file) => /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/.test(code(file)))
      .map((file) => relative(root, join(root, file)));
    expect(offenders).toEqual([]);
  });
});
