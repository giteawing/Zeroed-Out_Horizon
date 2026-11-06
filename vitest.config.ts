import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Баланс-симуляции CPU-bound: ограничиваем параллелизм, чтобы worker-ы не голодали.
    maxWorkers: 2,
    // DOM-тесты помечают себя сами: // @vitest-environment happy-dom
  },
});
