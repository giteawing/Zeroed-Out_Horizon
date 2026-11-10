import { expect, test, type Page } from '@playwright/test';

/**
 * Дымовой тест desktop-сценариев: непрерывная добыча, ручная маршрутизация,
 * сбыт, покупки, вкладки, сохранение, финал и чистая консоль.
 */
const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
});

async function start(page: Page): Promise<void> {
  await page.goto('/');
  const startButton = page.locator('.start .btn--gold');
  await expect(startButton).toBeVisible();
  await startButton.click();
  await expect(page.locator('.start')).toHaveCount(0, { timeout: 5000 });
}

/** Дождаться фактической продажи сырья без действий игрока. */
async function waitForSale(page: Page): Promise<void> {
  const before = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalSold: number } } }).__game.state.totalSold,
  );
  await expect.poll(
    async () => page.evaluate(
      () => (window as unknown as { __game: { state: { totalSold: number } } }).__game.state.totalSold,
    ),
    { timeout: 15_000 },
  ).toBeGreaterThan(before);
}

/**
 * Дождаться, пока добыча и отгрузка обеспечат первую покупку.
 *
 * Денег на неё хватает после третьей или четвёртой отгрузки — через 15 или
 * 20 игровых секунд, смотря в какой фазе мировая цена (сид новой партии
 * случайный). Игра стоит до кнопки «Начать», поэтому отсчёт идёт от неё.
 * Прежний запас в 20 секунд совпадал с худшим случаем, и тест падал примерно
 * в каждом десятом прогоне. Саму границу «не позже четвёртой отгрузки»
 * проверяет tests/game.test.ts; здесь — только запас на медленный раннер.
 */
async function waitUntilAffordable(page: Page): Promise<void> {
  const buyButtons = page.locator('.card__buy:not([disabled])');
  await expect.poll(() => buyButtons.count(), { timeout: 45_000 }).toBeGreaterThan(0);
}

test('игра запускается без ошибок в консоли', async ({ page }) => {
  await start(page);
  // Кошелёк с нефтефаниками живёт в шапке, а не в панели.
  await expect(page.locator('.topbar__coins')).toContainText('₦');
  await expect(page.locator('.stage__overlay')).toBeVisible();
  await expect(page.locator('[data-testid="production-stage"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="flow-controls"]')).toBeVisible();
  await expect(page.locator('[data-testid="drill"]')).toHaveCount(0);
  await expect(page.locator('.news__item').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('непрерывная добыча отправляет сырую нефть в сбыт', async ({ page }) => {
  await start(page);
  const before = await page.evaluate(
    () => (window as unknown as { __game: { state: { oil: number; totalSold: number } } }).__game.state,
  );
  await waitForSale(page);
  const after = await page.evaluate(
    () => (window as unknown as { __game: { state: { oil: number; totalSold: number } } }).__game.state,
  );
  expect(after.oil + after.totalSold).toBeGreaterThan(before.oil + before.totalSold);
  await expect(page.locator('.hud__oil .hud__row-value')).toContainText('т');
  expect(errors).toEqual([]);
});

test('нефтефаники начисляются от фактической продажи', async ({ page }) => {
  await start(page);
  const totalEarned = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalEarned: number } } }).__game.state.totalEarned,
  );
  await waitForSale(page);
  await expect.poll(
    () => page.evaluate(
      () => (window as unknown as { __game: { state: { totalEarned: number } } }).__game.state.totalEarned,
    ),
  ).toBeGreaterThan(totalEarned);
  await expect(page.locator('.topbar__coins')).toContainText('₦');
});

test('покупка в магазине работает', async ({ page }) => {
  await start(page);
  await waitUntilAffordable(page);
  const buyButtons = page.locator('.card__buy:not([disabled])');
  await buyButtons.first().click();
  const purchases = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalPurchases: number } } }).__game.state.totalPurchases,
  );
  expect(purchases).toBeGreaterThan(0);
});

test('вкладки магазина переключаются', async ({ page }) => {
  await start(page);
  const political = page.getByRole('tab', { name: 'Политика' });
  await political.click();
  await expect(political).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.shop__list')).toContainText('императора');

  // «Сбыт» показывает ближайшие по цене каналы: контракты и экспорт.
  await page.getByRole('tab', { name: 'Сбыт' }).click();
  await expect(page.locator('.shop__list')).toContainText('трест');

  // «Роскошь» открывается с самой дешёвой покупки, а не с яхты.
  await page.getByRole('tab', { name: 'Роскошь' }).click();
  await expect(page.locator('.shop__list')).toContainText('иномарка');
  expect(errors).toEqual([]);
});

test('прогресс сохраняется после перезагрузки', async ({ page }) => {
  await start(page);
  await waitForSale(page);
  const before = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalSold: number } } }).__game.state.totalSold,
  );
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator('.start .btn--gold').click();
  const sold = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalSold: number } } }).__game.state.totalSold,
  );
  expect(sold).toBeGreaterThan(0);
});

test('меню шапки закрыто, пока его не открыли', async ({ page }) => {
  await start(page);
  const menu = page.locator('.menu');
  const trigger = page.locator('.iconbtn--menu');
  // Классическая ошибка вёрстки: у .menu задан display:grid, и он перебивал
  // атрибут hidden — меню висело раскрытым всегда.
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  // Клик мимо и Escape закрывают меню.
  await page.locator('.stage').click({ position: { x: 10, y: 10 } });
  await expect(menu).toBeHidden();
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test('в production-сборке нет инженерного меню', async ({ page }) => {
  await start(page);
  await page.locator('.iconbtn--menu').click();
  await expect(page.locator('[data-menu="settings"]')).toBeVisible();
  // Пункт 🛠 добавляется только в dev-сборке (import.meta.env.DEV):
  // игрок на опубликованном сайте до читерской панели добраться не может.
  await expect(page.locator('[data-menu="dev"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('витрина богатства закрывается кнопкой и кликом по фону', async ({ page }) => {
  await start(page);
  const trigger = page.locator('.iconbtn--menu');
  const wealth = page.locator('.sheet').filter({ has: page.locator('.wealth__grid') });

  await trigger.click();
  await page.locator('[data-menu="wealth"]').click();
  await expect(wealth).toBeVisible();
  // Кнопка «Закрыть» внизу листа.
  await wealth.locator('.btn--gold').click();
  await expect(wealth).toBeHidden();

  // Клик по пустому месту вокруг листа — тоже закрывает.
  await trigger.click();
  await page.locator('[data-menu="wealth"]').click();
  await expect(wealth).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(wealth).toBeHidden();

  // И Escape.
  await trigger.click();
  await page.locator('[data-menu="wealth"]').click();
  await expect(wealth).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(wealth).toBeHidden();
  expect(errors).toEqual([]);
});

test('звук переключается в настройках', async ({ page }) => {
  await start(page);
  // Все действия шапки теперь живут в одном меню: сначала открываем его.
  await page.locator('.iconbtn--menu').click();
  const settings = page.locator('[data-menu="settings"]');
  await settings.click();
  const sound = page.locator('.sheet .btn--row').first();
  await expect(sound).toHaveAttribute('data-on', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('data-on', 'false');
  await sound.click();
  await expect(sound).toHaveAttribute('data-on', 'true');
  expect(errors).toEqual([]);
});

test('панель империи видна всегда и держит все параметры', async ({ page }) => {
  await start(page);
  const hud = page.locator('.hud');
  await expect(hud).toBeVisible();
  for (const label of [
    'производство',
    'экспорт',
    'трубопроводом',
    'поездами',
    'танкерами',
    'в резервуарах (ждёт отправки)',
    'доступный объём вн. рынка',
    'доступный объём экспорта',
    'в накопление на нефтебазах',
    'Норматив штрафа',
    'сверх склада · разлив и штраф',
    'Доход',
    'Расходы',
    'Зарплаты',
    'Чиновники',
    'EBT',
    'Резервуары',
    'Скважины',
    'Активы',
  ]) {
    await expect(
      hud.locator('.hud__row-label').filter({ hasText: label }).first(),
    ).toBeVisible();
  }
  // Три смысловые группы панели; влияние переехало в шапку.
  for (const group of ['goods', 'money', 'property']) {
    await expect(hud.locator(`[data-group="${group}"]`)).toBeVisible();
  }
  await expect(page.locator('.topbar__influence')).toBeVisible();
  await expect(hud).toContainText('Сырая нефть');
  await expect(hud).toContainText('Нефтепродукты');
  // Денежная таблица идёт в порядке применения и заканчивается чистой прибылью.
  await expect(hud.locator('.hud__row-label').filter({ hasText: /^Налог на прибыль/ })).toBeVisible();
  await expect(hud.locator('.hud__profit-label')).toHaveText('Чистая прибыль');
  // Автодобыча — отдельной строкой на всю ширину колонки.
  const autoDrill = hud.locator('.hud__row-value--wide');
  await expect(autoDrill).toHaveText(/^буровая бригада (в сборе|не укомплектована)$/);
  expect((await autoDrill.boundingBox())?.width ?? 0).toBeGreaterThan(250);
  // Рыночные цены находятся в шапке рядом с балансом и влиянием.
  const marketPrices = page.locator('.topbar__market .hud__prices');
  await expect(marketPrices).toBeVisible();
  for (const label of [
    'мировая цена',
    'внутренняя цена',
    'экспортная цена',
    'продукты, внутр. цена',
    'продукты, экспорт',
    'Нефтефантиков за $1',
  ]) {
    await expect(marketPrices).toContainText(label);
  }
  await expect(hud.locator('.hud__prices')).toHaveCount(0);

  // Правая колонка: статистика, маршруты и журнал операций.
  const side = page.locator('.stage__side');
  const shopBox = await page.locator('.shop').boundingBox();
  const hudBox = await hud.boundingBox();
  const flowPanel = page.locator('[data-testid="flow-controls"]');
  const flowBox = await flowPanel.boundingBox();
  const oplogBox = await page.locator('[data-testid="oplog"]').boundingBox();
  expect(hudBox?.width ?? 0).toBeGreaterThan(200);
  expect(flowBox?.width ?? 0).toBeGreaterThan(200);
  expect(flowBox?.height ?? 0).toBeGreaterThan(80);
  expect(oplogBox?.width ?? 0).toBeGreaterThan(200);
  expect(oplogBox!.y).toBeGreaterThan(flowBox!.y + flowBox!.height - 1);

  const flowOverflow = await flowPanel.evaluate((node) => ({
    overflowY: getComputedStyle(node).overflowY,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  expect(['auto', 'scroll']).not.toContain(flowOverflow.overflowY);
  expect(flowOverflow.scrollHeight).toBeLessThanOrEqual(flowOverflow.clientHeight + 1);

  // Панель империи стала широкой: 460–620 px на десктопе. Магазин при этом
  // не схлопывается — иначе карточки покупок не читаются.
  expect(side).toBeTruthy();
  expect(hudBox?.width ?? 0).toBeGreaterThanOrEqual(440);
  expect(hudBox?.width ?? 0).toBeLessThanOrEqual(680);
  expect(shopBox?.width ?? 0).toBeGreaterThan(360);
});

test('финал открывается, показывает карикатуру и титры', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __game: {
        config: { winCost: number; winRequirements: Array<{ upgrade?: string; level?: number }> };
        state: { coins: number; totalEarned: number; levels: Record<string, number> };
        buy: (id: string) => { ok: boolean };
      };
    }).__game;
    g.state.totalEarned = g.config.winCost * 2;
    g.state.coins = g.config.winCost * 2;
    for (const requirement of g.config.winRequirements) {
      if (requirement.upgrade) g.state.levels[requirement.upgrade] = requirement.level ?? 1;
    }
    g.buy('win_pump');
  });
  // Финал показывается с задержкой 700 мс после победы — даём время.
  await expect(page.locator('.finale')).toBeVisible({ timeout: 15_000 });
  await page.locator('.cutscene .btn--ghost').click();
  await expect(page.locator('.credits__art')).toHaveAttribute('src', /finale\.svg/);
  // Стихотворение кладёт владелец игры: проверяем, что титры не пустые
  // и что показывается либо стих из credits.txt, либо заглушка из texts.json.
  const poem = await page.locator('.credits__poem').innerText();
  expect(poem.trim().length).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Показать статистику' }).click();
  await expect(page.locator('.stats')).toBeVisible();
  expect(errors).toEqual([]);
});
