/**
 * Баланс: темп партии на обычном профиле и рост дохода по ходу игры.
 *
 * Обе проверки смотрят на один и тот же прогон (сид 202, 30 минут), поэтому
 * симуляция выполняется один раз. Балансовые проверки разнесены по файлам
 * balance-*.test.ts, чтобы ни один файл не держал worker занятым дольше
 * внутреннего RPC-таймаута Vitest.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { runSimulation, type SimulatorResult } from '../src/core/simulator';
import { PLAYTHROUGH_MINUTES } from './helpers/balance-profiles';

const content = loadContent();

/**
 * Игрок, который держит убыточный банк и нажимает его операции (REVIEW D1).
 * Обычные профили банк не покупают, поэтому до этого теста такой игрок в
 * балансовых проверках не появлялся вовсе.
 */
describe('игрок, который пользуется убыточным банком (REVIEW D1)', () => {
  let cached: SimulatorResult | undefined;
  const banker = (): SimulatorResult => {
    cached ??= runSimulation(content, {
      seed: 404,
      strategy: 'optimizer',
      exportPatienceSeconds: 40,
      useBank: true,
      maxSeconds: 60 * 30,
    });
    return cached;
  };

  it('операции банка действительно платят', () => {
    const result = banker();
    expect(result.earnedBySource.bank).toBeGreaterThan(0);
    expect(result.purchasedIds).toContain('p_badbank');
    expect(result.purchasedIds).toContain('p_launder');
  });

  it('партия всё ещё укладывается в 12–25 минут', () => {
    const result = banker();
    expect(result.won).toBe(true);
    const minutes = result.seconds / 60;
    expect(minutes).toBeGreaterThanOrEqual(PLAYTHROUGH_MINUTES.min);
    expect(minutes).toBeLessThanOrEqual(PLAYTHROUGH_MINUTES.max);
  });

  it('доля периодики под наблюдением и для этого игрока', () => {
    const result = banker();
    const share = result.earnedBySource.periodic / result.totalEarned;
    expect(share, `доля периодических выплат: ${(share * 100).toFixed(1)} %`).toBeLessThan(0.95);
  });
});

describe('темп партии и рост дохода', () => {
  let cached: SimulatorResult | undefined;
  /** Обычный профиль: сид 202, лимит 30 минут. Считается один раз на файл. */
  const ordinary = (): SimulatorResult => {
    cached ??= runSimulation(content, { maxSeconds: 60 * 30, seed: 202 });
    return cached;
  };

  it('целевой темп 15–20 минут выдерживается на обычном профиле', () => {
    const result = ordinary();
    const minutes = result.seconds / 60;
    expect(minutes).toBeGreaterThanOrEqual(15);
    expect(minutes).toBeLessThanOrEqual(20);
  });

  it('доход растёт, а не стоит на месте', () => {
    // Сид 7 мог закончить партию раньше 15-й минуты — тогда сэмплов на ней нет.
    // Поэтому берём фиксированный сид и 30 минут: партия гарантированно дольше.
    const result = ordinary();
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
    expect(a.earnedBySource).toEqual(b.earnedBySource);
  });

  /**
   * REVIEW D2: периодические выплаты идут мимо налога и расходов и растут
   * вместе с оборотом. Замер на обычном профиле — около 92 % всего
   * заработанного; продажа нефти даёт остаток. Это решение по балансу
   * оставлено владельцу (docs/ECONOMY.md, «Откуда берутся деньги»), а тест
   * следит, чтобы доля не выросла незаметно и чтобы учёт источников сходился.
   */
  it('откуда берутся деньги: источники учтены, доля периодики под наблюдением (REVIEW D2)', () => {
    const result = ordinary();
    const sources = result.earnedBySource;
    for (const [name, amount] of Object.entries(sources)) {
      expect(amount, name).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(amount), name).toBe(true);
    }
    const sum = sources.sales + sources.periodic + sources.oneShot + sources.bank + sources.gamble;
    expect(sum / result.totalEarned).toBeCloseTo(1, 9);
    // Нефть продаётся, периодика платит: оба источника живые.
    expect(sources.sales).toBeGreaterThan(0);
    expect(sources.periodic).toBeGreaterThan(0);
    // Обычный бот не нажимает кнопки-действия: банк и разовые выплаты — ноль.
    expect(sources.bank).toBe(0);
    expect(sources.oneShot).toBe(0);
    const periodicShare = sources.periodic / result.totalEarned;
    expect(
      periodicShare,
      `доля периодических выплат в заработке: ${(periodicShare * 100).toFixed(1)} %`,
    ).toBeLessThan(0.95);
    // И не ноль: если периодика перестала платить, это тоже новость.
    expect(periodicShare).toBeGreaterThan(0.5);
  });
});
