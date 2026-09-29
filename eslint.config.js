import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly', fetch: 'readonly', AbortController: 'readonly', URL: 'readonly', structuredClone: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] }
  }
];
