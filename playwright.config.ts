import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';

if (!process.env.PHASE_A_CONTEXT) throw new Error('Use npm run test:phase-a or npm run test:phase-a:browser');
export default defineConfig({
  testDir: './tests/phase-a-browser',
  outputDir: resolve(dirname(process.env.PHASE_A_CONTEXT), 'browser-private'),
  timeout: 60000,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['json']],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  projects: ['chromium','firefox','webkit'].map(browserName => ({ name: browserName, use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' } })),
});
