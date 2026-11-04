// @vitest-environment happy-dom
/**
 * Проверка состава интерфейса: панель империи стоит в правой колонке
 * (на телефоне — первой в нижней половине), журнал операций — под долотом,
 * а магазин не перекрывает панель.
 *
 * happy-dom не считает CSS-раскладку, поэтому проверяем структуру и классы:
 * именно они задают grid-порядок в base.css.
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

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  window.confirm = () => true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  await import('../../src/main');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe('раскладка', () => {
  it('сцена идёт первой, панель империи — внутри правой колонки', () => {
    const stage = document.querySelector('.stage');
    expect(stage).not.toBeNull();
    const children = [...(stage?.children ?? [])];
    expect(children).toHaveLength(2);
    expect(children[0].classList.contains('stage__middle')).toBe(true);
    expect(children[1].classList.contains('stage__side')).toBe(true);
    // Ни HUD, ни магазин не «выпали» из колонки.
    expect(children[1].querySelector('.hud')).not.toBeNull();
    expect(children[1].querySelector('.shop')).not.toBeNull();
    expect(stage?.querySelector('.hud')).toBe(children[1].querySelector('.hud'));
  });

  it('панель империи первая в колонке: её не закрывает магазин', () => {
    const side = document.querySelector('.stage__side');
    expect(side?.firstElementChild?.className).toContain('hud');
    // Панель и магазин — соседи, а не вложенные друг в друга.
    expect(side?.querySelector('.hud .shop')).toBeNull();
  });

  it('журнал операций лежит под долотом', () => {
    const middle = document.querySelector('.stage__middle');
    const drill = middle?.querySelector('[data-testid="drill"]');
    const oplog = middle?.querySelector('[data-testid="oplog"]');
    expect(drill).not.toBeNull();
    expect(oplog).not.toBeNull();
    // Журнал идёт после долота — значит, визуально ниже.
    const children = [...(middle?.children ?? [])];
    expect(children.indexOf(oplog as Element)).toBeGreaterThan(children.indexOf(drill?.closest('.drill') as Element));
  });

  it('в панели есть все показатели империи', () => {
    const labels = [...document.querySelectorAll('.hud__row-label')].map((n) => n.textContent);
    for (const expected of ['Добыча', 'Сбыт', 'Доход в секунду', 'Зарплаты', 'Чиновники', 'Влияние', 'Резервуары']) {
      expect(labels).toContain(expected);
    }
  });

  it('в магазине пять вкладок, включая «Сбыт»', () => {
    const tabs = [...document.querySelectorAll('.tab')].map((n) => n.textContent);
    expect(tabs).toEqual(['Техника', 'Сбыт', 'Политика', 'Роскошь', 'Цель']);
  });
});
