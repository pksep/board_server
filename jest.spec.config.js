module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@pksep/zod-shared$': '<rootDir>/packages/zod-shared/dist/index.js'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  rootDir: './',
  transformIgnorePatterns: ['node_modules/(?!(mime)/)'],
  maxWorkers: '30%',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest'
  },
  globals: {
    'ts-jest': {
      diagnostics: {
        warnOnly: true
      }
    }
  },
  clearMocks: true,
  resetModules: true,
  testTimeout: 31000,
  testRunner: 'jest-circus/runner'
};
