// @ts-check
/**
 * Линтер ловит то, чего не видит компилятор: промис, результат которого никто
 * не ждёт, выражение без действия (запятая вместо точки с запятой), работу с
 * `any` в обход типов, сравнение через `==`.
 *
 * Типы, неиспользуемые имена и неопределённые идентификаторы проверяет `tsc` —
 * и в TypeScript, и в скриптах `.mjs` (в них стоит `// @ts-check`). Запуск:
 * `npm run lint`; в CI — отдельный шаг.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Код интерфейса: тексты для игрока берутся только из `texts.json`.
 * Тот же список проверяет `tests/content.test.ts` — правило здесь нужно,
 * чтобы ошибку было видно в редакторе, а не только в тестах.
 */
const UI_FILES = ['src/ui/**/*.ts', 'src/fx/**/*.ts', 'src/audio/**/*.ts', 'src/main.ts'];

const CYRILLIC_IN_UI = 'Russian text in UI code: move it to src/content/texts.json and read it through Texts.';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/', 'coverage/'] },
  // Отключение правила, которое уже ничего не отключает, — тоже ошибка.
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Неопределённое имя — ошибка компиляции: tsc проверяет каждый файл,
      // который видит линтер, и знает глобальные имена Node и браузера.
      'no-undef': 'off',
      // Имя с подчёркиванием — намеренно неиспользуемое (как и для tsc).
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // `!` после доступа по индексу (`match[1]!`) сейчас не меняет тип, но
      // станет обязательным с `noUncheckedIndexedAccess`; как пометка «здесь
      // значение есть» он оставлен намеренно.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: UI_FILES,
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'Literal[value=/[\\u0400-\\u04FF]/]', message: CYRILLIC_IN_UI },
        { selector: 'TemplateElement[value.raw=/[\\u0400-\\u04FF]/]', message: CYRILLIC_IN_UI },
      ],
    },
  },
);
