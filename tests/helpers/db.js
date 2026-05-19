'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'iracing_coach_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

async function truncateAll() {
  await pool.query(`
    TRUNCATE users, races, race_state, teams, team_members,
             stint_planner_sessions, race_events
    RESTART IDENTITY CASCADE
  `);
}

async function seedUser(overrides = {}) {
  const data = {
    email: 'test@smcorse.test',
    password: 'Password123!',
    username: 'testdriver',
    discord_user_id: '000000000000000001',
    is_admin: false,
    ...overrides,
  };
  const hash = await bcrypt.hash(data.password, 10);
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, username, discord_user_id, is_admin)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, email, is_admin`,
    [data.email, hash, data.username, data.discord_user_id, data.is_admin]
  );
  return { ...res.rows[0], plainPassword: data.password };
}

async function seedRace(createdBy, overrides = {}) {
  const data = { name: 'Test Race', track: 'Spa', ...overrides };
  const res = await pool.query(
    `INSERT INTO races (name, track) VALUES ($1, $2) RETURNING *`,
    [data.name, data.track]
  );
  return res.rows[0];
}

async function seedTeam(createdBy, overrides = {}) {
  const data = { name: 'Test Team', ...overrides };
  const res = await pool.query(
    `INSERT INTO teams (name, description, discord_channel_id, discord_role_id, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.name, data.description || null, data.discord_channel_id || null, data.discord_role_id || null, createdBy]
  );
  return res.rows[0];
}

async function closePool() {
  await pool.end();
}

module.exports = { pool, truncateAll, seedUser, seedRace, seedTeam, closePool };
