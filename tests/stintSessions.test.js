'use strict';

const request = require('supertest');
const app = require('../server');
const { truncateAll, seedUser, seedTeam, closePool } = require('./helpers/db');
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

// Mock axios so AI-plan calls don't hit an external server
jest.mock('axios');
const axios = require('axios');

let token;
let user;

beforeAll(async () => {
  await truncateAll();
  user = await seedUser({ username: 'stintdriver', email: 'stint@smcorse.test' });
  token = await getToken(app, user.username, user.plainPassword);
});

afterAll(async () => {
  await closePool();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

// ── GET /api/team/stint-sessions ──────────────────────────────────────────────

describe('GET /api/team/stint-sessions', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/team/stint-sessions');
    expect(res.status).toBe(401);
  });

  it('returns an empty array when no sessions exist', async () => {
    const res = await request(app).get('/api/team/stint-sessions').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── POST /api/team/stint-sessions ────────────────────────────────────────────

describe('POST /api/team/stint-sessions', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/team/stint-sessions').set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('creates a session with just a name', async () => {
    const res = await request(app)
      .post('/api/team/stint-sessions')
      .set(auth())
      .send({ name: 'Spa 24h Plan' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Spa 24h Plan');
    expect(res.body).toHaveProperty('config');
    expect(res.body).toHaveProperty('plan');
  });

  it('stores team_id in config when provided', async () => {
    const team = await seedTeam(user.id, { name: 'Config Team' });
    const res = await request(app)
      .post('/api/team/stint-sessions')
      .set(auth())
      .send({ name: 'With Team', team_id: team.id });
    expect(res.status).toBe(201);
    expect(res.body.config).toHaveProperty('team_id', team.id);
  });
});

// ── GET /api/team/stint-sessions/:id ─────────────────────────────────────────

describe('GET /api/team/stint-sessions/:id', () => {
  let sessionId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/team/stint-sessions')
      .set(auth())
      .send({ name: 'Readable Session' });
    sessionId = res.body.id;
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(app).get('/api/team/stint-sessions/99999').set(auth());
    expect(res.status).toBe(404);
  });

  it('returns the session for a valid id', async () => {
    const res = await request(app).get(`/api/team/stint-sessions/${sessionId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', sessionId);
    expect(res.body).toHaveProperty('name');
  });
});

// ── PUT /api/team/stint-sessions/:id ─────────────────────────────────────────

describe('PUT /api/team/stint-sessions/:id', () => {
  let sessionId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/team/stint-sessions')
      .set(auth())
      .send({ name: 'Updatable Session' });
    sessionId = res.body.id;
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .put('/api/team/stint-sessions/99999')
      .set(auth())
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  it('updates the session name', async () => {
    const res = await request(app)
      .put(`/api/team/stint-sessions/${sessionId}`)
      .set(auth())
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('updates the availability JSONB field', async () => {
    const avail = { '1': { '8': 'free', '9': 'inconvenient' } };
    const res = await request(app)
      .put(`/api/team/stint-sessions/${sessionId}`)
      .set(auth())
      .send({ availability: avail });
    expect(res.status).toBe(200);
    expect(res.body.availability).toMatchObject(avail);
  });
});

// ── DELETE /api/team/stint-sessions/:id ──────────────────────────────────────

describe('DELETE /api/team/stint-sessions/:id', () => {
  it('returns 404 for non-existent id', async () => {
    const res = await request(app).delete('/api/team/stint-sessions/99999').set(auth());
    expect(res.status).toBe(404);
  });

  it('deletes session and returns { ok: true }', async () => {
    const createRes = await request(app)
      .post('/api/team/stint-sessions')
      .set(auth())
      .send({ name: 'Delete Me' });
    const res = await request(app)
      .delete(`/api/team/stint-sessions/${createRes.body.id}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /api/team/stint-planner/ai-plan ─────────────────────────────────────

describe('POST /api/team/stint-planner/ai-plan', () => {
  it('returns 400 when session_id is missing', async () => {
    const res = await request(app)
      .post('/api/team/stint-planner/ai-plan')
      .set(auth())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent session_id', async () => {
    const res = await request(app)
      .post('/api/team/stint-planner/ai-plan')
      .set(auth())
      .send({ session_id: 99999 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when no drivers are selected', async () => {
    const sessionRes = await request(app)
      .post('/api/team/stint-sessions')
      .set(auth())
      .send({ name: 'AI Plan No Drivers' });
    const res = await request(app)
      .post('/api/team/stint-planner/ai-plan')
      .set(auth())
      .send({ session_id: sessionRes.body.id });
    expect(res.status).toBe(400);
  });
});
