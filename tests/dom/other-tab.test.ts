// @vitest-environment happy-dom
/**
 * REVIEW C8: игра открыта во второй вкладке.
 *
 * Сохранение одно на все вкладки. Вторая вкладка прочитала его при загрузке
 * и, начав играть, затёрла бы всё, что первая наиграла с тех пор. Поэтому
 * вторая вкладка стоит: не идёт, не пишет и не стирает сохранение, пока
 * первая не закроется, — а потом перезагружается и берёт свежий сейв.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setVisibility } from './helpers/frames';
import { bootAsSecondTab, SAVED_PLAYTIME_MS, type SecondTab } from './helpers/second-tab';
import { settleLocks } from '../helpers/fake-locks';
import { SAVE_KEY } from '../../src/core/state';
import texts from '../../src/content/texts.json';

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

describe('вторая вкладка с игрой (REVIEW C8)', () => {
  it('сообщает, что игра открыта в другой вкладке, и закрывает собой игру', () => {
    const node = notice();
    expect(node).not.toBeNull();
    expect(node!.hidden).toBe(false);
    expect(node!.getAttribute('role')).toBe('alertdialog');
    expect(node!.textContent).toContain(texts.save.otherTabTitle);
    expect(node!.textContent).toContain(texts.save.otherTabText);
    // Игра под сообщением недоступна ни мыши, ни клавиатуре.
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);
    expect(node!.closest('#app')).toBeNull();
  });

  it('«Продолжить» не запускает игру и не трогает сохранение', () => {
    const start = document.querySelector<HTMLButtonElement>('.start .btn--gold');
    expect(start).not.toBeNull();
    start!.click();
    tab.frames.run(30_000);
    expect(tab.game.state.playtimeMs).toBe(SAVED_PLAYTIME_MS);
    expect(tab.game.state.coins).toBe(5_000);
    expect(document.querySelector('.start')).not.toBeNull();
    expect(document.querySelector('.start--hidden')).toBeNull();
    expect(stored()).toBe(tab.seed);
  });

  it('сворачивание и закрытие вкладки сохранение не пишут', () => {
    setVisibility('hidden');
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    setVisibility('visible');
    tab.frames.run(60_000);
    expect(stored()).toBe(tab.seed);
  });

  it('«Новая игра» не стирает сохранение первой вкладки', () => {
    const fresh = document.querySelector<HTMLButtonElement>('.start .btn--ghost');
    expect(fresh).not.toBeNull();
    fresh!.click();
    tab.frames.run(1_000);
    expect(stored()).toBe(tab.seed);
    expect(tab.game.state.playtimeMs).toBe(SAVED_PLAYTIME_MS);
  });

  it('когда первая вкладка доиграла и закрылась, эта перезагружается за свежим сейвом', async () => {
    expect(tab.reload).not.toHaveBeenCalled();
    // Первая вкладка успела наиграть и сохраниться.
    const played = tab.saveAfter((state) => { state.coins = 9_999; state.totalEarned = 9_999; });
    localStorage.setItem(SAVE_KEY, played);
    tab.firstTab.close();
    await settleLocks();
    expect(tab.reload).toHaveBeenCalledTimes(1);
    // До перезагрузки вкладка по-прежнему стоит и ничего не пишет.
    expect(notice()!.hidden).toBe(false);
    tab.frames.run(60_000);
    expect(stored()).toBe(played);
  });
});
