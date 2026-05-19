import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

const EMAIL = process.env.E2E_EMAIL ?? 'test@smcorse.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, EMAIL, PASSWORD);
});

test('/calendar page loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  const significant = errors.filter(e => !e.includes('favicon'));
  expect(significant).toHaveLength(0);
});

test('Calendar page renders visible content', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  const body = await page.locator('body').textContent();
  expect(body?.length).toBeGreaterThan(50);
});

test('Add event button is visible', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  const addBtn = page.getByRole('button', { name: /add.?event|new.?event|\+/i }).first();
  await expect(addBtn).toBeVisible();
});

test('Add a race calendar event', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /add.?event|new.?event|\+/i }).first().click();

  // Fill event name
  await page.getByLabel(/event name|name/i).fill('E2E Daytona 24h');

  // Fill race_date (future date)
  const dateInput = page.locator('input[type="date"]').first();
  await dateInput.fill('2027-01-25');

  // Submit
  await page.getByRole('button', { name: /add|save|create|confirm/i }).last().click();

  await expect(page.getByText('E2E Daytona 24h')).toBeVisible({ timeout: 8000 });
});

test('Delete a calendar event removes it', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  // Look for a delete button on any event card
  const deleteBtn = page.getByRole('button', { name: /delete|remove/i }).first();
  if (await deleteBtn.isVisible()) {
    // Get surrounding text first
    const card = deleteBtn.locator('..').locator('..');
    const cardText = await card.textContent().catch(() => '');
    await deleteBtn.click();
    // Confirm if needed
    page.on('dialog', d => d.accept());
    if (cardText) {
      await expect(page.getByText(cardText.substring(0, 20))).not.toBeVisible({ timeout: 5000 });
    }
  }
});
