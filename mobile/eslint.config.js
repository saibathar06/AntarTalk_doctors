const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['node_modules/', '.expo/', 'dist/'],
    // Screens deliberately start asynchronous server reads after mounting. These
    // are not synchronous derived-state updates; API callbacks own the state.
    rules: { 'react-hooks/set-state-in-effect': 'off' }
  }
]);
