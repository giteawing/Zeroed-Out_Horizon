// @vitest-environment happy-dom
/**
 * REVIEW C8: первая вкладка закрылась, не изменив сохранение (стояла на
 * стартовом экране). Перезагружаться незачем: в памяти второй вкладки ровно
 * тот сейв, что лежит в хранилище, — она просто продолжает сама.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bootAsSecondTab, SAVED_PLAYTIME_MS, type SecondTab } from './helpers/second-tab';
import { settleLocks } from '../helpers/fake-locks';
import { SAVE_KEY } from '../../src/core/state';

vi.mock('../../src/audio/sound', () => ({
  SoundEngine: class {
    isEnabled = false;
    setEnabled(): void {}
    unlock(): void {}
    purchase(): void {}
    event(): void {}
    coin(): void {}
    fanfare(): void {}
  },
}));

let tab: SecondTab;
const stored = (): string | null => localStorage.getItem(SAVE_KEY);
const notice = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="other-tab"]');

beforeAll(async () => {
  tab = await bootAsSecondTab();
});

describe('первая вкладка закрылась без изменений (REVIEW C8)', () => {
  it('пока она открыта, вторая стоит', () => {
    expect(notice()!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>('.start .btn--gold')!.click();
    tab.frames.run(5_000);
    expect(tab.game.state.playtimeMs).toBe(SAVED_PLAYTIME_MS);
    expect(stored()).toBe(tab.seed);
  });

  it('после её закрытия вторая продолжает без перезагрузки', async () => {
    tab.firstTab.close();
    await settleLocks();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(notice()!.hidden).toBe(true);
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
  });

  it('игра запускается, идёт и снова сохраняется', () => {
    document.querySelector<HTMLButtonElement>('.start .btn--gold')!.click();
    tab.frames.run(10_000);
    expect(tab.game.state.playtimeMs).toBeGreaterThan(SAVED_PLAYTIME_MS);
    window.dispatchEvent(new Event('pagehide'));
    const saved = stored();
    expect(saved).not.toBe(tab.seed);
    expect((JSON.parse(saved!) as { playtimeMs: number }).playtimeMs).toBe(tab.game.state.playtimeMs);
  });
});
