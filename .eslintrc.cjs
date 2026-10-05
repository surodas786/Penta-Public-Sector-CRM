module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'dist-demo',
    'dist-server',
    'node_modules',
    'server/db/migrations',
    '.eslintrc.cjs',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // A leading underscore is the project's marker for a binding that exists
    // to satisfy a signature or a destructuring shape and is intentionally
    // unused (Express error handlers, discarded response fields in tests).
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },
  overrides: [
    {
      // Server, shared contracts and build scripts run on Node, not in a browser.
      files: ['server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts', '*.config.ts', '*.cjs'],
      env: { node: true, browser: false },
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
    {
      files: ['server/tests/**/*.ts'],
      env: { node: true, browser: false },
      rules: {
        // Tests assert on `any`-shaped response bodies from supertest.
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
