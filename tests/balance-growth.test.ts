/**
 * Баланс: империя растёт на порядки и без покупки финала.
 * Отдельный файл — отдельная длинная симуляция (см. balance-pace.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { runSimulation } from '../src/core/simulator';

describe('рост империи без финала', () => {
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
});
