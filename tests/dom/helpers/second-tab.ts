/**
 * Запуск игры «второй вкладкой»: сохранение уже держит другая вкладка.
 *
 * Звук подменяет сам тест (`vi.mock` поднимается только в своём файле).
 */
import { vi } from 'vitest';
import { installFrameDriver, type FrameDriver } from './frames';
import { FakeLocks, settleLocks } from '../../helpers/fake-locks';
import { loadContent } from '../../../src/core/content';
import type { Game } from '../../../src/core/game';
import { createInitialState, serializeState, SAVE_KEY } from '../../../src/core/state';
import type { GameState } from '../../../src/core/types';

export interface SecondTab {
  game: Game;
  frames: FrameDriver;
  /** Первая вкладка: держит сохранение, пока её не закроют. */
  firstTab: { close: () => void };
  /** Текст сохранения, который лежал в хранилище при запуске. */
  seed: string | null;
  /** Сейв, каким его записала бы первая вкладка после `change`. */
  saveAfter: (change: (state: GameState) => void) => string;
  reload: ReturnType<typeof vi.fn<() => void>>;
}

export const SAVED_PLAYTIME_MS = 60_000;

export interface SecondTabOptions {
  /**
   * Что игрок успел сделать до ответа браузера о замке (в браузере ответ
   * приходит асинхронно, через миллисекунды после загрузки).
   */
  beforeAnswer?: () => void;
  /** Запуск без сохранения: обе вкладки открыты новым игроком. */
  noSave?: boolean;
}

export async function bootAsSecondTab(options: SecondTabOptions = {}): Promise<SecondTab> {
  const { beforeAnswer, noSave = false } = options;
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  window.confirm = () => true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  const frames = installFrameDriver();

  const locks = new FakeLocks();
  const firstTab = locks.openOtherTab(SAVE_KEY);
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  const reload = vi.fn<() => void>();
  vi.spyOn(window.location, 'reload').mockImplementation(reload);

  const content = loadContent();
  const state = createInitialState(content.config, 777);
  state.wells = [{ kind: 'good', dailyTonnes: 60 }];
  state.coins = 5_000;
  state.totalEarned = 5_000;
  state.playtimeMs = SAVED_PLAYTIME_MS;
  state.clockMs = SAVED_PLAYTIME_MS;
  state.savedAtWallMs = Date.now() - 5_000;
  const saved = serializeState(state);
  const seed = noSave ? null : saved;
  if (seed !== null) localStorage.setItem(SAVE_KEY, seed);

  // Первая вкладка уже держит замок; ответ этой вкладке можно придержать.
  await settleLocks();
  if (beforeAnswer) locks.pause();
  await import('../../../src/main');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  if (beforeAnswer) {
    beforeAnswer();
    locks.resume();
  }
  await settleLocks();

  return {
    game: (window as unknown as { __game: Game }).__game,
    frames,
    firstTab,
    seed,
    saveAfter: (change) => {
      const next = JSON.parse(saved) as GameState;
      change(next);
      return serializeState(next);
    },
    reload,
  };
}
