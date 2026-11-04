import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // DOM-тесты помечают себя сами: // @vitest-environment happy-dom
  },
});
