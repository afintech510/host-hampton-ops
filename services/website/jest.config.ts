import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // Same as tsconfig.json except `jsx: react-jsx`: Next compiles JSX itself (`jsx: preserve`), ts-jest cannot.
      tsconfig: 'tsconfig.jest.json',
      diagnostics: false,
    }],
  },
}

export default config
