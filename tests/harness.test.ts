/**
 * Проверки самой «обвязки» проекта: CI, деплой и npm-скрипты.
 * Ошибка здесь не ломает игру, но незаметно снимает защиту: плавающий тег
 * action, прогон без таймаута или скрипт-проверка, который не запускает
 * ни одного теста (REVIEW H3, H4, H5).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EFFECT_FIELDS, loadContent } from '../src/core/content';
import {
  INVESTMENT_RATE_MAX_PERCENT,
  INVESTMENT_RATE_MIN_PERCENT,
  INVESTMENT_YEAR_DAYS,
  computeDerived,
} from '../src/core/economy';
import { formatMoney, formatNumber } from '../src/core/format';
import { BALANCE_PROFILES } from '../src/core/simulator';
import { createInitialState } from '../src/core/state';
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

describe('инструкции совпадают с настройками проекта (REVIEW H7, AUDIT F07)', () => {
  const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
  const majorOf = (name: string): string => {
    const version = pkg.devDependencies[name];
    expect(version, name).toBeDefined();
    return /(\d+)\./.exec(version)![1];
  };

  it('AGENTS.md называет установленные мажорные версии инструментов', () => {
    const stack = /^- TypeScript [^\n]*Vitest[^\n]*$/m.exec(read('AGENTS.md'))?.[0];
    expect(stack).toBeDefined();
    expect(stack).toContain(`Vite ${majorOf('vite')},`);
    expect(stack).toContain(`Vitest ${majorOf('vitest')},`);
    expect(stack).toContain(`Playwright ${majorOf('@playwright/test')}.`);
    const typescript = /(\d+\.\d+)\./.exec(pkg.devDependencies.typescript)![1];
    expect(stack).toContain(`TypeScript ${typescript},`);
  });

  it('инструментальные зависимости закреплены точной версией', () => {
    // Диапазон вида ^3.2.7 при обновлении lock-файла молча меняет версию
    // раннера; точная версия меняется только осознанным коммитом.
    expect(pkg.devDependencies.vitest).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('навык тестирования описывает тот же пул Vitest, что и vitest.config.ts', () => {
    const config = read('vitest.config.ts');
    const pool = /pool: '(\w+)'/.exec(config)?.[1];
    const workers = /maxWorkers: (\d+)/.exec(config)?.[1];
    expect(pool).toBeDefined();
    expect(workers).toBeDefined();
    const skill = read('.agents/skills/testing-regressions/SKILL.md');
    expect(skill).toContain(`pool: '${pool}'`);
    const mentioned = [...skill.matchAll(/maxWorkers: (\d+)/g)].map((match) => match[1]);
    expect(mentioned.length).toBeGreaterThan(0);
    expect(new Set(mentioned)).toEqual(new Set([workers]));
  });

  it('README называет коридор мировой цены из config.worldPrice (REVIEW B5)', () => {
    const { min, max } = loadContent().config.worldPrice;
    const comma = (value: number): string => String(value).replace('.', ',');
    const percent = (value: number): number => Math.round(Math.abs(value - 1) * 100);
    const readme = read('README.md');
    expect(readme).toContain(`${comma(min)}–${comma(max)}`);
    expect(readme).toContain(`от −${percent(min)} % до +${percent(max)} %`);
    // Раньше README обещал симметричные ±30 %.
    expect(readme).not.toMatch(/±\s*30/);
  });

  it('README и ECONOMY описывают «Авто» числами из конфига (REVIEW A3, B2)', () => {
    const { config, byId } = loadContent();
    const share = config.oil.refineryYield;
    const comma = (value: number): string => String(Math.round(value * 100) / 100).replace('.', ',');
    const readme = read('README.md');
    expect(readme).toContain(`${Math.round(share * 100)} % от цены`);
    expect(readme).toContain('config.oil.refineryYield');
    // Прежняя формулировка не говорила, по какому правилу «Авто» выбирает канал.
    expect(readme).not.toContain('с учётом\n   цен и физических ограничений');

    const economy = read('docs/ECONOMY.md');
    const domestic = config.product.domesticPriceFactor;
    const exported = config.product.exportPriceFactor;
    expect(economy).toContain(`${comma(share)} × ${comma(domestic)} = ${comma(share * domestic)}`);
    expect(economy).toContain(`${comma(share)} × ${comma(exported)} = ${comma(share * exported)}`);

    // Уровень девальвации, с которого экспорт сырья дороже продуктов внутри страны.
    const step = 1 + (byId.get('p_devalue_currency')?.effect.exchangeRateDevaluation ?? 0);
    expect(step).toBeGreaterThan(1);
    const crudeExport = config.oil.channels.export.priceFactor * config.exchangeRate.initial;
    let level = 0;
    while (crudeExport * Math.pow(step, level) <= share * domestic) level++;
    const superscript = String(level).replace(/\d/g, (digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]!);
    expect(economy).toContain(`${comma(step)}${superscript} ≈ ${comma(Math.pow(step, level))}`);
    expect(level).toBeLessThanOrEqual(byId.get('p_devalue_currency')!.maxLevel);
  });

  it('README и ECONOMY описывают договоры, потолок добычи и проценты числами из данных (REVIEW A5, B1)', () => {
    const content = loadContent();
    const { config, upgrades } = content;
    const comma = (value: number, digits: number): string => value.toFixed(digits).replace('.', ',');
    const economy = read('docs/ECONOMY.md');
    const readme = read('README.md');

    // Множитель добычи от договоров: по каждому направлению и общий предел.
    const total = (channel: 'contract' | 'export'): number => upgrades
      .filter((def) => def.type === 'sell' && def.effect.percent && (def.effect.channel ?? 'contract') === channel)
      .reduce((sum, def) => sum + (def.effect.percent! / 100) * def.maxLevel, 0);
    const state = createInitialState(config, 1);
    for (const def of upgrades) if (def.type === 'sell') state.levels[def.id] = def.maxLevel;
    const maxBoost = computeDerived(config, upgrades, state, [], content).salesVolumeMultiplier;
    expect(maxBoost).toBeCloseTo(1 + Math.max(total('contract'), total('export')), 9);
    const section = economy.slice(economy.indexOf('## Договоры о сбыте и добыча'));
    expect(section.length).toBeGreaterThan(100);
    expect(section).toContain('salesVolumeMultiplier');
    expect(section).toContain(`×${comma(1 + total('contract'), 2)}`);
    expect(section).toContain(`×${comma(1 + total('export'), 2)}`);
    expect(readme).toContain(`×${formatNumber(maxBoost)}`);

    // Потолок добычи.
    const cap = `${formatMoney(config.oil.maxProductionPerSecond, '').trim()} т/с`;
    expect(economy).toContain('## Потолок добычи');
    expect(economy).toContain(cap);
    expect(economy).toContain('oil.maxProductionPerSecond');
    expect(readme).toContain(cap);

    // Проценты на остаток: шкала из ядра и то, до чего хватает влияния в магазине.
    const givers = createInitialState(config, 1);
    for (const def of upgrades) if (def.effect.influence) givers.levels[def.id] = def.maxLevel;
    const attainable = computeDerived(config, upgrades, givers, [], content);
    expect(economy).toContain(`от ${INVESTMENT_RATE_MIN_PERCENT} % до ${INVESTMENT_RATE_MAX_PERCENT} % годовых`);
    expect(economy).toContain(`${INVESTMENT_YEAR_DAYS} игровых суток`);
    expect(economy).toContain(`влиянии ${config.influence.cap}`);
    expect(economy).toContain(`${attainable.influence} влияния`);
    expect(economy).toContain(`${comma(attainable.investmentRatePercent, 1)} % годовых`);
    expect(economy).toContain(`скидка на штраф ${comma((1 - attainable.fineFactor) * 100, 0)} %`);

    // «Откуда берутся деньги»: темп выплат в базах выплаты за секунду.
    const bankScale = 1 + upgrades
      .filter((def) => def.type === 'taxCut' && def.effect.bankScale)
      .reduce((sum, def) => sum + def.effect.bankScale! * def.maxLevel, 0);
    const oneShots = upgrades.filter((def) => def.type === 'oneShot' && !def.effect.sellsOil);
    const periodicRate = upgrades
      .filter((def) => def.type === 'periodic')
      .reduce((sum, def) => sum + (def.effect.value! * def.maxLevel) / def.effect.seconds!, 0);
    const bankRate = oneShots
      .filter((def) => def.effect.launder)
      .reduce((sum, def) => sum + (def.effect.value! * bankScale) / def.cooldownSeconds!, 0);
    const taxedRate = oneShots
      .filter((def) => !def.effect.launder)
      .reduce((sum, def) => sum + def.effect.value! / def.cooldownSeconds!, 0);
    const money = economy.slice(economy.indexOf('## Откуда берутся деньги'));
    expect(money.length).toBeGreaterThan(100);
    expect(money).toContain(`| ${comma(periodicRate, 2)} | нет |`);
    expect(money).toContain(`×${comma(bankScale, 1)} | ${comma(bankRate, 2)} | нет |`);
    expect(money).toContain(`| ${comma(taxedRate, 2)} | да |`);

    // Навык balance-tuning повторяет те же числа: они не должны устареть.
    const skill = read('.agents/skills/balance-tuning/SKILL.md');
    expect(skill).toContain(`до ×${comma(maxBoost, 2)}`);
    expect(skill).toContain(
      `Влияния в магазине — ${attainable.influence}\nпри потолке \`influence.cap\` ${config.influence.cap}.`,
    );
  });

  it('таблица полей effect в ECONOMY совпадает с проверкой контента (REVIEW A4)', () => {
    const economy = read('docs/ECONOMY.md');
    const start = economy.indexOf('## Поля `effect` покупок');
    expect(start).toBeGreaterThanOrEqual(0);
    const section = economy.slice(start, economy.indexOf('\n## ', start + 1));
    const names = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

    const lines = section.split('\n');
    const header = lines.findIndex((line) => line.startsWith('|---'));
    expect(header).toBeGreaterThan(0);
    const documented: Record<string, string[]> = {};
    for (const line of lines.slice(header + 1)) {
      if (!line.startsWith('|')) break;
      const [, types = '', fields = ''] = line.split('|');
      for (const type of names(types)) {
        expect(documented, `тип ${type} описан дважды`).not.toHaveProperty(type);
        documented[type] = names(fields).sort();
      }
    }
    const actual = Object.fromEntries(
      Object.entries(EFFECT_FIELDS).map(([type, fields]) => [type, [...fields].sort()]),
    );
    expect(documented).toEqual(actual);
  });

  it('README не обещает игроку инженерное меню в production (REVIEW B6)', () => {
    const main = read('src/main.ts');
    // Пункт меню добавляется только под import.meta.env.DEV.
    expect(main).toMatch(/import\.meta\.env\.DEV\s*\?\s*\[\{ id: 'dev'/);
    const readme = read('README.md');
    expect(readme).toContain('только в dev-сборке');
    expect(readme).not.toContain('Кнопка 🛠 в шапке');
    expect(readme).not.toContain('остаётся в игре');
  });

  it('инструкции по e2e называют переменные, которые читает playwright.config.ts', () => {
    const config = read('playwright.config.ts');
    const skill = read('.agents/skills/testing-regressions/SKILL.md');
    for (const variable of ['E2E_CHROMIUM_PATH', 'E2E_CHROMIUM_ARGS']) {
      expect(config).toContain(`process.env.${variable}`);
      expect(skill).toContain(variable);
      expect(read('README.md')).toContain(variable);
    }
  });
});
