import { defineConfig, devices } from '@playwright/test';

/**
 * Дымовой e2e: только настольный Chrome.
 * Мобильные проекты (iPhone 13, Pixel 7) убраны по решению заказчика:
 * игра делается под десктоп, а мобильные прогоны шли долго и падали.
 * Запуск: npm run test:e2e  (нужен браузер: npx playwright install chromium)
 *
 * Тестируем собранную игру через `vite preview`, то есть ровно то,
 * что уедет на хостинг.
 */
/**
 * Свой Chromium для песочниц без доступа к CDN Playwright:
 *   E2E_CHROMIUM_PATH=/путь/к/chromium npm run test:e2e
 * Дополнительные флаги запуска — через E2E_CHROMIUM_ARGS (через пробел).
 * В CI переменные не заданы: используется браузер из `playwright install`.
 */
const chromiumPath = process.env.E2E_CHROMIUM_PATH;
const chromiumArgs = (process.env.E2E_CHROMIUM_ARGS ?? '').split(/\s+/).filter(Boolean);
const launchOptions = chromiumPath
  ? { launchOptions: { executablePath: chromiumPath, args: chromiumArgs } }
  : {};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, ...launchOptions },
    },
  ],
});
