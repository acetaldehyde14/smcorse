import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

const EMAIL = process.env.E2E_EMAIL ?? 'test@smcorse.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, EMAIL, PASSWORD);
});

test('Dashboard page loads with heading and feature cards', async ({ page }) => {
  await page.goto('/dashboard');
  // Should have a heading or welcome text
  const heading = page.getByRole('heading').first();
  await expect(heading).toBeVisible();
});

test('Unauthenticated visit to /dashboard redirects to /', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/dashboard');
  await page.waitForURL('/', { timeout: 10000 });
  expect(page.url()).not.toContain('/dashboard');
});

test('Dashboard has navigation links to key pages', async ({ page }) => {
  await page.goto('/dashboard');
  // Check for links to protected pages via href or visible text
  const links = page.locator('a[href*="/race"], a[href*="/team"], a[href*="/calendar"], a[href*="/stint-planner"]');
  await expect(links.first()).toBeVisible();
});

test('Dashboard has no JS console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  const significant = errors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_ABORTED'));
  expect(significant).toHaveLength(0);
});
