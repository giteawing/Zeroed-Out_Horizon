/**
 * Подбор ЕДИНОГО масштаба цен.
 *
 * Идея проще и устойчивее, чем подгонка каждой цены: все цены покупок
 * умножаются на один коэффициент k, а winCost фиксируется. Меняется только
 * «скорость» прохождения, относительная выгода покупок сохраняется, поэтому
 * баланс не раскачивается.
 *
 * Запуск: npx tsx scripts/tune-scale.ts            — подобрать и показать
 *         npx tsx scripts/tune-scale.ts --write     — записать цены
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
const WRITE = process.argv.includes('--write');
/** Целевое время прохождения, минуты (ТЗ §5.3: 15–20). */
const TARGET_MINUTES = 17.5;
const WIN_COST = 3e12;

function contentWith(k: number): Content {
  const content = loadContent();
  for (const def of content.upgrades) {
    if (def.win) {
      def.baseCost = WIN_COST;
      continue;
    }
    // Закреплённые владельцем цены (НПЗ, нефтебаза) не масштабируются.
    if (def.tag === 'pinned') continue;
    if (def.baseCost > 0) def.baseCost = Math.round(def.baseCost * k);
  }
  return content;
}

// Цены НЕ масштабируем: округление мелких цен до нуля делало покупки
// бесплатными и роняло баланс. Подбираем только цену финальной цели.
const K = 1;

/** Ищем winCost так, чтобы бот доходил до финала за TARGET_MINUTES. */
function minutesForWinCost(winCost: number): number {
  const content = contentWith(K);
  const winDef = content.upgrades.find((u) => u.win);
  if (winDef) winDef.baseCost = winCost;
  const result = runSimulation(content, {
    tapsPerSecond: 5,
    tapDiligence: 0.85,
    seed: 202,
    maxSeconds: 60 * 40,
  });
  return result.won ? result.seconds / 60 : 40;
}

let loCost = 1e6;
let hiCost = 1e16;
for (let i = 0; i < 26; i++) {
  const mid = Math.sqrt(loCost * hiCost);
  const minutes = minutesForWinCost(mid);
  console.log(`winCost=${mid.toExponential(2)} → ${minutes.toFixed(1)} мин`);
  if (minutes > TARGET_MINUTES) loCost = mid;
  else hiCost = mid;
  if (Math.abs(minutes - TARGET_MINUTES) < 0.35) break;
}
const winCost = Math.round(Math.pow(10, Math.ceil(Math.log10(Math.sqrt(loCost * hiCost))) - 1) * 10);
const k = K;
const finalMinutes = minutesForWinCost(winCost);
console.log(`\nмасштаб цен: ${k} , winCost: ${winCost.toExponential(2)} → ${finalMinutes.toFixed(1)} мин (цель ${TARGET_MINUTES})`);

if (!WRITE) {
  console.log('Отчёт. Чтобы записать — запусти с --write');
  process.exit(0);
}
const cfgPath = resolve(root, 'src/content/config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
cfg.winCost = winCost;
writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

const file = JSON.parse(readFileSync(upgradesPath, 'utf8')) as { upgrades: UpgradeDef[] };
for (const def of file.upgrades) {
  if (def.win) def.baseCost = winCost;
  else if (def.tag !== 'pinned' && def.baseCost > 0) {
    def.baseCost = Math.round(def.baseCost * k);
  }
}
writeFileSync(upgradesPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
console.log('Цены записаны.');
