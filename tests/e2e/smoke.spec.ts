import { expect, test, type Page } from '@playwright/test';

/**
 * Дымовой тест прохождения. Игру целиком он не проходит (это 18 минут),
 * а проверяет ключевые механики на десктопе и телефоне:
 * тап, покупку, вкладки, сохранение, финал и отсутствие ошибок в консоли.
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

async function tapDrill(page: Page, times = 12): Promise<void> {
  const drill = page.locator('[data-testid="drill"]');
  const box = await drill.boundingBox();
  if (!box) throw new Error('скважина не найдена');
  for (let i = 0; i < times; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
  }
}

test('игра запускается без ошибок в консоли', async ({ page }) => {
  await start(page);
  await expect(page.locator('.hud__balance')).toContainText('₦');
  await expect(page.locator('.drill__art')).toHaveAttribute('src', /drill\.svg/);
  await expect(page.locator('.news__item').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('тап начисляет нефтефаники и обновляет баланс', async ({ page }) => {
  await start(page);
  const value = page.locator('.hud__balance');
  const before = (await value.textContent()) ?? '';
  await tapDrill(page, 24);
  await expect
    .poll(async () => (await value.textContent()) !== before, { timeout: 8000 })
    .toBe(true);
});

test('покупка в магазине работает', async ({ page }) => {
  await start(page);
  const buyButtons = page.locator('.card__buy:not([disabled])');
  for (let i = 0; i < 40; i++) {
    if ((await buyButtons.count()) > 0) break;
    await tapDrill(page, 4);
  }
  await expect(buyButtons.first()).toBeVisible();
  await buyButtons.first().click();
  const purchases = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalPurchases: number } } }).__game.state.totalPurchases,
  );
  expect(purchases).toBeGreaterThan(0);
});

test('вкладки магазина переключаются', async ({ page }) => {
  await start(page);
  await page.getByRole('tab', { name: 'Политические' }).click();
  await expect(page.getByRole('tab', { name: 'Политические' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.shop__list')).toContainText('императора');
  await page.getByRole('tab', { name: 'Роскошь' }).click();
  await expect(page.locator('.shop__list')).toContainText('иномарка');
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

test('кнопка звука переключается', async ({ page }) => {
  await start(page);
  const sound = page.locator('.iconbtn--sound');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.locator('.credits__poem')).toContainText('Здесь будет стихотворение');
  await page.getByRole('button', { name: 'Показать статистику' }).click();
  await expect(page.locator('.stats')).toBeVisible();
  expect(errors).toEqual([]);
});
