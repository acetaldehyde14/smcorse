const { query, pool } = require('../src/config/database');

async function check() {
  const result = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
  console.log('Tables:', result.rows.map(r => r.table_name));
  await pool.end();
}
check();
