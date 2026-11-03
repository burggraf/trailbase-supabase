import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({ ...base, testDir: './tests/sdk-browser-refresh', timeout: 120000 });
