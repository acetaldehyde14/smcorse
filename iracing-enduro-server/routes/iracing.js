const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { verifyToken } = require('../middleware/auth');
const { notifyDriverChange, notifyLowFuel } = require('../services/notifications');

const LOW_FUEL_MINS = 20;          // alert threshold
const FUEL_UPDATE_DEBOUNCE_MS = 8000; // only log fuel every 8s regardless of client count

// POST /api/iracing/event
// Desktop clients POST here every poll cycle
router.post('/event', verifyToken, async (req, res) => {
  const { event, data } = req.body;
  if (!event || !data) return res.status(400).json({ error: 'event and data required' });

  try {
    // Get active race
    const raceResult = await pool.query(
      'SELECT * FROM races WHERE is_active = TRUE LIMIT 1'
    );
    if (raceResult.rowCount === 0) {
      return res.status(200).json({ ok: true, skipped: 'no_active_race' });
    }
    const race = raceResult.rows[0];

    if (event === 'driver_change') {
      await handleDriverChange(race, data, req.user.id);
    } else if (event === 'fuel_update') {
      await handleFuelUpdate(race, data, req.user.id);
    } else {
      return res.status(400).json({ error: `Unknown event type: ${event}` });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[iRacing event]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

async function handleDriverChange(race, data, reportingUserId) {
  const { driver_name, driver_id, session_time } = data;
  if (!driver_name) return;

  // Dedup: only process if driver actually changed
  const stateResult = await pool.query(
    'SELECT current_driver_name FROM race_state WHERE race_id = $1',
    [race.id]
  );
  const state = stateResult.rows[0];
  if (state && state.current_driver_name === driver_name) return; // no change

  // Update race state
  await pool.query(
    `INSERT INTO race_state (race_id, current_driver_name, low_fuel_notified)
     VALUES ($1, $2, FALSE)
     ON CONFLICT (race_id) DO UPDATE
       SET current_driver_name = $2, low_fuel_notified = FALSE, last_event_at = NOW()`,
    [race.id, driver_name]
  );

  // Look up the driver in our DB
  const driverResult = await pool.query(
    `SELECT * FROM users
     WHERE LOWER(iracing_name) = LOWER($1) OR iracing_id = $2
     LIMIT 1`,
    [driver_name, driver_id || '']
  );
  const driverUser = driverResult.rows[0] || null;

  // Log the event
  await pool.query(
    `INSERT INTO iracing_events
       (event_type, race_id, driver_name, driver_user_id, session_time, reported_by_user_id)
     VALUES ('driver_change', $1, $2, $3, $4, $5)`,
    [race.id, driver_name, driverUser?.id || null, session_time, reportingUserId]
  );

  // Mark previous stint as ended, start new one
  await pool.query(
    `UPDATE stint_roster
     SET actual_end_session_time = $1
     WHERE race_id = $2
       AND actual_start_session_time IS NOT NULL
       AND actual_end_session_time IS NULL`,
    [session_time, race.id]
  );

  if (driverUser) {
    await pool.query(
      `UPDATE stint_roster
       SET actual_start_session_time = $1
       WHERE race_id = $2 AND driver_user_id = $3
         AND actual_start_session_time IS NULL
       ORDER BY stint_order ASC
       LIMIT 1`,  // Postgres doesn't support LIMIT in UPDATE directly — use subquery
      [session_time, race.id, driverUser.id]
    );
    // Use subquery approach for proper LIMIT on UPDATE
    await pool.query(
      `UPDATE stint_roster SET actual_start_session_time = $1
       WHERE id = (
         SELECT id FROM stint_roster
         WHERE race_id = $2 AND driver_user_id = $3
           AND actual_start_session_time IS NULL
         ORDER BY stint_order ASC LIMIT 1
       )`,
      [session_time, race.id, driverUser.id]
    );
  }

  // Get next driver in roster
  const nextDriverResult = await pool.query(
    `SELECT sr.*, u.username, u.telegram_chat_id, u.discord_user_id, u.discord_webhook
     FROM stint_roster sr
     JOIN users u ON u.id = sr.driver_user_id
     WHERE sr.race_id = $1
       AND sr.actual_start_session_time IS NULL
     ORDER BY sr.stint_order ASC
     LIMIT 1`,
    [race.id]
  );
  const nextDriver = nextDriverResult.rows[0] || null;

  console.log(`[Driver Change] Race ${race.id}: ${driver_name} is now in the car`);
  await notifyDriverChange(driver_name, driverUser, nextDriver);
}

async function handleFuelUpdate(race, data, reportingUserId) {
  const { fuel_level, fuel_pct, mins_remaining, session_time } = data;
  if (fuel_level === undefined) return;

  // Debounce: only write to DB if last fuel event was >8s ago
  const lastResult = await pool.query(
    `SELECT created_at FROM iracing_events
     WHERE race_id = $1 AND event_type = 'fuel_update'
     ORDER BY created_at DESC LIMIT 1`,
    [race.id]
  );
  if (lastResult.rowCount > 0) {
    const diff = Date.now() - new Date(lastResult.rows[0].created_at).getTime();
    if (diff < FUEL_UPDATE_DEBOUNCE_MS) return; // skip, already logged recently
  }

  // Log fuel event
  await pool.query(
    `INSERT INTO iracing_events
       (event_type, race_id, fuel_level, fuel_pct, mins_remaining, session_time, reported_by_user_id)
     VALUES ('fuel_update', $1, $2, $3, $4, $5, $6)`,
    [race.id, fuel_level, fuel_pct, mins_remaining, session_time, reportingUserId]
  );

  // Update race state with latest fuel
  await pool.query(
    `UPDATE race_state SET last_fuel_level = $1, last_event_at = NOW() WHERE race_id = $2`,
    [fuel_level, race.id]
  );

  // Low fuel alert
  if (mins_remaining && mins_remaining <= LOW_FUEL_MINS) {
    const stateResult = await pool.query(
      'SELECT low_fuel_notified FROM race_state WHERE race_id = $1',
      [race.id]
    );
    const alreadyNotified = stateResult.rows[0]?.low_fuel_notified;
    if (!alreadyNotified) {
      await pool.query(
        'UPDATE race_state SET low_fuel_notified = TRUE WHERE race_id = $1',
        [race.id]
      );

      // Get next driver
      const nextDriverResult = await pool.query(
        `SELECT sr.*, u.username, u.telegram_chat_id, u.discord_user_id, u.discord_webhook
         FROM stint_roster sr
         JOIN users u ON u.id = sr.driver_user_id
         WHERE sr.race_id = $1
           AND sr.actual_start_session_time IS NULL
         ORDER BY sr.stint_order ASC LIMIT 1`,
        [race.id]
      );
      const nextDriver = nextDriverResult.rows[0] || null;

      console.log(`[Low Fuel] Race ${race.id}: ~${Math.round(mins_remaining)} mins remaining`);
      await notifyLowFuel(mins_remaining, fuel_level, nextDriver);
    }
  }
}

// GET /api/iracing/status — current race status (for desktop app dashboard)
router.get('/status', verifyToken, async (req, res) => {
  try {
    const raceResult = await pool.query(
      'SELECT * FROM races WHERE is_active = TRUE LIMIT 1'
    );
    if (raceResult.rowCount === 0) {
      return res.json({ active_race: null });
    }
    const race = raceResult.rows[0];

    const stateResult = await pool.query(
      'SELECT * FROM race_state WHERE race_id = $1',
      [race.id]
    );
    const state = stateResult.rows[0] || {};

    const lastFuelResult = await pool.query(
      `SELECT fuel_level, fuel_pct, mins_remaining, created_at
       FROM iracing_events
       WHERE race_id = $1 AND event_type = 'fuel_update'
       ORDER BY created_at DESC LIMIT 1`,
      [race.id]
    );

    res.json({
      active_race: race,
      current_driver: state.current_driver_name || null,
      last_fuel: lastFuelResult.rows[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
