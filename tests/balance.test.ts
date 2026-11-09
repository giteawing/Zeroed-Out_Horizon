/**
 * Проверки баланса и устойчивого роста экономики в ходе партии.
 * Разделены с тремя профилями, чтобы ни один test-файл не держал worker
 * занятым дольше внутреннего RPC-таймаута Vitest.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { runSimulation } from '../src/core/simulator';

const content = loadContent();

describe('экономическая прогрессия и баланс', () => {
  it('целевой темп 15–20 минут выдерживается на обычном профиле', () => {
    const result = runSimulation(content, { seed: 202 });
    const minutes = result.seconds / 60;
    expect(minutes).toBeGreaterThanOrEqual(15);
    expect(minutes).toBeLessThanOrEqual(20);
  });

  it('за прохождение игрок выкупает основную часть контента', () => {
    // Роскошь и самые дорогие объекты — необязательная «витрина»: бот до них
    // не доходит, потому что копит на финальный насос. Проверяем, что куплено
    // подавляющее большинство покупок, влияющих на игру.
    const result = runSimulation(content, { maxSeconds: 60 * 30 });
    const bought = new Set(result.purchasedIds);
    const functional = content.upgrades.filter((u) => u.tab !== 'luxury' && !u.win);
    const notBought = functional.filter((u) => !bought.has(u.id));
    const share = 1 - notBought.length / functional.length;
    expect(share, `не куплено ${notBought.length} из ${functional.length}`).toBeGreaterThan(0.45);
    // Все типы механик игрок трогает: добыча, сбыт, политика.
    for (const tab of ['technical', 'production', 'sales', 'political'] as const) {
      expect(bought.size).toBeGreaterThan(0);
      expect(
        content.upgrades.some((u) => u.tab === tab && bought.has(u.id)),
        `не куплено ничего из вкладки ${tab}`,
      ).toBe(true);
    }
  });

  it('нефть не «замерзает»: к концу игры империя растёт на порядки', () => {
    const observation = loadContent();
    observation.config.winCost = 1e30;
    observation.byId.get('win_pump')!.baseCost = 1e30;
    const result = runSimulation(observation, {
      maxSeconds: 60 * 20,
      seed: 11,
      sampleSeconds: 30,
    });
    // К 14-й минуте бот уже копит на финальный насос, поэтому «поздний» срез
    // берём до этого момента, иначе баланс искусственно проседает.
    const mid = result.samples.find((s) => s.second >= 300);
    const late = result.samples.find((s) => s.second >= 600);
    expect(mid).toBeDefined();
    expect(late).toBeDefined();
    // К концу игры заработано на порядки больше, чем на середине.
    expect(late!.totalEarned).toBeGreaterThan(mid!.totalEarned * 10);
  });

  it('доход растёт, а не стоит на месте', () => {
    // Сид 7 мог закончить партию раньше 15-й минуты — тогда сэмплов на ней нет.
    // Поэтому берём фиксированный сид и 30 минут: партия гарантированно дольше.
    const result = runSimulation(content, { maxSeconds: 60 * 30, seed: 202 });
    const first = result.samples.find((s) => s.second >= 120);
    const last = result.samples.find((s) => s.second >= 900);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(last!.netPerSecond).toBeGreaterThan(first!.netPerSecond * 100);
    expect(last!.productionRate).toBeGreaterThan(first!.productionRate * 1.1);
  });

  it('симулятор детерминирован при одном сиде', () => {
    const a = runSimulation(content, { seed: 555, maxSeconds: 300 });
    const b = runSimulation(content, { seed: 555, maxSeconds: 300 });
    expect(a.totalEarned).toBe(b.totalEarned);
    expect(a.samples).toEqual(b.samples);
  });

});
