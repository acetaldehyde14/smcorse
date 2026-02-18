const { query, pool } = require('../src/config/database');

async function cleanup() {
  try {
    // Delete laps for unknown sessions
    const r1 = await query(
      `DELETE FROM laps WHERE session_id IN
       (SELECT id FROM sessions WHERE track_name = $1 OR track_name = $2 OR track_name = $3)`,
      ['Unknown Track', '\x01', 'unknown']
    );
    console.log('Deleted laps:', r1.rowCount);

    // Delete unknown sessions
    const r2 = await query(
      `DELETE FROM sessions WHERE track_name = $1 OR track_name = $2 OR track_name = $3`,
      ['Unknown Track', '\x01', 'unknown']
    );
    console.log('Deleted sessions:', r2.rowCount);

    // Show remaining sessions
    const remaining = await query('SELECT id, track_name, car_name, session_type, created_at FROM sessions ORDER BY created_at DESC');
    console.log('\nRemaining sessions:', remaining.rows.length);
    remaining.rows.forEach(s => {
      console.log(`  Session ${s.id}: ${s.track_name} - ${s.car_name} (${s.session_type}) ${s.created_at}`);
    });

    pool.end();
  } catch (err) {
    console.error('Cleanup error:', err);
    pool.end();
  }
}

cleanup();
