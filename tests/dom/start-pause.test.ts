// @vitest-environment happy-dom
/**
 * REVIEW A1 и AUDIT F02: новая партия.
 *
 * Пока игрок смотрит на стартовый экран, игра стоит: время не идёт, деньги
 * не капают, сохранение не пишется. После старта реальное время не теряется
 * даже при «зависшем» видимом кадре.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installFrameDriver, type FrameDriver } from './helpers/frames';
import { SAVE_KEY } from '../../src/core/state';

vi.mock('../../src/audio/sound', () => ({
  SoundEngine: class {
    isEnabled = true;
    setEnabled(): void {}
    unlock(): void {}
    purchase(): void {}
    event(): void {}
    coin(): void {}
    fanfare(): void {}
  },
}));

let game: import('../../src/core/game').Game;
let frames: FrameDriver;

beforeAll(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  window.confirm = () => true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  frames = installFrameDriver();
  await import('../../src/main');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  game = (window as unknown as { __game: import('../../src/core/game').Game }).__game;
});

describe('пауза до старта (REVIEW A1)', () => {
  it('пока не нажат старт, время и деньги не движутся, сейв не пишется', () => {
    expect(document.querySelector('.start')).not.toBeNull();
    const before = structuredClone(game.state);

    frames.run(30_000);

    expect(game.state.playtimeMs).toBe(before.playtimeMs);
    expect(game.state.clockMs).toBe(before.clockMs);
    expect(game.state.coins).toBe(before.coins);
    expect(game.state.totalEarned).toBe(before.totalEarned);
    expect(game.state.oil).toBe(before.oil);
    expect(game.state.totalSold).toBe(before.totalSold);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it('уход со страницы до старта не создаёт сохранение', () => {
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(game.state.playtimeMs).toBe(0);
    expect(game.state.coins).toBe(0);
  });

  it('после старта отсчёт начинается с нуля: секунда кадров — секунда игры', () => {
    const button = document.querySelector<HTMLButtonElement>('.start .btn--gold');
    expect(button).not.toBeNull();
    button!.click();
    expect(game.state.playtimeMs).toBe(0);

    frames.run(1_000);
    expect(game.state.playtimeMs).toBe(1_000);
    expect(game.state.totalSold + game.state.oil).toBeGreaterThan(0);
  });

  it('автосохранение работает только после старта', () => {
    frames.run(game.config.autosaveSeconds * 1000 + 500);
    const raw = localStorage.getItem(SAVE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).playtimeMs).toBeGreaterThan(0);
  });
});

describe('длинный видимый кадр (AUDIT F02)', () => {
  it('зависание на 8 секунд проживается полностью, а не обрезается до 250 мс', () => {
    const before = game.state.playtimeMs;
    frames.stall(8_000);
    // За один кадр проживается ограниченный кусок: кадр не бесконечный.
    const afterStallFrame = game.state.playtimeMs - before;
    expect(afterStallFrame).toBeGreaterThan(250);
    expect(afterStallFrame).toBeLessThanOrEqual(2_000);

    frames.run(2_000);
    expect(game.state.playtimeMs - before).toBe(10_000);
  });

  it('простой дольше порога начисляется как отсутствие, а не симулируется и не теряется', () => {
    const before = structuredClone(game.state);
    const net = game.derived().netPerSecond;
    expect(net).toBeGreaterThan(0);

    frames.stall(60_000);

    expect(game.state.playtimeMs - before.playtimeMs).toBe(60_000);
    // Офлайн-путь платит чистой прибылью и не продаёт нефть за пропущенное время.
    expect(game.state.totalSold).toBe(before.totalSold);
    expect(game.state.coins - before.coins).toBe(
      Math.floor(net * 60 * game.config.offline.efficiency),
    );

    // Следующая секунда считается один раз.
    const afterAway = game.state.playtimeMs;
    frames.run(1_000);
    expect(game.state.playtimeMs - afterAway).toBe(1_000);
  });
});
