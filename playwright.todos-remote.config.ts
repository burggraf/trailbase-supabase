import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testDir: './tests/todos-remote',
  projects: base.projects?.map(project => project.name === 'webkit'
    ? { ...project, use: { ...project.use, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
    : project),
});
