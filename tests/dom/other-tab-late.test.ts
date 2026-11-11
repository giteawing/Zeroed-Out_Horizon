// @vitest-environment happy-dom
/**
 * REVIEW C8, крайний случай: новый игрок открыл игру в двух вкладках и нажал
 * «Запустить» во второй раньше, чем браузер ответил, что сохранение занято.
 * Игра обязана остановиться, а когда первая вкладка закроется —
 * перезагрузиться: стартового экрана уже нет, продолжать с наигранного
 * «мимо сейва» состояния нельзя.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setVisibility } from './helpers/frames';
import { bootAsSecondTab, type SecondTab } from './helpers/second-tab';
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
  tab = await bootAsSecondTab({
    noSave: true,
    beforeAnswer: () => document.querySelector<HTMLButtonElement>('.start .btn--gold')!.click(),
  });
});

describe('ответ о занятом сохранении пришёл после старта (REVIEW C8)', () => {
  it('игрок успел начать: стартового экрана уже нет', () => {
    // Иначе тест проверял бы обычную блокировку, а не опоздавший ответ.
    expect(document.querySelector('.start--hidden')).not.toBeNull();
  });

  it('игра останавливается под сообщением', () => {
    expect(notice()!.hidden).toBe(false);
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);
    const playtime = tab.game.state.playtimeMs;
    tab.frames.run(30_000);
    expect(tab.game.state.playtimeMs).toBe(playtime);
  });

  it('ничего не пишет: ни по таймеру, ни при сворачивании, ни при закрытии', () => {
    setVisibility('hidden');
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    setVisibility('visible');
    tab.frames.run(60_000);
    expect(stored()).toBeNull();
  });

  it('«Новая игра» из настроек не стирает сохранение первой вкладки', () => {
    // Первая вкладка успела сохраниться.
    const foreign = tab.saveAfter((state) => { state.coins = 7_777; });
    localStorage.setItem(SAVE_KEY, foreign);
    // В браузере игра под сообщением недоступна (inert); happy-dom этого не
    // соблюдает, поэтому проверяется сам запрет.
    document.querySelector<HTMLButtonElement>('.iconbtn--menu')!.click();
    document.querySelector<HTMLButtonElement>('[data-menu="settings"]')!.click();
    const newGame = document.querySelector<HTMLButtonElement>('.sheet .btn--danger');
    expect(newGame).not.toBeNull();
    newGame!.click();
    expect(stored()).toBe(foreign);
  });

  it('когда первая вкладка закрылась, эта перезагружается, даже если сейв прежний', async () => {
    // В хранилище то же, что было при загрузке этой вкладки, — пусто.
    localStorage.removeItem(SAVE_KEY);
    tab.firstTab.close();
    await settleLocks();
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(notice()!.hidden).toBe(false);
  });
});
