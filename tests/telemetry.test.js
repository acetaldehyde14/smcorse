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
  user = await seedUser({ username: 'telemdriver', email: 'telem@smcorse.test' });
  token = await getToken(app, user.username, user.plainPassword);
});

afterAll(async () => {
  await closePool();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

// ── GET /api/telemetry/sessions ───────────────────────────────────────────────

describe('GET /api/telemetry/sessions', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/telemetry/sessions');
    expect(res.status).toBe(401);
  });

  it('returns an empty sessions array when no sessions exist', async () => {
    const res = await request(app).get('/api/telemetry/sessions').set(auth());
    expect(res.status).toBe(200);
    // Response is { sessions: [] }
    expect(res.body).toHaveProperty('sessions');
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });
});

// ── GET /api/telemetry/all-laps ───────────────────────────────────────────────

describe('GET /api/telemetry/all-laps', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/telemetry/all-laps');
    expect(res.status).toBe(401);
  });

  it('returns an empty laps array when no laps exist', async () => {
    const res = await request(app).get('/api/telemetry/all-laps').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('laps');
    expect(Array.isArray(res.body.laps)).toBe(true);
  });
});

// ── GET /api/telemetry/live/active ────────────────────────────────────────────

describe('GET /api/telemetry/live/active', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/telemetry/live/active');
    expect(res.status).toBe(401);
  });

  it('returns { session_id: null } when nothing is live', async () => {
    const res = await request(app).get('/api/telemetry/live/active').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.session_id).toBeNull();
  });
});

// ── Todos for complex routes ──────────────────────────────────────────────────

it.todo('POST /api/telemetry/upload — multipart file upload (.ibt)');
it.todo('POST /api/telemetry/live/session/start — start live telemetry session');
it.todo('POST /api/telemetry/live/batch — submit frame batch');
it.todo('POST /api/telemetry/live/lap-complete — mark lap complete');
