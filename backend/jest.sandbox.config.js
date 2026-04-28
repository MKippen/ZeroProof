/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '<rootDir>/tests/sandbox/**/*.test.ts',
    '<rootDir>/tests/integration/api/apiIntegration.test.ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/tests/sandbox/setup.ts'],
  setupFilesAfterEnv: [],
  testTimeout: 60000,
  verbose: true,
};
