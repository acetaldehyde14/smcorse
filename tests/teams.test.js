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

let token;
let user;

beforeAll(async () => {
  await truncateAll();
  user = await seedUser({ username: 'teamdriver', email: 'teams@smcorse.test' });
  token = await getToken(app, user.username, user.plainPassword);
});

afterAll(async () => {
  await closePool();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

// ── GET /api/teams ────────────────────────────────────────────────────────────

describe('GET /api/teams', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/teams');
    expect(res.status).toBe(401);
  });

  it('returns an array of teams with member_count', async () => {
    await seedTeam(user.id);
    const res = await request(app).get('/api/teams').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('member_count');
  });
});

// ── POST /api/teams ───────────────────────────────────────────────────────────

describe('POST /api/teams', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/teams').set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('creates a team and returns 201 with member_count: 0', async () => {
    const res = await request(app).post('/api/teams').set(auth()).send({ name: 'GT3 Factory' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('GT3 Factory');
    expect(res.body.member_count).toBe(0);
  });

  it('creates team with discord_channel_id and discord_role_id', async () => {
    const res = await request(app).post('/api/teams').set(auth()).send({
      name: 'Discord Team',
      discord_channel_id: '123456789012345678',
      discord_role_id: '987654321098765432',
    });
    expect(res.status).toBe(201);
    expect(res.body.discord_channel_id).toBe('123456789012345678');
    expect(res.body.discord_role_id).toBe('987654321098765432');
  });
});

// ── PUT /api/teams/:id ────────────────────────────────────────────────────────

describe('PUT /api/teams/:id', () => {
  let team;

  beforeAll(async () => {
    const res = await request(app).post('/api/teams').set(auth()).send({ name: 'Old Name' });
    team = res.body;
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).put(`/api/teams/${team.id}`).set(auth()).send({ description: 'test' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent team', async () => {
    const res = await request(app).put('/api/teams/99999').set(auth()).send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  it('updates the team name', async () => {
    const res = await request(app).put(`/api/teams/${team.id}`).set(auth()).send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });
});

// ── DELETE /api/teams/:id ─────────────────────────────────────────────────────

describe('DELETE /api/teams/:id', () => {
  it('deletes a team and returns { ok: true }', async () => {
    const createRes = await request(app).post('/api/teams').set(auth()).send({ name: 'Deletable Team' });
    const res = await request(app).delete(`/api/teams/${createRes.body.id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── /api/teams/:id/members ────────────────────────────────────────────────────

describe('Team members', () => {
  let team;
  let memberId;

  beforeAll(async () => {
    const res = await request(app).post('/api/teams').set(auth()).send({ name: 'Members Team' });
    team = res.body;
  });

  it('GET /:id/members returns empty array for new team', async () => {
    const res = await request(app).get(`/api/teams/${team.id}/members`).set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('POST /:id/members returns 400 when name is missing', async () => {
    const res = await request(app).post(`/api/teams/${team.id}/members`).set(auth()).send({ role: 'Driver' });
    expect(res.status).toBe(400);
  });

  it('POST /:id/members adds member and returns 201', async () => {
    const res = await request(app).post(`/api/teams/${team.id}/members`).set(auth()).send({
      name: 'Max Verstappen',
      role: 'Driver',
      iracing_name: 'Max V',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.team_id).toBe(team.id);
    memberId = res.body.id;
  });

  it('PUT /:id/members/:mid returns 404 for non-existent member', async () => {
    const res = await request(app).put(`/api/teams/${team.id}/members/99999`).set(auth()).send({
      name: 'Ghost',
      role: 'Driver',
    });
    expect(res.status).toBe(404);
  });

  it('PUT /:id/members/:mid updates member', async () => {
    const res = await request(app).put(`/api/teams/${team.id}/members/${memberId}`).set(auth()).send({
      name: 'Updated Driver',
      role: 'Engineer',
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Driver');
  });

  it('DELETE /:id/members/:mid removes member', async () => {
    const res = await request(app).delete(`/api/teams/${team.id}/members/${memberId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /api/teams/:id/test-discord ─────────────────────────────────────────

describe('POST /api/teams/:id/test-discord', () => {
  it('returns 400 when no discord channel is configured', async () => {
    const createRes = await request(app).post('/api/teams').set(auth()).send({ name: 'No Discord' });
    const res = await request(app)
      .post(`/api/teams/${createRes.body.id}/test-discord`)
      .set(auth())
      .send({});
    expect(res.status).toBe(400);
  });
});
