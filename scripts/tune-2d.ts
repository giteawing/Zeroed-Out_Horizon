/**
 * Двумерный подбор масштабов: добыча × сбыт.
 * Цель — прохождение за 15–20 минут при фиксированной цене финала.
 * Запуск: npx tsx scripts/tune-2d.ts [--write --i-know] (опасная запись)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UpgradeDef } from '../src/core/types';
import { loadContent } from '../src/core/content';
import { runSimulation } from '../src/core/simulator';

const WRITE = process.argv.includes('--write');
const ACKNOWLEDGED = process.argv.includes('--i-know');
if (WRITE && !ACKNOWLEDGED) {
  console.error('Запись изменяет цены добычи и сбыта. Повторите запуск с --write --i-know после проверки diff.');
  process.exit(1);
}
const WIN_COST = loadContent().config.winCost;
const PROD_IDS = ['t_well','s_geonav','s_geolog','s_operator','s_engineer','s_brigade','p_field','p_reprivatize','t_pump4'];
const target = 17;

function test(prodK: number, sellK: number): { minutes: number; bought: number } {
  const content = loadContent();
  for (const def of content.upgrades) {
    if (def.win) { def.baseCost = WIN_COST; continue; }
    if (PROD_IDS.includes(def.id) && def.effect.value) {
      def.effect.value = Math.max(0.1, def.effect.value * prodK);
    }
    if (def.type === 'sell' && def.effect.value) {
      def.effect.value = Math.max(1, Math.round(def.effect.value * sellK));
    }
  }
  const r = runSimulation(content, { seed: 202, maxSeconds: 2400 });
  return { minutes: r.won ? r.seconds / 60 : 40, bought: r.purchasedIds.length };
}

let best = { prodK: 1, sellK: 1, minutes: 40, bought: 0 };
for (const prodK of [0.02, 0.05, 0.1, 0.25, 0.5, 1]) {
  for (const sellK of [1, 3, 10, 30, 100]) {
    const { minutes, bought } = test(prodK, sellK);
    const dist = Math.abs(minutes - target);
    if (dist < Math.abs(best.minutes - target)) best = { prodK, sellK, minutes, bought };
    console.log(`добыча×${prodK}  сбыт×${sellK} → ${minutes.toFixed(1)} мин, покупок ${bought}`);
  }
}
console.log('\nлучшее:', best);

if (WRITE) {
  const path = resolve('src/content/upgrades.json');
  const file = JSON.parse(readFileSync(path, 'utf8')) as { upgrades: UpgradeDef[] };
  for (const def of file.upgrades) {
    if (def.win) { def.baseCost = WIN_COST; continue; }
    if (PROD_IDS.includes(def.id) && def.effect.value) {
      def.effect.value = Math.max(0.1, Number((def.effect.value * best.prodK).toPrecision(3)));
    }
    if (def.type === 'sell' && def.effect.value) {
      def.effect.value = Math.max(1, Math.round(def.effect.value * best.sellK));
    }
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  const cfgPath = resolve('src/content/config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  cfg.winCost = WIN_COST;
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  console.log('записано');
}
