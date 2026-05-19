import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

const EMAIL = process.env.E2E_EMAIL ?? 'test@smcorse.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, EMAIL, PASSWORD);
});

test('/team page loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/team');
  await page.waitForLoadState('networkidle');
  const significant = errors.filter(e => !e.includes('favicon'));
  expect(significant).toHaveLength(0);
});

test('Create a new team via inline form', async ({ page }) => {
  await page.goto('/team');
  await page.waitForLoadState('networkidle');

  // Click + New button
  await page.getByRole('button', { name: /\+\s*new|new team/i }).click();

  // Fill team name
  await page.getByPlaceholder(/team name/i).fill('E2E Test Team');
  // Optionally fill Discord Channel ID
  const channelInput = page.getByPlaceholder(/discord channel id/i);
  if (await channelInput.isVisible()) {
    await channelInput.fill('123456789012345678');
  }

  // Confirm with checkmark button
  await page.getByTitle('Confirm').click();

  // Team should appear in sidebar
  await expect(page.getByText('E2E Test Team')).toBeVisible({ timeout: 8000 });
});

test('Add member to team', async ({ page }) => {
  await page.goto('/team');
  await page.waitForLoadState('networkidle');

  // Select first team in sidebar if one exists
  const firstTeam = page.locator('aside button, aside [role="button"]').first();
  if (await firstTeam.isVisible()) await firstTeam.click();

  // Click Add Member
  const addBtn = page.getByRole('button', { name: /add member/i });
  await expect(addBtn).toBeVisible({ timeout: 5000 });
  await addBtn.click();

  // Fill name in modal
  await page.getByPlaceholder(/full name|name/i).fill('E2E Driver');
  await page.getByRole('button', { name: /add member|save/i }).click();

  await expect(page.getByText('E2E Driver')).toBeVisible({ timeout: 8000 });
});

test('Delete team button is visible on hover', async ({ page }) => {
  await page.goto('/team');
  await page.waitForLoadState('networkidle');

  // Hover over a team row to reveal the delete button
  const teamRow = page.locator('aside .group').first();
  if (await teamRow.isVisible()) {
    await teamRow.hover();
    const deleteBtn = teamRow.getByTitle('Delete team');
    await expect(deleteBtn).toBeVisible({ timeout: 3000 });
  }
});
