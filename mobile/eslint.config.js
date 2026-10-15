const expoConfig = require('eslint-config-expo/flat');
const jestGlobals = { jest: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' };
module.exports = [
  ...expoConfig,
  { ignores: ['dist/*', 'node_modules/*', '.expo/*'] },
  { files: ['**/__tests__/**', 'jest.setup.js'], languageOptions: { globals: jestGlobals } },
];
