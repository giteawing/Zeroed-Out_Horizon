// @vitest-environment happy-dom
/**
 * Дымовой тест всего приложения в happy-dom: реальный main.ts, реальные
 * тексты из JSON, реальные тапы через PointerEvent.
 *
 * Это замена браузерному e2e в окружениях без Playwright: проверяем, что
 * приложение поднимается без ошибок, тап начисляет монеты, покупка работает,
 * вкладки переключаются и финал открывается.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/sound', () => ({
  SoundEngine: class {
    isEnabled = true;
    setEnabled(): void {}
    unlock(): void {}
    tap(): void {}
    purchase(): void {}
    event(): void {}
    coin(): void {}
    fanfare(): void {}
  },
}));

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Дождаться пары кадров: интерфейс обновляется в requestAnimationFrame. */
const nextFrame = async (): Promise<void> => {
  // happy-dom прокручивает requestAnimationFrame не чаще ~4 раз в секунду,
  // поэтому ждём с запасом — так тест не зависит от частоты кадров.
  await new Promise((resolve) => setTimeout(resolve, 320));
};

let game: import('../../src/core/game').Game;

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  window.confirm = () => true;
  // happy-dom не умеет canvas 2d — приложение должно это пережить.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  await import('../../src/main');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await flush();
  game = (window as unknown as { __game: import('../../src/core/game').Game }).__game;
});

describe('стартовый экран', () => {
  it('показывает логотип и кнопку «Начать бурить» из texts.json', () => {
    const start = document.querySelector('.start');
    expect(start).not.toBeNull();
    expect(start?.querySelector('.start__logo')?.getAttribute('src')).toBe('images/logo.svg');
    const primary = start?.querySelector('.btn--gold');
    expect(primary?.textContent).toBe('Начать бурить');
  });

  it('запускает игру по кнопке', async () => {
    const button = document.querySelector<HTMLButtonElement>('.start .btn--gold');
    button?.click();
    await flush();
    // Экран уезжает с анимацией, поэтому сначала проверяем класс, потом удаление.
    expect(document.querySelector('.start')?.classList.contains('start--hidden')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 480));
    expect(document.querySelector('.start')).toBeNull();
    expect(document.querySelector('.hud')).not.toBeNull();
    expect(document.querySelector('.shop')).not.toBeNull();
    expect(document.querySelector('.news')).not.toBeNull();
  });
});

describe('сцена с долотом', () => {
  it('отрисовывает скважину и canvas для частиц', () => {
    expect(document.querySelector('.drill__art')?.getAttribute('src')).toBe('images/drill.svg');
    expect(document.querySelector('.drill__fx')).not.toBeNull();
  });

  it('тап через pointerdown начисляет нефтефаники', async () => {
    const stage = document.querySelector<HTMLElement>('[data-testid="drill"]');
    expect(stage).not.toBeNull();
    const before = game.state.coins;
    stage?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 40,
        clientY: 40,
        pointerId: 1,
      }),
    );
    await flush();
    expect(game.state.coins).toBeGreaterThan(before);
    expect(game.state.totalTaps).toBe(1);
  });

  it('поддерживает мультитач: два pointerdown = два тапа', async () => {
    const stage = document.querySelector<HTMLElement>('[data-testid="drill"]');
    const tapsBefore = game.state.totalTaps;
    for (const pointerId of [2, 3]) {
      stage?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId }),
      );
    }
    await flush();
    expect(game.state.totalTaps).toBe(tapsBefore + 2);
  });

  it('клавиатура работает для доступности', async () => {
    const stage = document.querySelector<HTMLElement>('[data-testid="drill"]');
    const tapsBefore = game.state.totalTaps;
    stage?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(game.state.totalTaps).toBe(tapsBefore + 1);
  });
});

describe('HUD', () => {
  it('показывает баланс, доход за тап и прогресс', () => {
    const balance = document.querySelector('.hud__balance');
    expect(balance?.textContent ?? '').toMatch(/₦/);
    expect(document.querySelector('.hud__value')).not.toBeNull();
    expect(document.querySelector('.hud__progress-label')?.textContent).toBe('До «Упыря-Абсолюта»');
    expect(document.querySelector('.hud__progress-fill')).not.toBeNull();
  });

  it('пересчитывает значения после тапа', async () => {
    const stage = document.querySelector<HTMLElement>('[data-testid="drill"]');
    for (let i = 0; i < 5; i++) {
      stage?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    }
    await flush();
    // Ждём кадр, чтобы интерфейс перерисовался.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const values = [...document.querySelectorAll('.hud__value')].map((n) => n.textContent ?? '');
    expect(values.some((v) => v.includes('₦'))).toBe(true);
  });
});

describe('магазин', () => {
  it('по умолчанию открывает техническую вкладку с карточками', () => {
    const active = document.querySelector('.tab--active');
    expect(active?.textContent).toBe('Технические');
    expect(document.querySelectorAll('.card').length).toBeGreaterThan(0);
  });

  it('переключает вкладки и показывает свои покупки', () => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
    const political = tabs.find((tab) => tab.textContent === 'Политические');
    political?.click();
    expect(document.querySelector('.tab--active')?.textContent).toBe('Политические');
    expect(document.querySelector('.shop__list')?.textContent ?? '').toContain('императора');

    const luxury = tabs.find((tab) => tab.textContent === 'Роскошь');
    luxury?.click();
    // На старте открыты только дешёвые предметы роскоши — остальные закрыты.
    expect(document.querySelector('.shop__list')?.textContent ?? '').toContain('Подержанная иномарка');
    expect(document.querySelectorAll('.card').length).toBeGreaterThan(0);
  });

  it('покупка списывает деньги и повышает уровень', async () => {
    const technical = [...document.querySelectorAll<HTMLButtonElement>('.tab')].find(
      (tab) => tab.textContent === 'Технические',
    );
    technical?.click();
    // Дадим денег и перерисуем карточки.
    game.state.coins = 1e6;
    game.state.totalEarned = 1e6;
    await nextFrame();
    const buy = document.querySelector<HTMLButtonElement>('.card__buy:not([disabled])');
    expect(buy).not.toBeNull();
    const purchasesBefore = game.state.totalPurchases;
    buy?.click();
    await flush();
    expect(game.state.totalPurchases).toBe(purchasesBefore + 1);
  });

  it('иконки карточек ссылаются на существующие SVG', () => {
    const icons = [...document.querySelectorAll<HTMLImageElement>('.card__icon')];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.getAttribute('src') ?? '').toMatch(/^images\/icons\/[a-z0-9-]+\.svg$/);
    }
  });
});

describe('новости и подписи', () => {
  it('лента заполняется заголовками из texts.json', () => {
    const items = document.querySelectorAll('.news__item');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].textContent ?? '').not.toHaveLength(0);
  });
});

describe('настройки', () => {
  it('открываются и переключают звук', async () => {
    const settingsButton = document.querySelector<HTMLButtonElement>('.iconbtn--settings');
    settingsButton?.click();
    const sheet = document.querySelector('.sheet');
    expect(sheet?.hasAttribute('hidden')).toBe(false);
    const soundButton = [...document.querySelectorAll<HTMLButtonElement>('.sheet .btn')][0];
    expect(soundButton.textContent).toContain('🔊');
    soundButton.click();
    expect(soundButton.textContent).toContain('🔇');
    expect(game.state.soundOn).toBe(false);
    soundButton.click();
    expect(game.state.soundOn).toBe(true);
    const close = [...document.querySelectorAll<HTMLButtonElement>('.sheet .btn')].pop();
    close?.click();
    expect(document.querySelector('.sheet')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('финал', () => {
  it('открывает титры и показывает заглушку стихотворения', async () => {
    game.state.coins = game.config.winCost * 2;
    for (const req of game.config.winRequirements) {
      if (req.upgrade) game.state.levels[req.upgrade] = req.level ?? 1;
    }
    game.state.totalEarned = game.config.winCost * 2;
    expect(game.buy('win_pump').ok).toBe(true);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const finale = document.querySelector('.finale');
    expect(finale?.hasAttribute('hidden')).toBe(false);
    const skip = document.querySelector<HTMLButtonElement>('.cutscene .btn--ghost');
    expect(skip).not.toBeNull();
    skip?.click();
    await flush();
    expect(document.querySelector('.credits')).not.toBeNull();
    expect(document.querySelector('.credits__poem')?.textContent).toContain(
      'Здесь будет стихотворение',
    );
    expect(document.querySelector('.credits__art')?.getAttribute('src')).toBe('images/finale.svg');
    expect(document.querySelector('.stats')).not.toBeNull();
  });

  it('кнопка статистики раскрывает таблицу', async () => {
    const toggle = [...document.querySelectorAll<HTMLButtonElement>('.credits__actions .btn')].find(
      (btn) => btn.textContent === 'Показать статистику',
    );
    toggle?.click();
    expect(document.querySelector('.stats')?.hasAttribute('hidden')).toBe(false);
    expect(toggle?.textContent).toBe('Скрыть статистику');
  });

  it('«Играть снова» сбрасывает прогресс', async () => {
    const again = document.querySelector<HTMLButtonElement>('.credits__actions .btn--gold');
    again?.click();
    await flush();
    expect(game.state.won).toBe(false);
    expect(game.state.coins).toBe(0);
    expect(document.querySelector('.finale')?.hasAttribute('hidden')).toBe(true);
  });
});
