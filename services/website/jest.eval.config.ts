import type { Config } from 'jest'

/**
 * `npm run eval:chat` — the Host Assistant eval (src/__tests__/evals). A real
 * model on live data, so it costs money and is never part of `npm test`, whose
 * testMatch does not see a `.eval.ts` file.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/evals/**/*.eval.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }],
  },
  maxConcurrency: 4,
  testTimeout: 240_000,
}

export default config
