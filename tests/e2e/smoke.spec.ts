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

/**
 * Тап по скважине.
 * Игра слушает pointerdown, поэтому обычный click() тоже его порождает.
 * Используем locator.click(): Playwright сам ждёт, пока элемент не перекрыт,
 * и в случае промаха сообщает, какой элемент мешает.
 */
async function tapDrill(page: Page, times = 12): Promise<void> {
  const drill = page.locator('[data-testid="drill"]');
  await expect(drill).toBeVisible();
  for (let i = 0; i < times; i++) {
    await drill.click();
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
  // Кошелёк с нефтефаниками живёт в шапке, а не в панели.
  await expect(page.locator('.topbar__coins')).toContainText('₦');
  await expect(page.locator('.drill__art')).toHaveAttribute('src', /drill\.svg/);
  await expect(page.locator('.news__item').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('тап добывает нефть, а не нефтефаники', async ({ page }) => {
  await start(page);
  const before = await page.evaluate(
    () =>
      (window as unknown as {
        __game: { state: { oil: number; totalTaps: number; totalSold: number } };
      }).__game.state,
  );
  await tapDrill(page, 24);
  const after = await page.evaluate(
    () =>
      (window as unknown as {
        __game: { state: { oil: number; totalTaps: number; totalSold: number } };
      }).__game.state,
  );
  // Каждый тап — это тап по нефти, а не начисление нефтефаников.
  expect(after.totalTaps).toBeGreaterThan(before.totalTaps + 20);
  // Контракты измеряются в тысячах тонн, поэтому добытая нефть сразу уходит
  // на сбыт: резервуар может быть пуст, но тонны проданы.
  expect(after.oil + after.totalSold).toBeGreaterThan(before.oil + before.totalSold);
  // Панель империи показывает ту же нефть в резервуарах: «{oil} / {capacity} т».
  await expect(page.locator('.hud__oil .hud__row-value')).toContainText('т');
});

test('нефть продаётся, и нефтефаники капают со сбыта', async ({ page }) => {
  await start(page);
  const balance = page.locator('.topbar__coins');
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
  const before = await page.evaluate(
    () => (window as unknown as { __game: { state: { totalTaps: number } } }).__game.state.totalTaps,
  );
  expect(before).toBeGreaterThan(0);
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
    'Добыча в сутки',
    'Цена тонны',
    'Доход в секунду',
    'Зарплаты',
    'Чиновники',
    'Резервуары',
    'Скважины',
    'Активы',
  ]) {
    await expect(
      hud.locator('.hud__row-label').filter({ hasText: label }).first(),
    ).toBeVisible();
  }
  // Три смысловые группы панели, «Влияние» — отдельный блок со шкалой.
  for (const group of ['goods', 'money', 'property']) {
    await expect(hud.locator(`[data-group="${group}"]`)).toBeVisible();
  }
  await expect(hud).toContainText('Влияние');
  // Правая колонка: панель, журнал и долото стоят столбиком и не закрывают магазин.
  const side = page.locator('.stage__side');
  const shopBox = await page.locator('.shop').boundingBox();
  const hudBox = await hud.boundingBox();
  const drillBox = await page.locator('[data-testid="drill"]').boundingBox();
  const oplogBox = await page.locator('[data-testid="oplog"]').boundingBox();
  expect(hudBox?.width ?? 0).toBeGreaterThan(200);
  expect(drillBox?.width ?? 0).toBeGreaterThan(120);
  expect(oplogBox?.width ?? 0).toBeGreaterThan(200);
  // Журнал идёт под таблицей, долото — под журналом (десктопная раскладка).
  expect(oplogBox!.y).toBeGreaterThan(hudBox!.y + hudBox!.height - 1);
  const drillBlock = await page.locator('.stage__drill').boundingBox();
  expect(drillBlock!.y).toBeGreaterThan(oplogBox!.y + oplogBox!.height - 1);
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
