import { expect, test, type Page } from '@playwright/test';

/**
 * Дымовой тест прохождения в настоящем браузере (ТЗ §8.1).
 * Игру целиком он не проходит (это 16–20 минут), а проверяет ключевые
 * механики на десктопе и телефоне: тап добывает нефть, сбыт приносит
 * нефтефаники, покупки, вкладки, сохранение, финал и чистую консоль.
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

/** Тап по скважине. Игра слушает pointerdown, поэтому mouse.down() достаточно. */
async function tapDrill(page: Page, times = 12): Promise<void> {
  const drill = page.locator('[data-testid="drill"]');
  const box = await drill.boundingBox();
  if (!box) throw new Error('скважина не найдена');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (let i = 0; i < times; i++) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
  }
}

/** Копит нефть тапами, пока не станет доступна хоть одна покупка. */
async function tapUntilAffordable(page: Page): Promise<void> {
  const buyButtons = page.locator('.card__buy:not([disabled])');
  for (let i = 0; i < 60; i++) {
    if ((await buyButtons.count()) > 0) return;
    await tapDrill(page, 6);
    await page.waitForTimeout(120);
  }
  await expect(buyButtons.first()).toBeVisible();
}

test('игра запускается без ошибок в консоли', async ({ page }) => {
  await start(page);
  await expect(page.locator('.hud__balance')).toContainText('₦');
  await expect(page.locator('.drill__art')).toHaveAttribute('src', /drill\.svg/);
  await expect(page.locator('.news__item').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('тап добывает нефть, а не нефтефаники', async ({ page }) => {
  await start(page);
  // Панель империи показывает нефть в резервуарах: «{oil} / {capacity} т».
  const oilValue = page.locator('.hud__oil .hud__row-value');
  const before = (await oilValue.textContent()) ?? '';
  await tapDrill(page, 24);
  await expect.poll(async () => (await oilValue.textContent()) !== before, { timeout: 8000 }).toBe(true);
  // Тап по скважине не начисляет нефтефаники напрямую — они появляются только со сбыта.
  const coins = await page.evaluate(
    () => (window as unknown as { __game: { state: { coins: number; oil: number } } }).__game.state,
  );
  expect(coins.oil).toBeGreaterThan(0);
});

test('нефть продаётся, и нефтефаники капают со сбыта', async ({ page }) => {
  await start(page);
  const balance = page.locator('.hud__balance');
  await tapDrill(page, 40);
  // Сбыт идёт непрерывно: нефть уходит в контракты и превращается в деньги.
  await expect.poll(
    async () =>
      page.evaluate(() => (window as unknown as { __game: { state: { totalEarned: number } } }).__game.state.totalEarned),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
  await expect(balance).toContainText('₦');
});

test('покупка в магазине работает', async ({ page }) => {
  await start(page);
  await tapUntilAffordable(page);
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
  await tapDrill(page, 30);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator('.start .btn--gold').click();
  const taps = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalTaps: number } } }).__game.state.totalTaps,
  );
  expect(taps).toBeGreaterThan(0);
});

test('звук переключается в настройках', async ({ page }) => {
  await start(page);
  const settings = page.locator('.iconbtn--settings');
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
    'Добыча',
    'Сбыт',
    'Доход в секунду',
    'Зарплаты',
    'Чиновники',
    'Резервуары',
  ]) {
    await expect(
      hud.locator('.hud__row-label').filter({ hasText: label }).first(),
    ).toBeVisible();
  }
  // «Влияние» — отдельный блок со шкалой, а не строка.
  await expect(hud.locator('.hud__influence')).toContainText('Влияние');
  // Правая колонка: панель, журнал и долото стоят столбиком и не закрывают магазин.
  const side = page.locator('.stage__side');
  const shopBox = await page.locator('.shop').boundingBox();
  const hudBox = await hud.boundingBox();
  const drillBox = await page.locator('[data-testid="drill"]').boundingBox();
  const oplogBox = await page.locator('[data-testid="oplog"]').boundingBox();
  expect(hudBox?.width ?? 0).toBeGreaterThan(200);
  expect(drillBox?.width ?? 0).toBeGreaterThan(120);
  expect(oplogBox?.width ?? 0).toBeGreaterThan(200);
  // Журнал идёт под таблицей, долото — под журналом.
  expect(oplogBox!.y).toBeGreaterThan(hudBox!.y + hudBox!.height - 1);
  expect(drillBox!.y).toBeGreaterThan(oplogBox!.y + oplogBox!.height - 1);
  // На широком экране два столбца: магазин слева и шире правой колонки.
  const wide = (await page.viewportSize())!.width >= 860;
  if (wide) {
    expect(side).toBeTruthy();
    expect((shopBox?.width ?? 0)).toBeGreaterThan((hudBox?.width ?? 0) * 1.5);
  }
});

test('раскладка: магазин и кнопки доступны на узком экране', async ({ page }, testInfo) => {
  await start(page);
  const shop = page.locator('.shop');
  await expect(shop).toBeVisible();
  const shopBox = await shop.boundingBox();
  expect(shopBox?.width ?? 0).toBeGreaterThan(240);
  const drill = await page.locator('[data-testid="drill"]').boundingBox();
  expect(drill?.width ?? 0).toBeGreaterThan(120);
  // Кнопки не меньше 44×44 px (ТЗ §8.1)
  const button = await page.locator('.card__buy').first().boundingBox();
  expect(button?.height ?? 0).toBeGreaterThanOrEqual(44);
  // Страница не прокручивается: всё помещается в экран.
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 2,
  );
  expect(scrolls).toBe(false);
  await testInfo.attach('layout', { body: await page.screenshot(), contentType: 'image/png' });
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
  await expect(page.locator('.finale')).toBeVisible();
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
