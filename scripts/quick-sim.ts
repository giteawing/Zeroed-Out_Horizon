/** Быстрый прогон симулятора для отладки баланса: npx tsx scripts/quick-sim.ts */
import { loadContent } from '../src/core/content';
import { runSimulation } from '../src/core/simulator';

const tps = Number(process.argv[2] ?? 5);
const content = loadContent();
const t0 = Date.now();
const result = runSimulation(content, { tapsPerSecond: tps, tapDiligence: 0.85, seed: 202, maxSeconds: 60 * 40 });
console.log(`профиль ${tps} тап/с → ${(result.seconds / 60).toFixed(1)} мин, победа: ${result.won}`);
console.log(`монет: ${result.coins.toExponential(2)}, заработано: ${result.totalEarned.toExponential(2)}, покупок: ${result.purchases}`);
console.log(`куплено покупок: ${result.purchasedIds.length} из ${content.upgrades.length - 1}`);
console.log('не куплено:', content.upgrades.filter((u) => !u.win && !result.purchasedIds.includes(u.id)).map((u) => `${u.id}(${u.baseCost.toExponential(1)})`).join(', ') || '—');
console.log('чекпоинты:', result.checkpoints.map((c) => `${c.minute}м:${(c.coins).toExponential(1)}`).join(' '));
console.log(`(${Date.now() - t0} мс)`);
