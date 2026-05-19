'use strict';

const request = require('supertest');
const app = require('../server');
const { truncateAll, seedUser, closePool } = require('./helpers/db');
const { getToken } = require('./helpers/auth');

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

let token;
let user;

beforeAll(async () => {
  await truncateAll();
  user = await seedUser({ username: 'profiledriver', email: 'profile@smcorse.test' });
  token = await getToken(app, user.username, user.plainPassword);
});

afterAll(async () => {
  await closePool();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

// ── GET /api/team/profile ─────────────────────────────────────────────────────

describe('GET /api/team/profile', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/team/profile');
    expect(res.status).toBe(401);
  });

  it('returns the current user profile', async () => {
    const res = await request(app).get('/api/team/profile').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.username).toBe(user.username);
  });
});

// ── PATCH /api/team/profile ───────────────────────────────────────────────────

describe('PATCH /api/team/profile', () => {
  it('updates iracing_name and returns updated profile', async () => {
    const res = await request(app)
      .patch('/api/team/profile')
      .set(auth())
      .send({ iracing_name: 'TestDriver99' });
    expect(res.status).toBe(200);
    expect(res.body.iracing_name).toBe('TestDriver99');
  });
});

// ── PATCH /api/team/profile/username ─────────────────────────────────────────

describe('PATCH /api/team/profile/username', () => {
  it('returns 400 when username is missing', async () => {
    const res = await request(app).patch('/api/team/profile/username').set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('updates username and returns { id, username }', async () => {
    const res = await request(app)
      .patch('/api/team/profile/username')
      .set(auth())
      .send({ username: 'newuniq_profile' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('username', 'newuniq_profile');
    // Update local for subsequent tests
    user.username = 'newuniq_profile';
    token = await getToken(app, user.username, user.plainPassword);
  });
});

// ── POST /api/team/profile/password ──────────────────────────────────────────

describe('POST /api/team/profile/password', () => {
  it('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/team/profile/password').set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for wrong current password', async () => {
    const res = await request(app).post('/api/team/profile/password').set(auth()).send({
      current_password: 'wrongpassword',
      new_password: 'NewPass123!',
    });
    expect(res.status).toBe(401);
  });

  it('changes password successfully', async () => {
    const res = await request(app).post('/api/team/profile/password').set(auth()).send({
      current_password: user.plainPassword,
      new_password: 'NewPassword456!',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    user.plainPassword = 'NewPassword456!';
    token = await getToken(app, user.username, user.plainPassword);
  });
});

// ── GET /api/team/drivers ─────────────────────────────────────────────────────

describe('GET /api/team/drivers', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/team/drivers');
    expect(res.status).toBe(401);
  });

  it('returns a list of active users', async () => {
    const res = await request(app).get('/api/team/drivers').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('username');
  });
});

// ── GET /api/team/members ─────────────────────────────────────────────────────

describe('GET /api/team/members', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/team/members');
    expect(res.status).toBe(401);
  });

  it('returns an array of team members', async () => {
    const res = await request(app).get('/api/team/members').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
