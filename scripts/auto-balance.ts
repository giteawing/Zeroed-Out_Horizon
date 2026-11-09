/**
 * Авто-балансировщик. Подгоняет baseCost покупок под целевой темп, чтобы игрок
 * проходил игру за 15–20 минут (ТЗ §5.3, §5.4).
 *
 * Идея: задаём целевую кривую суммарного заработка E(t) — примерно один
 * порядок величины за 1,5 минуты. Затем итеративно:
 *   1) гоняем симулятор с текущими ценами, снимаем фактическую E(t);
 *   2) каждой покупке назначаем цену ~ E(t_target) · доля;
 *   3) повторяем, пока цены не устоятся.
 *
 * Запуск:  npx tsx scripts/auto-balance.ts            — только отчёт
 *          npx tsx scripts/auto-balance.ts --write --i-know — опасная запись upgrades.json + winCost
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Content, UpgradeDef } from '../src/core/types';
import { loadContent } from '../src/core/content';
import { runSimulation } from '../src/core/simulator';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const upgradesPath = resolve(root, 'src/content/upgrades.json');
const configPath = resolve(root, 'src/content/config.json');

const WRITE = process.argv.includes('--write');
const ACKNOWLEDGED = process.argv.includes('--i-know');
if (WRITE && !ACKNOWLEDGED) {
  console.error('Запись перезаписывает upgrades.json и config.json. Для подтверждения используйте --write --i-know и обязательно проверьте diff.');
  process.exit(1);
}
const ROUNDS = WRITE ? 18 : 1;

/** Первая покупка примерно на 25-й секунде, последняя (кроме победы) — на ~15,5 мин. */
const T_FIRST = 25;
const T_LAST = 940;
/** Какую долю накопленного на тот момент заработка отдаём за покупку. */
const SHARE = 0.3;
/** Демпфирование шага, чтобы процесс не раскачивался. */
const DAMPING = 0.6;
const SAMPLE_TIMES = [30, 60, 120, 180, 240, 300, 420, 540, 660, 780, 900, 1020, 1140];

function readUpgradesFile(): UpgradeDef[] {
  return (JSON.parse(readFileSync(upgradesPath, 'utf8')) as { upgrades: UpgradeDef[] }).upgrades;
}

function writeUpgradesFile(upgrades: UpgradeDef[]): void {
  const head =
    '{\n  "_comment": "Все покупки игры. Имя = id, иконка = public/images/icons/<icon>.svg. Строки из ТЗ помечены tag:strict и менять их нельзя.",\n  "upgrades": [\n';
  writeFileSync(upgradesPath, `${head}${upgrades.map((u) => `    ${JSON.stringify(u)}`).join(',\n')}\n  ]\n}\n`, 'utf8');
}

function contentWithCosts(costs: Map<string, number>): Content {
  const content = loadContent();
  for (const def of content.upgrades) {
    const cost = costs.get(def.id);
    if (cost !== undefined && !def.win && def.tag !== 'pinned') def.baseCost = cost;
  }
  return content;
}

/** Кривая E(t): лог-линейная интерполяция по контрольным прогонам. */
function buildCurve(costs: Map<string, number>): (t: number) => number {
  const samples = SAMPLE_TIMES.map((t) => ({
    t,
    e: runSimulation(contentWithCosts(costs), {
      maxSeconds: t,
      tapDiligence: 0.85,
      tapsPerSecond: 5,
    }).totalEarned,
  }));
  return (t: number) => {
    if (t <= samples[0].t) return (samples[0].e * t) / samples[0].t;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (t <= b.t) {
        const k = (t - a.t) / (b.t - a.t);
        const la = Math.log10(Math.max(1, a.e));
        const lb = Math.log10(Math.max(1, b.e));
        return Math.pow(10, la + (lb - la) * k);
      }
    }
    const a = samples[samples.length - 2];
    const b = samples[samples.length - 1];
    const slope = (Math.log10(Math.max(1, b.e)) - Math.log10(Math.max(1, a.e))) / (b.t - a.t);
    return Math.pow(10, Math.log10(Math.max(1, b.e)) + slope * (t - b.t));
  };
}

function main(): void {
  const upgrades = readUpgradesFile();
  // Закреплённые цены (НПЗ 80 млрд → 630 млрд, нефтебаза 40 млн → 2 млрд) не трогаем:
  // они заданы владельцем игры. Остальные подгоняем под кривую дохода.
  const repeatable = upgrades
    .filter((u) => !u.win && u.tag !== 'pinned')
    .sort((a, b) => a.baseCost - b.baseCost);
  const pinned = upgrades.filter((u) => u.tag === 'pinned');
  const targets = new Map<string, number>();
  repeatable.forEach((def, index) => {
    const k = index / Math.max(1, repeatable.length - 1);
    const logT = Math.log10(T_FIRST) + (Math.log10(T_LAST) - Math.log10(T_FIRST)) * k;
    targets.set(def.id, Math.pow(10, logT));
  });

  const costs = new Map(upgrades.filter((u) => !u.win).map((u) => [u.id, u.baseCost]));

  for (let round = 1; round <= ROUNDS; round++) {
    const curve = buildCurve(costs);
    let changed = 0;
    for (const def of repeatable) {
      const prev = costs.get(def.id) ?? def.baseCost;
      if (prev <= 0) continue; // бесплатные события (просить монет, швырнуть подрядчика) не трогаем
      const target = Math.max(10, Math.round(curve(targets.get(def.id) ?? 60) * SHARE));
      const next = Math.max(10, Math.round(prev * Math.pow(target / prev, DAMPING)));
      costs.set(def.id, next);
      if (next !== prev) changed++;
    }
    const check = runSimulation(contentWithCosts(costs), { maxSeconds: 1200 });
    console.log(
      `раунд ${String(round).padStart(2)}: изменено ${String(changed).padStart(3)} цен | ` +
        `E(20м)=${check.totalEarned.toExponential(2)} | покупок ${check.purchases}`,
    );
    if (changed === 0) break;
  }

  const curve = buildCurve(costs);
  const winCost = Number(Math.pow(10, Math.ceil(Math.log10(curve(1020)))).toPrecision(2));
  console.log(`\nРекомендуемый winCost: ${winCost.toExponential(2)}`);

  if (!WRITE) {
    console.log('Это отчёт. Чтобы записать цены — запусти с --write');
    return;
  }

  console.log(`Закреплённые цены (не меняются): ${pinned.map((u) => `${u.id} ${u.baseCost.toExponential(1)}`).join(', ')}`);
  for (const def of upgrades) {
    if (def.win) def.baseCost = winCost;
    else if (def.baseCost > 0) def.baseCost = costs.get(def.id) ?? def.baseCost;
  }
  writeUpgradesFile(upgrades);
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  config.winCost = winCost;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log('Записано: src/content/upgrades.json, src/content/config.json');
}

main();
