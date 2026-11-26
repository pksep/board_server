module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2021: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended'
  ],
  globals: {
    $: 'readonly'
  },
  overrides: [
    {
      files: ['src/**/*.ts'],
      excludedFiles: ['src/**/*.spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              ':matches(TSAsExpression, TSTypeAssertion) > :matches(TSAsExpression, TSTypeAssertion).expression',
            message:
              'Цепочки приведений скрывают несовместимость типов. Исправьте контракт или проверьте неизвестные данные.'
          }
        ]
      }
    },
    {
      env: {
        node: true
      },
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script'
      }
    }
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    'no-var': 'error',
    'prefer-const': 'warn',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/packages/zod-shared/**'],
            message:
              'Используйте алиас "@pksep/zod-shared" вместо прямого импорта из "packages/zod-shared"'
          }
        ]
      }
    ],
    'prettier/prettier': [
      'warn',
      {
        endOfLine: 'auto',
        singleQuote: true,
        trailingComma: 'none',
        tabWidth: 2,
        useTabs: false,
        printWidth: 80,
        semi: true,
        bracketSpacing: true,
        arrowParens: 'avoid'
      }
    ]
  }
};
