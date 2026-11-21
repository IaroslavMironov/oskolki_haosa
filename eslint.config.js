// Линтер ловит настоящие ошибки: необъявленное, недостижимое, опечатки. Стиль не проверяем.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'docs/**', 'opt/**', 'media/**', 'tools/autopost/data/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }], // try {} catch {} — нарочно: localStorage бывает недоступен
    },
  },
  // Сайт и кабинет Глашатая выполняются в браузере.
  // Сайт — обычные скрипты по порядку из index.html; общие имена объявляют data.js, opt/*.js, map.js, embers.js.
  { files: ['*.js'], ignores: ['eslint.config.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, OPT_MAP: 'readonly', CodexMap: 'readonly', EmbersSim: 'readonly' } } },
  { files: ['tools/autopost/web/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  // Тесты и рендер-скрипты: код в page.evaluate выполняется в браузере.
  { files: ['tests/**/*.js', 'tools/render-*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
