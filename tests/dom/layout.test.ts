// @vitest-environment happy-dom
/**
 * Проверка состава интерфейса (замечание заказчика):
 *   • левый столбец — большой, и в нём только магазин с вкладками;
 *   • правый столбец — узкий, и в нём сверху вниз таблица доходов и расходов,
 *     журнал операций и долото для тапов.
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
  it('в сцене ровно два столбца: большой левый и узкий правый', () => {
    const stage = document.querySelector('.stage');
    expect(stage).not.toBeNull();
    const children = [...(stage?.children ?? [])];
    expect(children).toHaveLength(2);
    expect(children[0].classList.contains('stage__main')).toBe(true);
    expect(children[1].classList.contains('stage__side')).toBe(true);
  });

  it('в левом столбце только магазин со вкладками', () => {
    const main = document.querySelector('.stage__main');
    expect(main?.children).toHaveLength(1);
    expect(main?.firstElementChild?.classList.contains('shop')).toBe(true);
    // Ничего из правого столбца в левый не попало.
    expect(main?.querySelector('.hud')).toBeNull();
    expect(main?.querySelector('[data-testid="oplog"]')).toBeNull();
    expect(main?.querySelector('[data-testid="drill"]')).toBeNull();
    // Все пять вкладок — внутри магазина.
    const tabs = [...(main?.querySelectorAll('.tab') ?? [])].map((n) => n.textContent);
    expect(tabs).toEqual(['Техника', 'Сбыт', 'Политика', 'Роскошь', 'Цель']);
  });

  it('в правом столбце таблица, журнал и долото — именно в этом порядке', () => {
    const side = document.querySelector('.stage__side');
    expect(side).not.toBeNull();
    const blocks = [...(side?.children ?? [])].map((n) =>
      n.classList.contains('hud')
        ? 'hud'
        : n.classList.contains('oplog')
          ? 'oplog'
          : n.classList.contains('drill')
            ? 'drill'
            : n.className,
    );
    // Третий блок — обёртка с долотом и бейджем достижений.
    expect(blocks[0]).toBe('hud');
    expect(blocks[1]).toBe('oplog');
    expect(blocks[2]).toBe('stage__drill');
    expect(side?.querySelector('.stage__drill .drill')).not.toBeNull();

    expect(side?.querySelector('.shop')).toBeNull();
    expect(side?.querySelector('[data-testid="drill"]')).not.toBeNull();
    expect(side?.querySelector('[data-testid="oplog"]')).not.toBeNull();
  });

  it('долото стоит ниже журнала, то есть тапать можно в правом столбце', () => {
    const side = document.querySelector('.stage__side');
    const children = [...(side?.children ?? [])];
    const oplogIndex = children.findIndex((n) => n.classList.contains('oplog'));
    const drillIndex = children.findIndex((n) => n.classList.contains('stage__drill'));
    expect(oplogIndex).toBeGreaterThan(-1);
    expect(drillIndex).toBeGreaterThan(oplogIndex);
  });

  it('в панели есть все показатели империи', () => {
    const hud = document.querySelector('.hud');
    const labels = [...(hud?.querySelectorAll('.hud__row-label') ?? [])].map((n) => n.textContent);
    for (const expected of [
      'Добыча',
      'Сбыт',
      'Доход в секунду',
      'Зарплаты',
      'Чиновники',
      'Резервуары',
    ]) {
      expect(labels).toContain(expected);
    }
    // «Влияние» — отдельный блок со шкалой.
    expect(hud?.querySelector('.hud__influence')?.textContent).toContain('Влияние');
    // Магазин не вложен в панель.
    expect(hud?.querySelector('.shop')).toBeNull();
  });
});
