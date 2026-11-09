import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Потоковый пул устраняет fork-worker RPC timeout onTaskUpdate на CI.
    // Симуляции CPU-bound; один worker исключает конкуренцию двух длинных прогонов.
    pool: 'threads',
    maxWorkers: 1,
    // DOM-тесты помечают себя сами: // @vitest-environment happy-dom
  },
});
