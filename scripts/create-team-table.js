const { query, pool } = require('../src/config/database');

async function create() {
  await query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      name VARCHAR(255) NOT NULL,
      role VARCHAR(100) DEFAULT 'Driver',
      iracing_id VARCHAR(50),
      irating INTEGER DEFAULT 0,
      safety_rating DECIMAL(4,2) DEFAULT 0,
      preferred_car VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('team_members table created');
  await pool.end();
}
create();
