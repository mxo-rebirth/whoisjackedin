import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['public/', 'private/', 'art/', 'data/', 'node_modules/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  { files: ['src/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['src/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Filled in by the build.
  { files: ['src/cast.js'], languageOptions: { globals: { CAST_CSS: 'readonly' } } },
];
