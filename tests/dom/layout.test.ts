// @vitest-environment happy-dom
/**
 * Проверка состава интерфейса (замечание заказчика):
 *   • левый столбец — большой, и в нём только магазин с вкладками;
 *   • правый столбец — узкий, и в нём статистика, маршрутизация
 *     и журнал операций; служебные эффекты вынесены в overlay.
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
  // Ждём, пока приложение построит сцену: пустой кадр на CI иногда не успевал.
  const started = Date.now();
  while (!document.querySelector('.stage')) {
    if (Date.now() - started > 5000) throw new Error('сцена не построилась');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
});

describe('раскладка', () => {
  it('в сцене ровно два столбца: большой левый и узкий правый', () => {
    const stage = document.querySelector('.stage');
    expect(stage).not.toBeNull();
    const children = [...(stage?.children ?? [])];
    expect(children).toHaveLength(3);
    expect(children[0].classList.contains('stage__main')).toBe(true);
    expect(children[1].classList.contains('stage__side')).toBe(true);
    expect(children[2].classList.contains('stage__overlay')).toBe(true);
  });

  it('в левом столбце только магазин со вкладками', () => {
    const main = document.querySelector('.stage__main');
    expect(main?.children).toHaveLength(1);
    expect(main?.firstElementChild?.classList.contains('shop')).toBe(true);
    // Ничего из правого столбца в левый не попало.
    expect(main?.querySelector('.hud')).toBeNull();
    expect(main?.querySelector('[data-testid="oplog"]')).toBeNull();
    expect(main?.querySelector('[data-testid="production-stage"]')).toBeNull();
    // Все шесть вкладок — внутри магазина.
    const tabs = [...(main?.querySelectorAll('.tab') ?? [])].map((n) => n.textContent);
    expect(tabs).toEqual(['Техника', 'Добыча', 'Сбыт', 'Политика', 'Роскошь', 'Цель']);
  });

  it('в правом столбце статистика, маршруты и журнал операций', () => {
    const side = document.querySelector('.stage__side');
    expect(side).not.toBeNull();
    const blocks = [...(side?.children ?? [])].map((n) => n.classList.contains('hud')
      ? 'hud'
      : n.classList.contains('flow-controls')
        ? 'flow-controls'
        : n.classList.contains('oplog')
          ? 'oplog'
          : n.className);
    expect(blocks).toEqual(['hud', 'flow-controls', 'oplog']);
    expect(side?.querySelector('[data-testid="flow-controls"]')).not.toBeNull();
    expect(side?.querySelectorAll('[data-flow-max]')).toHaveLength(3);
    expect(side?.querySelectorAll('[data-flow-auto]')).toHaveLength(3);
    expect(side?.querySelector('[data-testid="production-stage"]')).toBeNull();
    expect(side?.querySelector('.stage__production')).toBeNull();
    expect(side?.querySelector('[data-testid="drill"]')).toBeNull();
    expect(side?.querySelector('.drill')).toBeNull();
    expect(side?.querySelector('.shop')).toBeNull();
    expect(side?.querySelector('[data-testid="oplog"]')).not.toBeNull();
  });

  it('промышленная карточка удалена, частицы и уведомления вынесены в overlay', () => {
    expect(document.querySelector('.stage__production')).toBeNull();
    expect(document.querySelector('[data-testid="production-stage"]')).toBeNull();
    const overlay = document.querySelector('.stage__overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('canvas.stage__fx')).not.toBeNull();
    expect(overlay?.querySelector('.badge')).not.toBeNull();
  });

  it('в панели есть все показатели империи', () => {
    const hud = document.querySelector('.hud');
    const labels = [...(hud?.querySelectorAll('.hud__row-label') ?? [])].map((n) => n.textContent);
    for (const expected of [
      'Доход',
      'Активы',
      'НПЗ',
      'Газовые заводы и электростанции',
      'Нефтебазы',
      'Сети АЗС',
      'Резервуары сырой нефти',
      'Экспортные трубопроводы',
      'Железнодорожные эстакады',
      'Морские терминалы и танкеры',
      'Трубопроводы к НПЗ',
      'Суммарная ёмкость хранения',
      'Внутренняя пропускная способность',
      'Экспортная пропускная способность',
      'Переработка на НПЗ',
      'Зарплаты',
      'Чиновники',
      'Скважины',
    ]) {
      expect(labels).toContain(expected);
    }
    const marketLabels = [...document.querySelectorAll('.topbar__market .hud__price-label')]
      .map((n) => n.textContent);
    expect(marketLabels).toEqual([
      'мировая цена',
      'внутренняя цена',
      'экспортная цена',
      'продукты, внутр. цена',
      'продукты, экспорт',
      'Нефтефаников за $1',
    ]);
    expect(hud?.querySelector('.hud__prices')).toBeNull();
    const propertyRows = hud?.querySelector('[data-group="property"] .hud__rows');
    expect(propertyRows?.classList.contains('hud__rows--property')).toBe(true);
    // Денежная таблица идёт в порядке применения: доход → расходы → EBT →
    // налог на прибыль → чистая прибыль.
    const money = hud?.querySelector('[data-group="money"]');
    const invoiceLabels = [...(money?.querySelectorAll('.hud__row-label, .hud__profit-label') ?? [])]
      .map((n) => n.textContent ?? '');
    expect(invoiceLabels[0]).toBe('Доход');
    expect(invoiceLabels).toContain('Расходы');
    expect(invoiceLabels).toContain('EBT');
    expect(invoiceLabels.some((line) => line.startsWith('Налог на прибыль'))).toBe(true);
    expect(invoiceLabels[invoiceLabels.length - 1]).toBe('Чистая прибыль');
    // Автодобыча — отдельная строка на всю ширину, без подписи в левой колонке.
    const autoDrill = hud?.querySelector('.hud__row-value--wide');
    expect(autoDrill?.textContent).toMatch(/^буровая бригада (в сборе|не укомплектована)$/);
    expect(autoDrill?.closest('.hud__row')?.querySelector('.hud__row-label')?.textContent).toBe('');
    // Кошелёк переехал в шапку к иконкам меню.
    expect(document.querySelector('.topbar__coins')).not.toBeNull();
    expect(hud?.querySelector('.topbar__coins')).toBeNull();
    // Товарная статистика: сырая нефть и нефтепродукты отдельными блоками.
    expect(labels).toContain('производство');
    expect(labels).toContain('продажа вн. рынок');
    expect(labels).toContain('экспорт');
    // Влияние переехало в шапку — в панели его больше нет.
    expect(document.querySelector('.topbar__influence')).not.toBeNull();
    // Магазин не вложен в панель.
    expect(hud?.querySelector('.shop')).toBeNull();
  });
});
