import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

const EMAIL = process.env.E2E_EMAIL ?? 'test@smcorse.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, EMAIL, PASSWORD);
});

test('/race page loads without crashing', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/race');
  await page.waitForLoadState('networkidle');
  const significant = errors.filter(e => !e.includes('favicon'));
  expect(significant).toHaveLength(0);
});

test('/race shows an empty state or race list', async ({ page }) => {
  await page.goto('/race');
  await page.waitForLoadState('networkidle');
  // Page should have rendered content (not blank)
  const body = await page.locator('body').textContent();
  expect(body?.length).toBeGreaterThan(50);
});

test('Create new race button is visible', async ({ page }) => {
  await page.goto('/race');
  await page.waitForLoadState('networkidle');
  const createBtn = page.getByRole('button', { name: /new race|create race/i }).first();
  await expect(createBtn).toBeVisible();
});

test('Creating a race adds it to the list', async ({ page }) => {
  await page.goto('/race');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new race|create race/i }).first().click();
  // Fill race name — look for a visible input
  const nameInput = page.getByPlaceholder(/race name|name/i).first();
  await nameInput.fill('E2E Test Race');

  // Submit — look for confirm/create button in the modal or inline form
  await page.getByRole('button', { name: /create|save|confirm/i }).first().click();

  // Race should appear in the list
  await expect(page.getByText('E2E Test Race')).toBeVisible({ timeout: 8000 });
});
