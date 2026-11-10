/**
 * Отчёт по балансу: проверяет текущий winCost на всех профилях.
 * Полная сетка цен: npx tsx scripts/balance-report.ts --grid.
 * Скрипт намеренно не входит в сборку — это инструмент разработки.
 */
import { loadContent } from '../src/core/content';
import { BALANCE_PROFILES, runSimulation } from '../src/core/simulator';

const content = loadContent();

// Те же четыре профиля, что и в балансовых тестах.
const profiles = BALANCE_PROFILES;

const winCosts = process.argv.includes('--grid')
  ? [
      1e12, 1e13, 1e14, 1e15, 1e16, 3e16, 6e16, 1e17,
      1e18, 1e19, 1e20, 1e21, 1e22, 1e23, 1e24, 1e25, 1e26,
    ]
  : [content.config.winCost];

for (const profile of profiles) {
  console.log(`\n=== Профиль: ${profile.name} ===`);
  for (const winCost of winCosts) {
    content.config.winCost = winCost;
    const winDef = content.upgrades.find((u) => u.win);
    if (winDef) winDef.baseCost = winCost;
    const started = Date.now();
    const result = runSimulation(content, { ...profile.options, maxSeconds: 60 * 40 });
    const minutes = (result.seconds / 60).toFixed(1);
    console.log(
      `winCost=${winCost.toExponential(0).padEnd(6)} -> ` +
        `${result.won ? 'ПОБЕДА' : 'провал'} за ${minutes} мин, ` +
        `покупок ${result.purchases}, добыча ${result.samples.at(-1)?.productionRate.toFixed(1) ?? '—'} т/с, ` +
        `(${Date.now() - started} мс)`,
    );
  }
}
