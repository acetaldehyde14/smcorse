import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-local',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/live-site.spec.ts'],
    },
    {
      name: 'live-site',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'https://smcorse.com',
      },
      testMatch: ['**/live-site.spec.ts'],
    },
  ],
  // webServer is intentionally omitted here — start backend (port 3000) and
  // frontend (port 3001) manually before running local E2E tests.
  // For CI, add webServer entries pointing to the test server processes.
});
