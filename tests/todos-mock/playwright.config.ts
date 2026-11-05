import { defineConfig, devices } from '@playwright/test';
import { basename, dirname, resolve } from 'node:path';

const report = resolve(process.env.DAYLIST_MOCK_REPORT ?? '.runtime/daylist-future-ui/browser-report-private.json');
export default defineConfig({
  testDir: '.', testMatch: 'features.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 3000 },
  outputDir: resolve(dirname(report), `${basename(report, '.json')}-artifacts`),
  reporter: [['json', { outputFile: report }]],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
