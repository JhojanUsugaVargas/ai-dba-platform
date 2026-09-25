// jest.config.cjs
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
};
