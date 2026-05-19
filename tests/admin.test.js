'use strict';

const request = require('supertest');
const app = require('../server');
const { truncateAll, seedUser, pool, closePool } = require('./helpers/db');

jest.mock('../src/config/llama', () => ({
  isAvailable: jest.fn().mockResolvedValue(false),
  generate: jest.fn().mockResolvedValue('mocked'),
  chat: jest.fn().mockResolvedValue('mocked'),
  generateCoaching: jest.fn().mockResolvedValue('mocked'),
}));

jest.mock('../src/services/notifications', () => ({
  initTelegram: jest.fn(),
  initDiscord: jest.fn(),
  shutdownBots: jest.fn(),
  startStintAlerts: jest.fn(),
  stopStintAlerts: jest.fn(),
  notifyDriverChange: jest.fn().mockResolvedValue(undefined),
  notifyBoxedAndOut: jest.fn().mockResolvedValue(undefined),
  notifyLowFuel: jest.fn().mockResolvedValue(undefined),
  notifyUpcomingStint: jest.fn().mockResolvedValue(undefined),
  getTeamIdForRace: jest.fn().mockResolvedValue(null),
  sendDiscordTeamChannel: jest.fn().mockResolvedValue(false),
  sendTeamDiscordAlert: jest.fn().mockResolvedValue(false),
  checkUpcomingStints: jest.fn().mockResolvedValue(undefined),
}));

let adminAgent;
let adminUser;
let normalUser;

// Admin routes use session-based auth (requireAdmin middleware checks req.session.userId + is_admin)
// So we use supertest agent to persist the session cookie

beforeAll(async () => {
  await truncateAll();
  adminUser = await seedUser({ username: 'adminuser', email: 'admin@smcorse.test', is_admin: true });
  normalUser = await seedUser({ username: 'normaluser', email: 'normal@smcorse.test', is_admin: false });

  // Log in as admin via session
  adminAgent = request.agent(app);
  const loginRes = await adminAgent.post('/api/login').send({
    email: adminUser.email,
    password: adminUser.plainPassword,
  });
  expect(loginRes.status).toBe(200);
});

afterAll(async () => {
  await closePool();
});

// ── GET /health ───────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});

// ── Unauthenticated admin routes ──────────────────────────────────────────────

describe('Admin routes — unauthenticated', () => {
  it('GET /api/admin/stats returns 401 or redirect', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect([401, 302, 403]).toContain(res.status);
  });

  it('GET /api/admin/users returns 401 or redirect', async () => {
    const res = await request(app).get('/api/admin/users');
    expect([401, 302, 403]).toContain(res.status);
  });
});

// ── Non-admin session ─────────────────────────────────────────────────────────

describe('Admin routes — non-admin user', () => {
  let normalAgent;

  beforeAll(async () => {
    normalAgent = request.agent(app);
    await normalAgent.post('/api/login').send({
      email: normalUser.email,
      password: normalUser.plainPassword,
    });
  });

  it('GET /api/admin/stats returns 403', async () => {
    const res = await normalAgent.get('/api/admin/stats');
    expect(res.status).toBe(403);
  });
});

// ── Admin session ─────────────────────────────────────────────────────────────

describe('Admin routes — admin user', () => {
  it('GET /api/admin/stats returns counts', async () => {
    const res = await adminAgent.get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
  });

  it('GET /api/admin/users returns user list', async () => {
    const res = await adminAgent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('PATCH /api/admin/users/:id/admin toggles admin flag', async () => {
    const res = await adminAgent
      .patch(`/api/admin/users/${normalUser.id}/admin`)
      .send({ is_admin: true });
    expect(res.status).toBe(200);
  });

  it('PATCH own admin status returns 400', async () => {
    const res = await adminAgent
      .patch(`/api/admin/users/${adminUser.id}/admin`)
      .send({ is_admin: false });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/admin/users/:id removes a user', async () => {
    const extraUser = await seedUser({ username: 'deleteme', email: 'deleteme@smcorse.test' });
    const res = await adminAgent.delete(`/api/admin/users/${extraUser.id}`);
    expect(res.status).toBe(200);
  });

  it('DELETE own account returns 400', async () => {
    const res = await adminAgent.delete(`/api/admin/users/${adminUser.id}`);
    expect(res.status).toBe(400);
  });
});
