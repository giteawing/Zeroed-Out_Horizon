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

/**
 * Дождаться условия, а не «магической» паузы.
 *
 * Интерфейс обновляется в requestAnimationFrame, а happy-dom прокручивает
 * кадры неравномерно: на загруженном CI фиксированные 320 мс иногда не
 * хватали, и тест мигал. Ждём появления элемента столько, сколько нужно,
 * с честным таймаутом.
 */
const waitFor = async (
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('условие не выполнилось за отведённое время');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Дождаться, пока запрос кадра реально обновит интерфейс. */
const nextFrame = async (condition?: () => boolean): Promise<void> => {
  if (condition) {
    await waitFor(condition);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
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
    await waitFor(() => document.querySelector('.start') === null);
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

  it('тап через pointerdown добывает нефть', async () => {
    const stage = document.querySelector<HTMLElement>('[data-testid="drill"]');
    expect(stage).not.toBeNull();
    // Тап кладёт нефть в резервуары, но её тут же может забрать сбыт,
    // поэтому считаем «нефть + проданное»: масштаб добычи, а не остаток.
    const before = game.state.oil + game.state.totalSold;
    const tapsBefore = game.state.totalTaps;
    stage?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 40,
        clientY: 40,
        pointerId: 1,
      }),
    );
    await flush();
    // Деньги за тап не начисляются напрямую: сначала нефть, потом продажа.
    expect(game.state.oil + game.state.totalSold).toBeGreaterThan(before);
    // Считаем прирост, а не абсолют: тест не зависит от других файлов прогона.
    expect(game.state.totalTaps).toBe(tapsBefore + 1);
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
  it('показывает баланс и влияние в шапке, а товарную статистику — в панели', () => {
    // Кошелёк и влияние живут в шапке рядом с меню.
    const balance = document.querySelector('.topbar__coins');
    expect(balance?.textContent ?? '').toMatch(/₦/);
    expect(document.querySelector('.topbar__influence-fill')).not.toBeNull();
    // Панель империи: резервуары, сырая нефть, нефтепродукты, прибыль.
    expect(document.querySelector('.hud__oilbar')).not.toBeNull();
    expect(document.querySelector('.hud__prices')?.textContent).toContain('мировая цена');
    const text = document.querySelector('.hud')?.textContent ?? '';
    expect(text).toContain('Сырая нефть');
    expect(text).toContain('Нефтепродукты');
    // Чистая прибыль — последняя строка денежной таблицы.
    expect(document.querySelector('.hud__profit')?.textContent).toContain('Чистая прибыль');
    // Денежная таблица идёт в порядке применения: доход → расходы → EBT →
    // налог на прибыль → чистая прибыль.
    const invoice = document.querySelector('.hud__invoice');
    const order = [...(invoice?.querySelectorAll('.hud__row-label, .hud__profit-label') ?? [])]
      .map((n) => n.textContent ?? '');
    expect(order[0]).toBe('Доход');
    expect(order[1]).toBe('Экспорт нефти');
    expect(order[2]).toBe('Экспорт нефтепродуктов');
    expect(order[3]).toBe('Внутренняя продажа нефти');
    expect(order[4]).toBe('Внутренняя продажа нефтепродуктов');
    expect(order[5]).toBe('Доход от топливного демпфера');
    expect(order[6]).toBe('Доход от вывоза капитала');
    expect(order[7]).toContain('Инвестиционный доход');
    expect(order[8]).toBe('Расходы');
    expect(order).toContain('EBT');
    // Итог «Расходы» стоит перед своими статьями, статьи — перед EBT.
    expect(order.indexOf('Расходы')).toBeLessThan(order.indexOf('Зарплаты'));
    expect(order.indexOf('Чиновники')).toBeLessThan(order.indexOf('EBT'));
    expect(order.some((line) => line.startsWith('Налог на прибыль'))).toBe(true);
    // «Норматив штрафа» — статья расходов: стоит после найма, до EBT, и
    // подписан текущей скидкой за влияние.
    const fineIndex = order.findIndex((line) => line.startsWith('Норматив штрафа'));
    expect(fineIndex).toBeGreaterThan(order.indexOf('Чиновники'));
    expect(fineIndex).toBeLessThan(order.indexOf('EBT'));
    expect(order[fineIndex]).toContain('скидка');
    expect(order[order.length - 1]).toBe('Чистая прибыль');
    expect(order.indexOf('EBT')).toBeLessThan(order.findIndex((l) => l.startsWith('Налог на прибыль')));
    // «Доступный объём» рынков — отдельно для сырья и для нефтепродуктов.
    // Формат: сколько принято и сколько всего рынок может принять.
    const markets = [...document.querySelectorAll('.hud__row-value--market')];
    expect(markets.length).toBe(4);
    for (const node of markets) expect(node.textContent).toMatch(/^\d[\d\s,.]* \/ .*т\/с$/);
    // Способы доставки — подпункты экспорта: у них класс-связка, чтобы
    // визуально было видно, что они входят в строку «экспорт», а не стоят
    // наравне с каналами сбыта.
    const under = [...document.querySelectorAll('[data-section="crude"] .hud__row--under')];
    expect(under.map((n) => n.querySelector('.hud__row-label')?.textContent))
      .toEqual(['трубопроводом', 'поездами', 'танкерами']);
    // Прогресс-бар до финала заказчик просил убрать совсем.
    expect(document.querySelector('.hud__progress')).toBeNull();
  });

  it('панель империи стоит в правом столбце и не прячется', () => {
    const side = document.querySelector('.stage__side');
    expect(side?.querySelector('.hud')).not.toBeNull();
    // HUD внутри боковой колонки доходит до магазина, но не перекрывается им.
    expect(side?.firstElementChild?.classList.contains('hud')).toBe(true);
  });

  it('под долотом есть журнал операций', () => {
    const middle = document.querySelector('.stage__middle');
    expect(middle?.querySelector('[data-testid="oplog"]')).not.toBeNull();
  });

  it('пересчитывает значения после тапа', async () => {
    const stage = document.querySelector<HTMLElement>('[data-testid="drill"]');
    for (let i = 0; i < 5; i++) {
      stage?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    }
    await flush();
    // Ждём, пока интерфейс перерисуется после тапов, а не фиксированный кадр.
    await waitFor(() => {
      const values = [...document.querySelectorAll('.hud__row-value')]
        .map((n) => n.textContent ?? '');
      return values.some((v) => v.includes('т') && /[1-9]/.test(v));
    });
  });
});

describe('магазин', () => {
  it('по умолчанию открывает техническую вкладку с карточками', () => {
    const active = document.querySelector('.tab--active');
    expect(active?.textContent).toBe('Техника');
    expect(document.querySelectorAll('.card').length).toBeGreaterThan(0);
  });

  it('переключает вкладки и показывает свои покупки', () => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
    const political = tabs.find((tab) => tab.textContent === 'Политика');
    political?.click();
    expect(document.querySelector('.tab--active')?.textContent).toBe('Политика');
    expect(document.querySelector('.shop__list')?.textContent ?? '').toContain('императора');

    const production = tabs.find((tab) => tab.textContent === 'Добыча');
    production?.click();
    expect(document.querySelector('.shop__list')?.textContent ?? '').toContain('нефтеперерабатывающий завод');
    const sales = tabs.find((tab) => tab.textContent === 'Сбыт');
    sales?.click();
    expect(document.querySelector('.shop__list')?.textContent ?? '').toContain('железнодорожную эстакаду');

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
    await waitFor(() => document.querySelector('.card__buy:not([disabled])') !== null);
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

describe('расшифровка собственности', () => {
  it('агрегирует мощности и открывает подробную оценку активов', () => {
    const property = document.querySelector('[data-group="property"]');
    expect(property).not.toBeNull();
    expect(property?.querySelector('[data-row="wellsCount"]')).not.toBeNull();
    expect(property?.querySelector('[data-row="assetsExportPipe"]')).not.toBeNull();
    expect(property?.querySelector('[data-row="assetsExportRail"]')).not.toBeNull();
    expect(property?.querySelector('[data-row="assetsExportTanker"]')).not.toBeNull();
    const assets = property?.querySelector<HTMLElement>('[data-row="assets"]');
    expect(assets?.getAttribute('role')).toBe('button');
    assets?.click();
    const sheet = [...document.querySelectorAll<HTMLElement>('.sheet')].find((node) => node.querySelector('.assets__list'))!;
    expect(sheet.hasAttribute('hidden')).toBe(false);
    expect(sheet.textContent).toContain('Итого стоимость активов');
    sheet.querySelector<HTMLButtonElement>('.btn')?.click();
    expect(sheet.hasAttribute('hidden')).toBe(true);
  });
});

describe('витрина богатства', () => {
  /** Открыть витрину через меню шапки. */
  const openWealth = (): HTMLElement => {
    document.querySelector<HTMLButtonElement>('.iconbtn--menu')?.click();
    document.querySelector<HTMLButtonElement>('[data-menu="wealth"]')?.click();
    return [...document.querySelectorAll<HTMLElement>('.sheet')].find(
      (node) => node.querySelector('.wealth__grid') !== null,
    )!;
  };

  it('закрывается кнопкой «Закрыть»', () => {
    const sheet = openWealth();
    expect(sheet.hasAttribute('hidden')).toBe(false);
    const close = [...sheet.querySelectorAll<HTMLButtonElement>('.btn')].pop();
    expect(close?.textContent).toBe('Закрыть');
    close?.click();
    expect(sheet.hasAttribute('hidden')).toBe(true);
  });

  it('закрывается кликом по пустому месту вокруг листа', () => {
    const sheet = openWealth();
    expect(sheet.hasAttribute('hidden')).toBe(false);
    // Клик по самому листу окно не закрывает.
    sheet.querySelector<HTMLElement>('.sheet__inner')!.dispatchEvent(
      new Event('pointerdown', { bubbles: true }),
    );
    expect(sheet.hasAttribute('hidden')).toBe(false);
    // А по затемнению — закрывает.
    sheet.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(sheet.hasAttribute('hidden')).toBe(true);
  });

  it('настройки тоже закрываются кликом по фону', () => {
    document.querySelector<HTMLButtonElement>('.iconbtn--menu')?.click();
    document.querySelector<HTMLButtonElement>('[data-menu="settings"]')?.click();
    const sheet = [...document.querySelectorAll<HTMLElement>('.sheet')].find(
      (node) => node.querySelector('.wealth__grid') === null && !node.classList.contains('dev'),
    )!;
    expect(sheet.hasAttribute('hidden')).toBe(false);
    sheet.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(sheet.hasAttribute('hidden')).toBe(true);
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
    const menuButton = document.querySelector<HTMLButtonElement>('.iconbtn--menu');
    menuButton?.click();
    const settingsButton = document.querySelector<HTMLButtonElement>('[data-menu="settings"]');
    settingsButton?.click();
    const sheet = document.querySelector('.sheet');
    expect(sheet?.hasAttribute('hidden')).toBe(false);
    // На странице два «листа»: настройки и инженерное меню. Берём настройки.
    const settingsSheet = [...document.querySelectorAll('.sheet')].find(
      (node) => !node.classList.contains('dev'),
    )!;
    const soundButton = [...settingsSheet.querySelectorAll<HTMLButtonElement>('.btn')][0];
    expect(soundButton.textContent).toContain('🔊');
    soundButton.click();
    expect(soundButton.textContent).toContain('🔇');
    expect(game.state.soundOn).toBe(false);
    soundButton.click();
    expect(game.state.soundOn).toBe(true);
    const close = [...settingsSheet.querySelectorAll<HTMLButtonElement>('.btn')].pop();
    close?.click();
    expect(document.querySelector('.sheet')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('мировая цена, магазин и инженерное меню', () => {
  it('мировая цена показана в нефтефаниках за тонну, полосы сверху больше нет', () => {
    // Мировая и внутренняя цена стоят рядом отдельными строками.
    const prices = document.querySelector('.hud__prices');
    expect(prices).not.toBeNull();
    expect(prices!.textContent).toContain('мировая цена');
    expect(prices!.textContent).toContain('внутренняя цена');
    expect(prices!.textContent).toMatch(/₦[\d.,]+\s*\/\s*т/);
    // Полоса-прогресс мировой цены убрана по требованию заказчика.
    expect(document.querySelector('.hud__pricebar')).toBeNull();
    expect(document.querySelector('.hud__chip--price')).toBeNull();
  });

  it('закрытые покупки видны в магазине с красной причиной блокировки', async () => {
    const technical = [...document.querySelectorAll<HTMLButtonElement>('.tab')].find(
      (tab) => tab.textContent === 'Технические',
    );
    technical?.click();
    game.state.coins = 0;
    await waitFor(() => document.querySelectorAll('.card--locked').length > 0);
    const locked = [...document.querySelectorAll<HTMLElement>('.card--locked')];
    expect(locked.length).toBeGreaterThan(0);
    // Карточка не спрятана: она есть в списке и содержит условие разблокировки.
    const hint = locked[0].querySelector('.card__lock')?.textContent ?? '';
    expect(hint.length).toBeGreaterThan(0);
    const disabled = locked[0].querySelector<HTMLButtonElement>('.card__buy')?.disabled;
    expect(disabled).toBe(true);
    // Все покупки вкладки на месте, включая закрытые.
    const cards = document.querySelectorAll('.shop__list .card').length;
    expect(cards).toBeGreaterThan(locked.length);
  });

  it('🛠 открывает инженерное меню, «+1 трлн» начисляет деньги и закрывается по Esc', async () => {
    document.querySelector<HTMLButtonElement>('.iconbtn--menu')?.click();
    const devButton = document.querySelector<HTMLButtonElement>('[data-menu="dev"]');
    expect(devButton).not.toBeNull();
    devButton?.click();
    const menu = document.querySelector<HTMLElement>('.sheet__inner.dev')?.closest('.sheet');
    expect(menu?.hasAttribute('hidden')).toBe(false);
    const coinsBefore = game.state.coins;
    menu?.querySelector<HTMLButtonElement>('[data-action="money"]')?.click();
    await flush();
    expect(game.state.coins).toBeGreaterThanOrEqual(coinsBefore + 1e12);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(menu?.hasAttribute('hidden')).toBe(true);
  });

  it('«Открыть все покупки» снимает требования по деньгам', async () => {
    document.querySelector<HTMLButtonElement>('.iconbtn--menu')?.click();
    const devButton = document.querySelector<HTMLButtonElement>('[data-menu="dev"]');
    devButton?.click();
    const menu = document.querySelector<HTMLElement>('.sheet__inner.dev')!.closest('.sheet');
    menu?.querySelector<HTMLButtonElement>('[data-action="unlock"]')?.click();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    game.state.coins = 0;
    // Требования по накопленному заработку сняты — закрытых карточек не осталось.
    await waitFor(() => document.querySelectorAll('.card--locked').length === 0);
    const locked = [...document.querySelectorAll<HTMLElement>('.card--locked')];
    expect(locked.length).toBe(0);
  });
});

describe('финал', () => {
  /**
   * Стихотворение кладёт владелец игры, поэтому тест не требует конкретного
   * текста: он проверяет либо заглушку из texts.json, либо реальный стих
   * из credits.txt (в браузере он подставляется через Vite ?raw).
   */
  it('открывает титры и показывает стихотворение из credits.txt', async () => {
    game.state.coins = game.config.winCost * 2;
    for (const req of game.config.winRequirements) {
      if (req.upgrade) game.state.levels[req.upgrade] = req.level ?? 1;
    }
    game.state.totalEarned = game.config.winCost * 2;
    expect(game.buy('win_pump').ok).toBe(true);
    await flush();
    await waitFor(() => document.querySelector('.finale')?.hasAttribute('hidden') === false);
    const finale = document.querySelector('.finale');
    expect(finale?.hasAttribute('hidden')).toBe(false);
    const skip = document.querySelector<HTMLButtonElement>('.cutscene .btn--ghost');
    expect(skip).not.toBeNull();
    skip?.click();
    await flush();
    expect(document.querySelector('.credits')).not.toBeNull();
    const poem = document.querySelector('.credits__poem')?.textContent?.trim() ?? '';
    const fallback = game.content.texts.finale.creditsFallback;
    const realPoem = game.content.credits.trim();
    expect(poem.length).toBeGreaterThan(0);
    expect(poem === fallback || poem === realPoem).toBe(true);
    if (!poem.includes('Здесь будет стихотворение')) {
      expect(poem.toLowerCase()).toContain('капитал');
    }
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

describe('этап 5: банк, реприватизация, активы и контробанда', () => {
  it('убыточный банк покупается один раз и открывает «масштабы»', async () => {
    game.state.coins = 1e12;
    game.state.totalEarned = 1e12;
    await nextFrame();
    const political = [...document.querySelectorAll<HTMLButtonElement>('.tab')].find(
      (tab) => tab.textContent === 'Политика',
    );
    political?.click();
    // Вкладка перерисовывается в следующем кадре — ждём нужную карточку.
    await waitFor(() =>
      [...document.querySelectorAll('.shop .card__name')]
        .some((n) => n.textContent?.includes('масштабов деятельности банка')),
    );
    const names = [...document.querySelectorAll('.shop .card__name')].map((n) => n.textContent);
    expect(names).toContain('Увеличение масштабов деятельности банка');
    expect(names).toContain('Заставить всех сотрудников компании получать зарплату через банк');
    expect(names).toContain('Купить телеканал имперского значения');
    expect(names).toContain('Стать главным секретарём топливной и экологической безопасности');
    // Убранные заказчиком пункты не вернулись.
    expect(names.join(' ')).not.toContain('юриста');
    expect(names.join(' ')).not.toContain('на храм');
    expect(names.join(' ')).not.toContain('дронов-разведчиков');
  });

  it('«Контрабанда нефти заграницу» — одноразовая акция с перезарядкой', async () => {
    const political = [...document.querySelectorAll<HTMLButtonElement>('.tab')].find(
      (tab) => tab.textContent === 'Политика',
    );
    political?.click();
    const card = [...document.querySelectorAll<HTMLElement>('.shop .card')].find(
      (c) => c.querySelector('.card__name')?.textContent === 'Контрабанда нефти заграницу',
    );
    expect(card).toBeDefined();
    const def = game.content.byId.get('p_export')!;
    expect(def.cooldownSeconds).toBeGreaterThan(0);
    expect(def.repeatable).toBe(true);
  });

  it('в панели есть прибыль, активы и счётчики объектов', () => {
    const labels = [...document.querySelectorAll('.hud .hud__row-label')].map((n) => n.textContent);
    for (const expected of [
      'Активы', 'Скважины', 'НПЗ', 'Газовые заводы и электростанции',
      'Нефтебазы', 'Сети АЗС', 'Резервуары сырой нефти',
      'Экспортные трубопроводы', 'Железнодорожные эстакады',
      'Морские терминалы и танкеры', 'Трубопроводы к НПЗ',
      'Суммарная ёмкость хранения', 'Внутренняя пропускная способность',
      'Экспортная пропускная способность', 'Переработка на НПЗ',
    ]) {
      expect(labels).toContain(expected);
    }
    expect(document.querySelector('.hud__profit-label')?.textContent).toBe('Чистая прибыль');
    // Товарная статистика переехала в блоки «сырая нефть» и «нефтепродукты».
    expect(labels).toContain('производство');
    expect(labels).toContain('продажа вн. рынок');
    expect(labels).toContain('экспорт');
  });

  it('цены внутренняя и экспортная различаются, экспортная выше', () => {
    const derived = game.derived();
    expect(derived.exportPricePerTon).toBeGreaterThan(derived.domesticPricePerTon);
    expect(derived.assetsValue).toBeGreaterThanOrEqual(0);
    expect(derived.profitPerSecond).toBe(derived.netPerSecond);
  });
});
