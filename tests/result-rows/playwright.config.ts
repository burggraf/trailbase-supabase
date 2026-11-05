import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';

const report = process.env.SDK_RESULT_ROWS_REPORT;
if (!report) throw new Error('SDK_RESULT_ROWS_REPORT must name a fresh owned report path');
export default defineConfig({
  testDir: '.', testMatch: 'rows.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, globalTimeout: 600000,
  outputDir: resolve(dirname(report), 'browser-artifacts'), reporter: [['json', { outputFile: resolve(report) }]],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
