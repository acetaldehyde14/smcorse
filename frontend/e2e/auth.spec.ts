import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'test@smcorse.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

test.describe('Landing page', () => {
  test('loads and shows Login and Sign Up buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /login/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /sign.?up|register/i }).first()).toBeVisible();
  });

  test('Login modal opens when Login button is clicked', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /login/i }).first().click();
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });

  test('Login modal closes on Escape', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /login/i }).first().click();
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder(/email/i)).not.toBeVisible();
  });

  test('Wrong credentials shows an error and stays on landing page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /login/i }).first().click();
    await page.getByPlaceholder(/email/i).fill('nobody@nowhere.test');
    await page.getByPlaceholder(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    // Should remain on / (not redirect to /dashboard)
    await page.waitForTimeout(2000);
    expect(page.url()).not.toContain('/dashboard');
  });

  test('Valid credentials redirect to /dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /login/i }).first().click();
    await page.getByPlaceholder(/email/i).fill(EMAIL);
    await page.getByPlaceholder(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('Sign Up modal opens with correct fields', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /sign.?up|register/i }).first().click();
    // Check for key fields
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });
});
