import js from '@eslint/js';
import functional from 'eslint-plugin-functional';
import { importX } from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';

// Unicorn's preset is mostly taste, so only the rules that catch bugs or keep data immutable are on.
const unicornRules = Object.fromEntries(
  [
    'error-message',
    'throw-new-error',
    'prefer-type-error',
    'no-instanceof-builtins',
    'prefer-node-protocol',
    'prefer-number-properties',
    'prefer-string-replace-all',
    'prefer-string-slice',
    'prefer-includes',
    'prefer-array-find',
    'prefer-array-some',
    'prefer-set-has',
    'prefer-spread',
    'prefer-at',
    'prefer-structured-clone',
    'no-new-array',
    'no-useless-undefined',
    'no-useless-spread',
    'no-useless-promise-resolve-reject',
    'no-await-in-promise-methods',
    'no-single-promise-in-promise-methods',
    'no-thenable',
    'no-invalid-remove-event-listener',
    'no-array-sort',
    'no-array-reverse',
    'no-array-fill-with-reference-type',
    'no-unsafe-string-replacement',
    'no-chained-comparison',
    'prefer-optional-catch-binding',
    'require-css-escape',
    'prefer-modern-dom-apis',
    'prefer-dom-node-append',
    'prefer-add-event-listener',
    'dom-node-dataset',
  ].map((rule) => [`unicorn/${rule}`, 'error']),
);

export default [
  { ignores: ['public/', 'private/', 'art/', 'data/', 'node_modules/'] },
  js.configs.recommended,
  sonarjs.configs.recommended,
  importX.flatConfigs.recommended,
  {
    plugins: { functional, unicorn },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-param-reassign': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'import-x/no-cycle': 'error',
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      'functional/no-classes': 'error',
      'functional/no-class-inheritance': 'error',
      'functional/no-this-expressions': 'error',
      'functional/no-loop-statements': 'error',
      ...unicornRules,
      // The rain and the made-up history are not security.
      'sonarjs/pseudo-random': 'off',
      'sonarjs/no-nested-template-literals': 'off',
      // The limits of the style guide: small functions, few inputs, shallow nesting.
      'sonarjs/cognitive-complexity': ['error', 15],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 5],
      'max-depth': ['error', 2],
    },
  },
  { files: ['src/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['src/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Filled in by the build.
  { files: ['src/cast.js'], languageOptions: { globals: { CAST_CSS: 'readonly' } } },
  // Helpers are a lower layer and may loop: lib/helpers/ for the server, src/helpers/ for the page, the scripts
  // and the tests. Everything else uses array methods.
  {
    files: ['lib/helpers/**', 'src/helpers/**', 'scripts/**', 'test/**'],
    rules: { 'functional/no-loop-statements': 'off' },
  },
  // node:test files register their tests through calls the plugin cannot see.
  { files: ['test/**'], rules: { 'sonarjs/no-empty-test-file': 'off' } },
];
