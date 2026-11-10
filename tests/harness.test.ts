/**
 * Проверки самой «обвязки» проекта: CI, деплой и npm-скрипты.
 * Ошибка здесь не ломает игру, но незаметно снимает защиту: плавающий тег
 * action, прогон без таймаута или скрипт-проверка, который не запускает
 * ни одного теста (REVIEW H3, H4, H5).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BALANCE_PROFILES } from '../src/core/simulator';
import { balanceProfiles } from './helpers/balance-profiles';

const root = resolve(__dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

const workflowDir = '.github/workflows';
const workflows = readdirSync(resolve(root, workflowDir))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, source: read(`${workflowDir}/${name}`) }));

/** Блоки заданий: имя → текст. Задания — ключи с отступом 2 под `jobs:`. */
function jobsOf(source: string): Map<string, string> {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const jobs = new Map<string, string>();
  if (start < 0) return jobs;
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, '');
    } else if (current) {
      jobs.set(current, `${jobs.get(current) ?? ''}${line}\n`);
    }
  }
  return jobs;
}

describe('GitHub Actions (REVIEW H3, H4)', () => {
  it('в репозитории есть CI и деплой', () => {
    expect(workflows.map((workflow) => workflow.name).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('каждый action закреплён по SHA коммита с версией в комментарии', () => {
    let total = 0;
    for (const { name, source } of workflows) {
      const uses = source.split('\n').filter((line) => /^\s*(-\s*)?uses:/.test(line));
      expect(uses.length, name).toBeGreaterThan(0);
      for (const line of uses) {
        total += 1;
        // Тег вида @v7 владелец action может передвинуть на другой коммит.
        expect(line.trim(), `${name}: ${line.trim()}`)
          .toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      }
    }
    expect(total).toBeGreaterThanOrEqual(8);
  });

  it('у каждого задания есть таймаут', () => {
    for (const { name, source } of workflows) {
      const jobs = jobsOf(source);
      expect(jobs.size, name).toBeGreaterThan(0);
      for (const [job, body] of jobs) {
        expect(body, `${name}: задание ${job}`).toMatch(/^ {4}timeout-minutes: \d+\s*$/m);
      }
    }
  });

  it('CI: одна проверка на ветку, токен только на чтение', () => {
    const ci = read(`${workflowDir}/ci.yml`);
    expect(ci).toMatch(/^concurrency:\n(?: {2}.*\n)*? {2}group: ci-.*github\.head_ref \|\| github\.ref_name/m);
    expect(ci).toMatch(/^ {2}cancel-in-progress: true$/m);
    expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
    // PR из форка не должен делить группу с нашей веткой с тем же именем.
    expect(ci).toContain('github.event.pull_request.head.repo.full_name || github.repository');
    expect(jobsOf(ci).has('build-and-test')).toBe(true);
  });

  it('деплой: только проверенная вершина main, только push этого репозитория', () => {
    const deploy = read(`${workflowDir}/deploy.yml`);
    expect(deploy).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(deploy).toContain("github.event.workflow_run.event == 'push'");
    expect(deploy).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    // Поздно завершившийся CI старого коммита не выкладывает старую сборку.
    expect(deploy).toContain('git fetch --no-tags --depth=1 origin main');
    expect(deploy).toMatch(/\[ "\$main_sha" = "\$TESTED_SHA" \]/);
    expect(deploy).toContain("needs.build.outputs.fresh == 'true'");
    // Сборка, настройка Pages и выгрузка артефакта пропускаются для старого коммита.
    const build = jobsOf(deploy).get('build') ?? '';
    const guarded = build.split('\n').filter((line) => line.includes("steps.head.outputs.fresh == 'true'"));
    expect(guarded.length).toBeGreaterThanOrEqual(5);
  });
});

describe('npm-скрипты проверок (REVIEW H5)', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

  /** Названия тестов файла: it('…') и it("…"). */
  const titlesOf = (path: string): string[] =>
    [...read(path).matchAll(/\bit\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) => match[2]);

  it('lint:strings действительно запускает тест, а не ноль тестов', () => {
    const script = scripts['lint:strings'];
    expect(script).toBeDefined();
    const file = /vitest run (\S+)/.exec(script)?.[1];
    const pattern = /-t "([^"]+)"/.exec(script)?.[1];
    expect(file).toBeDefined();
    expect(pattern).toBeDefined();
    // Раньше шаблон «зашитых русских строк» не совпадал с названием теста
    // (в нём «зашитых» стоит в кавычках-ёлочках): скрипт пропускал все 36
    // тестов и завершался успешно.
    const matched = titlesOf(file!).filter((title) => title.includes(pattern!));
    expect(matched.length, `шаблон «${pattern}» в ${file}`).toBeGreaterThanOrEqual(1);
    expect(matched.some((title) => title.includes('в коде интерфейса нет'))).toBe(true);
  });

  it('скрипт balance запускает все балансовые тесты', () => {
    // Vitest отбирает файлы по подстроке пути: один фильтр покрывает весь
    // набор, и новый balance-файл не выпадает из `npm run balance`.
    const filter = /vitest run (\S+)/.exec(scripts.balance)?.[1];
    expect(filter).toBe('tests/balance');
    const balanceFiles = readdirSync(resolve(root, 'tests'))
      .filter((name) => name.startsWith('balance') && name.endsWith('.test.ts'));
    expect(balanceFiles.sort()).toEqual([
      'balance-content.test.ts',
      'balance-growth.test.ts',
      'balance-pace.test.ts',
      'balance-profiles-extra.test.ts',
      'balance-profiles.test.ts',
    ]);
  });
});

describe('профили баланса (REVIEW H1, AUDIT F08)', () => {
  it('профилей четыре, имена и сиды не повторяются', () => {
    expect(BALANCE_PROFILES).toHaveLength(4);
    expect(new Set(BALANCE_PROFILES.map((profile) => profile.name)).size).toBe(4);
    expect(new Set(BALANCE_PROFILES.map((profile) => profile.options.seed)).size).toBe(4);
    expect(BALANCE_PROFILES.filter((profile) => profile.options.strategy === 'optimizer')).toHaveLength(1);
  });

  it('каждый профиль прогоняется ровно в одном тест-файле', () => {
    // Раньше базовый файл гонял все четыре профиля, а дополнительный
    // повторял два из них: одни и те же симуляции шли дважды.
    const base = balanceProfiles('base');
    const extra = balanceProfiles('extra');
    expect(base.length).toBeGreaterThan(0);
    expect(extra.length).toBeGreaterThan(0);
    expect([...base, ...extra]).toEqual([...BALANCE_PROFILES]);

    const runsOf = (file: string): string[] =>
      [...read(file).matchAll(/describeBalanceProfiles\(\s*'(base|extra)'/g)].map((match) => match[1]);
    expect(runsOf('tests/balance-profiles.test.ts')).toEqual(['base']);
    expect(runsOf('tests/balance-profiles-extra.test.ts')).toEqual(['extra']);
    // Других запусков профилей в тестах нет.
    const others = readdirSync(resolve(root, 'tests'))
      .filter((name) => name.endsWith('.test.ts') && !name.startsWith('balance-profiles') && name !== 'harness.test.ts')
      .filter((name) => read(`tests/${name}`).includes('describeBalanceProfiles('));
    expect(others).toEqual([]);
  });
});
