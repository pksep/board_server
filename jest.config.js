module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@pksep/zod-shared$':
      '<rootDir>/packages/zod-shared/dist/index.js'
  },
  maxWorkers: 4,
  workerIdleMemoryLimit: '1024MB',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  rootDir: './',
  roots: ['<rootDir>/src'],
  testRegex: ['app.e2e-spec.ts', '.*\\.spec\\.ts$'],
  transformIgnorePatterns: ['node_modules/(?!(mime)/)'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        diagnostics: {
          warnOnly: true
        },
        isolatedModules: true
      }
    ]
  },
  clearMocks: true,
  resetModules: true,
  testTimeout: 31000,
  testRunner: 'jest-circus/runner'
};
