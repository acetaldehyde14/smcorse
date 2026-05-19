'use strict';

const request = require('supertest');
const app = require('../server');
const { truncateAll, seedUser, closePool } = require('./helpers/db');

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

let user;

beforeAll(async () => {
  await truncateAll();
  user = await seedUser();
});

afterAll(async () => {
  await closePool();
});

// ── POST /api/signup ──────────────────────────────────────────────────────────

describe('POST /api/signup', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/signup').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app).post('/api/signup').send({
      name: 'Test User',
      username: 'newuser1',
      email: 'not-an-email',
      password: 'Password123!',
      discord_user_id: '111111111111111111',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for password shorter than 8 chars', async () => {
    const res = await request(app).post('/api/signup').send({
      name: 'Test User',
      username: 'newuser2',
      email: 'short@smcorse.test',
      password: 'abc',
      discord_user_id: '111111111111111112',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is already taken', async () => {
    const res = await request(app).post('/api/signup').send({
      name: 'Duplicate',
      username: 'dupuser',
      email: user.email,
      password: 'Password123!',
      discord_user_id: '111111111111111113',
    });
    expect(res.status).toBe(400);
  });

  it('creates a new account with valid data', async () => {
    const res = await request(app).post('/api/signup').send({
      name: 'Brand New User',
      username: 'brandnew',
      email: 'brandnew@smcorse.test',
      password: 'Password123!',
      discord_user_id: '111111111111111114',
    });
    expect([200, 201]).toContain(res.status);
  });
});

// ── POST /api/login ───────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  it('returns 400 when email or password is missing', async () => {
    const res = await request(app).post('/api/login').send({ email: user.email });
    expect(res.status).toBe(400);
  });

  it('returns 401 for an unknown email', async () => {
    const res = await request(app).post('/api/login').send({
      email: 'nobody@smcorse.test',
      password: 'Password123!',
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app).post('/api/login').send({
      email: user.email,
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 and sets a session cookie on valid credentials', async () => {
    const res = await request(app).post('/api/login').send({
      email: user.email,
      password: user.plainPassword,
    });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
  });
});

// ── POST /api/auth/login (JWT) ────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 400 when username or password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: user.username });
    expect(res.status).toBe(400);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: user.username,
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 with a token and user on valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: user.username,
      password: user.plainPassword,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.username).toBe(user.username);
  });
});

// ── GET /api/user ─────────────────────────────────────────────────────────────

describe('GET /api/user', () => {
  it('returns 401 or 302 when not authenticated', async () => {
    const res = await request(app).get('/api/user');
    expect([401, 302]).toContain(res.status);
  });

  it('returns the current user when a valid session cookie is present', async () => {
    const agent = request.agent(app);
    await agent.post('/api/login').send({
      email: user.email,
      password: user.plainPassword,
    });
    const res = await agent.get('/api/user');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.username).toBe(user.username);
  });
});

// ── POST /api/auth/validate ───────────────────────────────────────────────────

describe('POST /api/auth/validate', () => {
  it('returns { valid: true } for a valid token', async () => {
    const tokenRes = await request(app).post('/api/auth/login').send({
      username: user.username,
      password: user.plainPassword,
    });
    const token = tokenRes.body.token;

    const res = await request(app)
      .post('/api/auth/validate')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('returns 401 for an invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/validate')
      .set('Authorization', 'Bearer totally-invalid-token');
    expect(res.status).toBe(401);
  });
});
