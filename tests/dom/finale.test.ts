// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/core/content';
import { createInitialState } from '../../src/core/state';
import { Finale } from '../../src/ui/finale';
import { Texts } from '../../src/ui/texts';

describe('финальная сцена', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('случайный клик не отменяет автоматический переход к титрам', () => {
    vi.useFakeTimers();
    const content = loadContent();
    const texts = new Texts(content.texts);
    const finale = new Finale(content, texts, content.config.currency, {
      onRestart: () => undefined,
      onClose: () => undefined,
    });

    finale.show(createInitialState(content.config, 42));
    finale.root.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const duration = content.texts.finale.cutscene.length * 1100 + 1200;
    vi.advanceTimersByTime(duration);

    expect(finale.root.querySelector('.credits')).not.toBeNull();
  });

  it('закрытие финала очищает ожидающий таймер', () => {
    vi.useFakeTimers();
    const content = loadContent();
    const finale = new Finale(content, new Texts(content.texts), content.config.currency, {
      onRestart: () => undefined,
      onClose: () => undefined,
    });

    finale.show(createInitialState(content.config, 43));
    finale.hide();
    vi.advanceTimersByTime(60_000);

    expect(finale.root.hidden).toBe(true);
    expect(finale.root.querySelector('.credits')).toBeNull();
  });
});
