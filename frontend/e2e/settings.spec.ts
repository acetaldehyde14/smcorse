import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

const EMAIL = process.env.E2E_EMAIL ?? 'test@smcorse.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, EMAIL, PASSWORD);
});

test('/settings page loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  const significant = errors.filter(e => !e.includes('favicon'));
  expect(significant).toHaveLength(0);
});

test('Settings page shows current username pre-filled', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  // There should be an input for username
  const usernameInput = page.getByLabel(/username/i).first();
  await expect(usernameInput).toBeVisible();
  const val = await usernameInput.inputValue();
  expect(val.length).toBeGreaterThan(0);
});

test('Update iRacing name shows success feedback', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');

  const iracingInput = page.getByLabel(/iracing name/i).first();
  if (await iracingInput.isVisible()) {
    await iracingInput.fill('E2EDriver99');
    await page.getByRole('button', { name: /save|update/i }).first().click();
    // Look for success toast or text
    await expect(
      page.getByText(/saved|updated|success/i).first()
    ).toBeVisible({ timeout: 8000 });
  }
});

test('Wrong current password shows error', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');

  // Find password section
  const currentPwInput = page.getByLabel(/current password/i).first();
  if (await currentPwInput.isVisible()) {
    await currentPwInput.fill('totallyWrong!');
    const newPwInput = page.getByLabel(/new password/i).first();
    await newPwInput.fill('NewPass123!');
    await page.getByRole('button', { name: /update password|change password/i }).click();
    await expect(page.getByText(/incorrect|wrong|invalid/i).first()).toBeVisible({ timeout: 8000 });
  }
});
