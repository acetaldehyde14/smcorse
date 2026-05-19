'use strict';

const request = require('supertest');
const app = require('../server');
const { truncateAll, seedUser, seedRace, closePool } = require('./helpers/db');
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
  user = await seedUser({ username: 'racedriver', email: 'race@smcorse.test' });
  token = await getToken(app, user.username, user.plainPassword);
});

afterAll(async () => {
  await closePool();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

// ── GET /api/races ────────────────────────────────────────────────────────────

describe('GET /api/races', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/races');
    expect(res.status).toBe(401);
  });

  it('returns an empty array when no races exist', async () => {
    const res = await request(app).get('/api/races').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── POST /api/races ───────────────────────────────────────────────────────────

describe('POST /api/races', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/races').set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('creates a race with just a name', async () => {
    const res = await request(app).post('/api/races').set(auth()).send({ name: 'Spa 24h' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Spa 24h');
    expect(res.body.is_active).toBe(false);
  });

  it('creates a race with name and track', async () => {
    const res = await request(app).post('/api/races').set(auth()).send({ name: 'Le Mans', track: 'Le Mans' });
    expect(res.status).toBe(201);
    expect(res.body.track).toBe('Le Mans');
  });
});

// ── GET /api/races/active ─────────────────────────────────────────────────────

describe('GET /api/races/active', () => {
  beforeAll(async () => {
    await truncateAll();
    user = await seedUser({ username: 'racedriver2', email: 'race2@smcorse.test' });
    token = await getToken(app, user.username, user.plainPassword);
  });

  it('returns 404 when no race is active', async () => {
    const res = await request(app).get('/api/races/active').set(auth());
    expect(res.status).toBe(404);
  });
});

// ── POST /api/races/:id/start and /end ───────────────────────────────────────

describe('Race lifecycle', () => {
  let race;

  beforeAll(async () => {
    await truncateAll();
    user = await seedUser({ username: 'racedriver3', email: 'race3@smcorse.test' });
    token = await getToken(app, user.username, user.plainPassword);
    race = await seedRace(user.id);
  });

  it('POST /:id/start returns 404 for non-existent race', async () => {
    const res = await request(app).post('/api/races/99999/start').set(auth()).send({});
    expect(res.status).toBe(404);
  });

  it('POST /:id/start marks race active', async () => {
    const res = await request(app).post(`/api/races/${race.id}/start`).set(auth()).send({});
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(true);
    expect(res.body.started_at).toBeTruthy();
  });

  it('GET /active returns the started race', async () => {
    const res = await request(app).get('/api/races/active').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(race.id);
  });

  it('POST /:id/end marks race inactive', async () => {
    const res = await request(app).post(`/api/races/${race.id}/end`).set(auth()).send({});
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
    expect(res.body.ended_at).toBeTruthy();
  });
});

// ── POST /api/races/:id/event ─────────────────────────────────────────────────

describe('POST /api/races/:id/event', () => {
  let race;

  beforeAll(async () => {
    await truncateAll();
    user = await seedUser({ username: 'racedriver4', email: 'race4@smcorse.test' });
    token = await getToken(app, user.username, user.plainPassword);
    race = await seedRace(user.id);
    await request(app).post(`/api/races/${race.id}/start`).set(auth()).send({});
  });

  it('returns 400 when event_type is missing', async () => {
    const res = await request(app).post(`/api/races/${race.id}/event`).set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for driver_change without driver_name', async () => {
    const res = await request(app).post(`/api/races/${race.id}/event`).set(auth()).send({
      event_type: 'driver_change',
    });
    expect(res.status).toBe(400);
  });

  it('logs a driver_change event and returns { ok: true }', async () => {
    const res = await request(app).post(`/api/races/${race.id}/event`).set(auth()).send({
      event_type: 'driver_change',
      driver_name: 'TestDriver',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 for fuel_update without fuel_level', async () => {
    const res = await request(app).post(`/api/races/${race.id}/event`).set(auth()).send({
      event_type: 'fuel_update',
    });
    expect(res.status).toBe(400);
  });

  it('logs a fuel_update event and returns { ok: true }', async () => {
    const res = await request(app).post(`/api/races/${race.id}/event`).set(auth()).send({
      event_type: 'fuel_update',
      fuel_level: 45.5,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── GET /api/races/:id/state ──────────────────────────────────────────────────

describe('GET /api/races/:id/state', () => {
  let race;

  beforeAll(async () => {
    await truncateAll();
    user = await seedUser({ username: 'racedriver5', email: 'race5@smcorse.test' });
    token = await getToken(app, user.username, user.plainPassword);
    race = await seedRace(user.id);
  });

  it('returns 404 for non-existent race', async () => {
    const res = await request(app).get('/api/races/99999/state').set(auth());
    expect(res.status).toBe(404);
  });

  it('returns { race, state, last_fuel } for a known race', async () => {
    const res = await request(app).get(`/api/races/${race.id}/state`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('race');
    expect(res.body).toHaveProperty('state');
    expect(res.body).toHaveProperty('last_fuel');
  });
});

// ── Race Events (Calendar) ────────────────────────────────────────────────────

describe('Race Calendar Events', () => {
  let eventId;

  beforeAll(async () => {
    await truncateAll();
    user = await seedUser({ username: 'racedriver6', email: 'race6@smcorse.test' });
    token = await getToken(app, user.username, user.plainPassword);
  });

  it('GET /api/races/events returns empty array initially', async () => {
    const res = await request(app).get('/api/races/events').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/races/events returns 400 when name or race_date missing', async () => {
    const res = await request(app).post('/api/races/events').set(auth()).send({ name: 'No Date' });
    expect(res.status).toBe(400);
  });

  it('POST /api/races/events creates a calendar event', async () => {
    const res = await request(app).post('/api/races/events').set(auth()).send({
      name: 'Daytona 24h 2026',
      race_date: '2026-01-25',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    eventId = res.body.id;
  });

  it('DELETE /api/races/events/:id removes the event', async () => {
    const res = await request(app).delete(`/api/races/events/${eventId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── GET /api/races/:id/events ─────────────────────────────────────────────────

describe('GET /api/races/:id/events', () => {
  let race;

  beforeAll(async () => {
    await truncateAll();
    user = await seedUser({ username: 'racedriver7', email: 'race7@smcorse.test' });
    token = await getToken(app, user.username, user.plainPassword);
    race = await seedRace(user.id);
  });

  it('returns empty array when no events logged', async () => {
    const res = await request(app).get(`/api/races/${race.id}/events`).set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});
