import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Потоковый пул устраняет fork-worker RPC timeout onTaskUpdate на CI.
    // Баланс-симуляции CPU-bound: ограничиваем параллелизм, чтобы worker-ы не голодали.
    pool: 'threads',
    maxWorkers: 2,
    // DOM-тесты помечают себя сами: // @vitest-environment happy-dom
  },
});
