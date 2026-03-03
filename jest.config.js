module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // marked ships ESM-only; redirect to its UMD build for Jest's CJS environment.
  // TODO: install babel-jest to properly fix all ESM-only package issues.
  moduleNameMapper: {
    '^marked$': '<rootDir>/node_modules/marked/lib/marked.umd.js',
  },
  // journal-parser imports unified/remark-parse (ESM-only) which cannot load in Jest CJS mode.
  testPathIgnorePatterns: [
    '/node_modules/',
    'journal-parser.test.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/tests/'],
  verbose: true,
  testTimeout: 10000,
};
