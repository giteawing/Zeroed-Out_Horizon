import { defineConfig } from 'vite';

// base: './' — чтобы сборка работала и на GitHub Pages (в т.ч. из подпапки),
// и на любом статическом хостинге без правок конфига.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Превью-домен песочницы: разрешаем любой Host, иначе dev-сервер
    // отклонит запрос из iframe предпросмотра.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
  },
});
