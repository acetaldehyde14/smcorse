/**
 * Live site smoke tests — run with:
 *   E2E_EMAIL=... E2E_PASSWORD=... npm run test:live
 *
 * These tests run against https://smcorse.com (configured in playwright.config.ts
 * under the "live-site" project). They check for console errors, HTTP status codes,
 * correct page titles, and auth flow correctness.
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL    = process.env.E2E_EMAIL    ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

// Helper: collect console errors across a page visit
async function withErrors(page: Page, fn: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  await fn();
  return errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('net::ERR_ABORTED') &&
    !e.includes('Could not load image')
  );
}

// Helper: login via API on live site
async function liveLogin(page: Page) {
  const resp = await page.request.post('https://smcorse.com/api/login', {
    data: { email: EMAIL, password: PASSWORD },
  });
  return resp.status();
}

// ── Public pages ──────────────────────────────────────────────────────────────

test('Landing page returns HTTP 200 and has correct title', async ({ page }) => {
  const resp = await page.goto('https://smcorse.com/', { waitUntil: 'domcontentloaded' });
  expect(resp?.status()).toBeLessThan(400);
  await expect(page).toHaveTitle(/SM CORSE|iRacing|enduro/i);
});

test('Landing page has no significant JS console errors', async ({ page }) => {
  const errors = await withErrors(page, () =>
    page.goto('https://smcorse.com/', { waitUntil: 'networkidle' }).then(() => {})
  );
  expect(errors, `Console errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Login button is visible on landing page', async ({ page }) => {
  await page.goto('https://smcorse.com/');
  await expect(page.getByRole('button', { name: /login/i }).first()).toBeVisible();
});

// ── Health endpoint ───────────────────────────────────────────────────────────

test('GET /health returns 200 with healthy status', async ({ request }) => {
  const resp = await request.get('https://smcorse.com/health');
  expect(resp.status()).toBe(200);
  const text = await resp.text();
  expect(text.toLowerCase()).toContain('healthy');
});

// ── Unauthenticated API endpoints ─────────────────────────────────────────────

test('GET /api/races returns 401 without auth', async ({ request }) => {
  const resp = await request.get('https://smcorse.com/api/races');
  expect(resp.status()).toBe(401);
});

test('GET /api/teams returns 401 without auth', async ({ request }) => {
  const resp = await request.get('https://smcorse.com/api/teams');
  expect(resp.status()).toBe(401);
});

test('GET /api/telemetry/sessions returns 401 without auth', async ({ request }) => {
  const resp = await request.get('https://smcorse.com/api/telemetry/sessions');
  expect(resp.status()).toBe(401);
});

// ── Authenticated flows ───────────────────────────────────────────────────────

test.describe('Authenticated flows', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated tests');

  test('Login with valid credentials redirects to /dashboard', async ({ page }) => {
    await page.goto('https://smcorse.com/');
    await page.getByRole('button', { name: /login/i }).first().click();
    await page.getByPlaceholder(/email/i).fill(EMAIL);
    await page.getByPlaceholder(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 20000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('Dashboard page has no console errors after login', async ({ page }) => {
    const status = await liveLogin(page);
    expect(status).toBe(200);

    const errors = await withErrors(page, () =>
      page.goto('https://smcorse.com/dashboard', { waitUntil: 'networkidle' }).then(() => {})
    );
    expect(errors, `Console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  // Parameterized smoke test for each protected page
  const PAGES = [
    { path: '/race',          titlePattern: /race|SM CORSE/i },
    { path: '/team',          titlePattern: /team|SM CORSE/i },
    { path: '/calendar',      titlePattern: /calendar|SM CORSE/i },
    { path: '/settings',      titlePattern: /settings|SM CORSE/i },
    { path: '/live',          titlePattern: /live|SM CORSE/i },
    { path: '/stint-planner', titlePattern: /stint|SM CORSE/i },
    { path: '/laps',          titlePattern: /lap|SM CORSE/i },
  ];

  for (const { path, titlePattern } of PAGES) {
    test(`${path} loads without HTTP errors and no console errors`, async ({ page }) => {
      const status = await liveLogin(page);
      expect(status).toBe(200);

      const errors = await withErrors(page, () =>
        page.goto(`https://smcorse.com${path}`, { waitUntil: 'networkidle' }).then(() => {})
      );
      await expect(page).toHaveTitle(titlePattern);
      expect(errors, `Console errors on ${path}: ${errors.join(' | ')}`).toHaveLength(0);
    });
  }

  test('Unauthenticated visit to /dashboard redirects to /', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('https://smcorse.com/dashboard');
    await page.waitForTimeout(4000);
    // Should be back on landing page
    expect(page.url()).toMatch(/smcorse\.com\/?$/);
  });

  test('Wrong password on live site — stays on landing, shows error', async ({ page }) => {
    await page.goto('https://smcorse.com/');
    await page.getByRole('button', { name: /login/i }).first().click();
    await page.getByPlaceholder(/email/i).fill(EMAIL);
    await page.getByPlaceholder(/password/i).fill('definitelyWrong1234!');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/dashboard');
  });
});
