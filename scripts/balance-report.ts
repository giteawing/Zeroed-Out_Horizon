/**
 * Отчёт по балансу: гоняет симулятор с разными winCost и профилями игрока.
 * Запуск: npx tsx scripts/balance-report.ts   (или npm run balance:report)
 * Скрипт намеренно не входит в сборку — это инструмент разработки.
 */
import { loadContent } from '../src/core/content';
import { runSimulation } from '../src/core/simulator';

const content = loadContent();

const profiles = [
  { name: 'ленивый', tapsPerSecond: 4, tapDiligence: 0.7, exportPatienceSeconds: 20 },
  { name: 'обычный', tapsPerSecond: 5, tapDiligence: 0.85, exportPatienceSeconds: 40 },
  { name: 'упорный', tapsPerSecond: 6, tapDiligence: 0.95, exportPatienceSeconds: 60 },
  { name: 'оптимизатор', tapsPerSecond: 5, tapDiligence: 0.85, strategy: 'optimizer' as const },
];

const winCosts = [
  1e12, 1e13, 1e14, 1e15, 1e16, 3e16, 6e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

for (const profile of profiles) {
  console.log(`\n=== Профиль: ${profile.name} (${profile.tapsPerSecond} тапов/с) ===`);
  for (const winCost of winCosts) {
    content.config.winCost = winCost;
    const winDef = content.upgrades.find((u) => u.win);
    if (winDef) winDef.baseCost = winCost;
    const started = Date.now();
    const result = runSimulation(content, { ...profile, maxSeconds: 60 * 40 });
    const minutes = (result.seconds / 60).toFixed(1);
    console.log(
      `winCost=${winCost.toExponential(0).padEnd(6)} -> ` +
        `${result.won ? 'ПОБЕДА' : 'провал'} за ${minutes} мин, ` +
        `покупок ${result.purchases}, тапов ${result.totalTaps}, ` +
        `(${Date.now() - started} мс)`,
    );
  }
}
