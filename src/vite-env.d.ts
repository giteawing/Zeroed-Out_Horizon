/// <reference types="vite/client" />

/** Импорт текстовых файлов как строки (Vite ?raw). */
declare module '*?raw' {
  const content: string;
  export default content;
}
