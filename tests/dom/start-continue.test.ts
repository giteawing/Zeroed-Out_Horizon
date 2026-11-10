// @vitest-environment happy-dom
/**
 * REVIEW A1, A7, A8: продолжение сохранённой партии.
 *
 * Стартовый экран не должен перезаписывать `savedAtWallMs`: от него считается
 * офлайн-доход. Время отсутствия начисляется один раз — ни потерь, ни дублей.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installFrameDriver, setVisibility, type FrameDriver } from './helpers/frames';
import { loadContent } from '../../src/core/content';
import { createInitialState, serializeState, SAVE_KEY } from '../../src/core/state';

const sound = vi.hoisted(() => ({
  setEnabled: vi.fn<(enabled: boolean) => void>(),
  unlock: vi.fn<() => void>(),
}));

vi.mock('../../src/audio/sound', () => ({
  SoundEngine: class {
    isEnabled = false;
    setEnabled(enabled: boolean): void { sound.setEnabled(enabled); }
    unlock(): void { sound.unlock(); }
    purchase(): void {}
    event(): void {}
    coin(): void {}
    fanfare(): void {}
  },
}));

const AWAY_BEFORE_OPEN_MS = 120_000;
const ON_START_SCREEN_MS = 30_000;

let game: import('../../src/core/game').Game;
let frames: FrameDriver;
let seed = '';

const stored = (): string | null => localStorage.getItem(SAVE_KEY);
const key = (name: string): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
};
const openFromMenu = (id: string): void => {
  const menuButton = document.querySelector<HTMLButtonElement>('.iconbtn--menu');
  expect(menuButton).not.toBeNull();
  menuButton!.click();
  const item = document.querySelector<HTMLButtonElement>(`[data-menu="${id}"]`);
  expect(item).not.toBeNull();
  item!.click();
};
const sheetOf = (selector: string): HTMLElement => {
  const sheet = [...document.querySelectorAll<HTMLElement>('.sheet')]
    .find((node) => node.matches(selector) || node.querySelector(selector) !== null);
  expect(sheet).toBeDefined();
  return sheet!;
};

beforeAll(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  window.confirm = () => true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  frames = installFrameDriver();

  // Сохранение прошлой сессии: игрок закрыл вкладку две минуты назад.
  const content = loadContent();
  const state = createInitialState(content.config, 777);
  state.wells = [
    { kind: 'good', dailyTonnes: 60 },
    { kind: 'good', dailyTonnes: 55 },
  ];
  state.playtimeMs = 60_000;
  state.clockMs = 60_000;
  state.soundOn = false;
  state.savedAtWallMs = Date.now() - AWAY_BEFORE_OPEN_MS;
  seed = serializeState(state);
  localStorage.setItem(SAVE_KEY, seed);

  await import('../../src/main');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  game = (window as unknown as { __game: import('../../src/core/game').Game }).__game;
});

describe('стартовый экран с сохранением (REVIEW A1)', () => {
  it('ожидание на стартовом экране не трогает сейв и не двигает игру', () => {
    expect(document.querySelector('.start')).not.toBeNull();
    frames.run(ON_START_SCREEN_MS);
    expect(game.state.playtimeMs).toBe(60_000);
    expect(game.state.coins).toBe(0);
    expect(stored()).toBe(seed);
  });

  it('скрытие вкладки и уход со страницы до старта не перезаписывают savedAtWallMs', () => {
    setVisibility('hidden');
    setVisibility('visible');
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    expect(stored()).toBe(seed);
    // Возврат во вкладку до старта не начисляет офлайн-доход.
    expect(game.state.coins).toBe(0);
    expect(game.state.playtimeMs).toBe(60_000);
  });

  it('«Продолжить» начисляет офлайн-доход за всё реальное отсутствие ровно один раз', () => {
    const net = game.derived().netPerSecond;
    expect(net).toBeGreaterThan(0);
    const awaySeconds = (AWAY_BEFORE_OPEN_MS + ON_START_SCREEN_MS) / 1000;

    const button = document.querySelector<HTMLButtonElement>('.start .btn--gold');
    expect(button).not.toBeNull();
    button!.click();

    expect(game.state.playtimeMs).toBe(60_000 + awaySeconds * 1000);
    expect(game.state.coins).toBe(Math.floor(net * awaySeconds * game.config.offline.efficiency));
    // Офлайн-интервал закрыт: сейв записан с текущим временем.
    expect(JSON.parse(stored()!).savedAtWallMs).toBe(Date.now());

    const afterOffline = game.state.playtimeMs;
    frames.run(1_000);
    expect(game.state.playtimeMs - afterOffline).toBe(1_000);
  });

  it('скрытая вкладка после старта: время отсутствия начисляется один раз', () => {
    const before = structuredClone(game.state);
    setVisibility('hidden');
    const net = game.derived().netPerSecond;
    // Кадры в скрытой вкладке (если браузер их всё же вызвал) игру не двигают.
    frames.run(1_000);
    expect(game.state.playtimeMs).toBe(before.playtimeMs);
    frames.skip(39_000);
    setVisibility('visible');

    expect(game.state.playtimeMs - before.playtimeMs).toBe(40_000);
    expect(game.state.coins - before.coins).toBeCloseTo(
      Math.floor(net * 40 * game.config.offline.efficiency), 6,
    );
    const afterReturn = game.state.playtimeMs;
    frames.run(1_000);
    expect(game.state.playtimeMs - afterReturn).toBe(1_000);
  });
});

describe('звук из настроек (REVIEW A8)', () => {
  it('включение звука в настройках передаётся звуковому движку', () => {
    sound.setEnabled.mockClear();
    openFromMenu('settings');
    const sheet = sheetOf('.btn--danger');
    expect(sheet.hidden).toBe(false);
    const toggle = sheet.querySelector<HTMLButtonElement>('.btn--row');
    expect(toggle).not.toBeNull();
    expect(toggle!.dataset.on).toBe('false');
    toggle!.click();
    expect(sound.setEnabled).toHaveBeenCalledWith(true);
    expect(game.state.soundOn).toBe(true);
    key('Escape');
    expect(sheet.hidden).toBe(true);
  });
});

describe('окно «Правила игры» (REVIEW A7)', () => {
  it('закрывается клавишей Escape', () => {
    openFromMenu('rules');
    const sheet = sheetOf('.sheet--rules');
    expect(sheet.hidden).toBe(false);
    key('Escape');
    expect(sheet.hidden).toBe(true);
  });

  it('закрывается кликом по затемнению, но не кликом внутри листа', () => {
    openFromMenu('rules');
    const sheet = sheetOf('.sheet--rules');
    const inner = sheet.querySelector<HTMLElement>('.sheet__inner');
    expect(inner).not.toBeNull();
    inner!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(sheet.hidden).toBe(false);
    sheet.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(sheet.hidden).toBe(true);
  });

  it('Escape закрывает только верхнее окно', () => {
    openFromMenu('settings');
    openFromMenu('rules');
    const settings = sheetOf('.btn--danger');
    const rules = sheetOf('.sheet--rules');
    expect(settings.hidden).toBe(false);
    expect(rules.hidden).toBe(false);

    key('Escape');
    expect(rules.hidden).toBe(true);
    expect(settings.hidden).toBe(false);

    key('Escape');
    expect(settings.hidden).toBe(true);
  });
});
