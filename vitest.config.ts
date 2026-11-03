import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    retry: 0,
    passWithNoTests: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [],
      reportsDirectory: '.runtime/sdk-coverage',
      reporter: ['text', 'json', 'json-summary'],
      reportOnFailure: true,
      thresholds: {
        statements: 95, lines: 95, functions: 95, branches: 90,
        perFile: { statements: 95, lines: 95, functions: 95, branches: 90 },
      },
    },
  },
});
