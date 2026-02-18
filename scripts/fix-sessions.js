const { query, pool } = require('../src/config/database');

async function fixSessions() {
  // Find sessions with Unknown Track that have blap files
  const sessions = await query(
    `SELECT s.id, s.track_name, s.car_name, l.blap_file_path
     FROM sessions s
     LEFT JOIN laps l ON s.id = l.session_id
     WHERE s.track_name = 'Unknown Track'`
  );

  console.log(`Found ${sessions.rows.length} sessions with Unknown Track`);

  const parser = require('../src/services/parser');

  for (const row of sessions.rows) {
    const filePath = row.blap_file_path;
    if (!filePath) {
      console.log(`Session ${row.id}: no file path, skipping`);
      continue;
    }

    try {
      const parsed = await parser.parseFile(filePath);
      const track = parsed.metadata.track;
      const car = parsed.metadata.car;
      const lapTime = parsed.metadata.lapTime;

      console.log(`Session ${row.id}: ${track} / ${car} / ${lapTime}s`);

      // Update session
      await query(
        `UPDATE sessions SET track_name = $1, track_id = $2, car_name = $3, car_id = $4 WHERE id = $5`,
        [track, track.toLowerCase().replace(/[^a-z0-9]/g, '_'), car, car.toLowerCase().replace(/[^a-z0-9]/g, '_'), row.id]
      );

      // Update lap time if we got one
      if (lapTime > 0) {
        await query(
          `UPDATE laps SET lap_time = $1 WHERE session_id = $2 AND (lap_time = 0 OR lap_time IS NULL)`,
          [lapTime, row.id]
        );
      }

      console.log(`  -> Updated!`);
    } catch (e) {
      console.error(`  -> Error: ${e.message}`);
    }
  }

  await pool.end();
  console.log('Done');
}

fixSessions();
