import type { Page } from '@playwright/test';

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3000';

/**
 * Login via direct API call (fast, skips UI).
 * Sets the session cookie on the browser context, then navigates to /dashboard.
 */
export async function loginViaAPI(page: Page, email: string, password: string) {
  await page.request.post(`${API_URL}/api/login`, {
    data: { email, password },
  });
  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

/**
 * Login via the landing page UI modal.
 * Navigates to /, opens the login modal, fills email + password, submits.
 * Waits for redirect to /dashboard.
 */
export async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/');
  // Click the login button to open modal
  await page.getByRole('button', { name: /login/i }).first().click();
  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}
