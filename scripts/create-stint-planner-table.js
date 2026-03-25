const { query, pool } = require('../src/config/database');

async function create() {
  await query(`
    CREATE TABLE IF NOT EXISTS stint_planner_sessions (
      id           SERIAL PRIMARY KEY,
      name         VARCHAR(255)  NOT NULL DEFAULT 'Untitled Race',
      created_by   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
      config       JSONB         NOT NULL DEFAULT '{}',
      availability JSONB         NOT NULL DEFAULT '{}',
      plan         JSONB         NOT NULL DEFAULT '[]',
      created_at   TIMESTAMP     NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `);
  console.log('stint_planner_sessions table created');
  await pool.end();
}
create();
