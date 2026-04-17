const express = require('express');
const router = express.Router();
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { notifyDriverChange, notifyLowFuel } = require('../services/notifications');
const { advanceStintPlan } = require('./races');

const LOW_FUEL_MINS = 20;
const FUEL_UPDATE_DEBOUNCE_MS = 8000;
const CLIENT_ACTIVE_WINDOW_MS = 20000; // 20s without an event = client considered inactive

// Returns { driverUserId, active } for the current driver's client, or null if unknown.
async function getDriverClientInfo(raceId) {
  const stateR = await query(
    'SELECT current_driver_name FROM race_state WHERE race_id = $1',
    [raceId]
  );
  const driverName = stateR.rows[0]?.current_driver_name;
  if (!driverName) return null;

  const userR = await query(
    `SELECT id FROM users WHERE LOWER(iracing_name) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1`,
    [driverName]
  );
  if (!userR.rows[0]) return null;

  const driverUserId = userR.rows[0].id;

  const recentR = await query(
    `SELECT created_at FROM iracing_events
     WHERE race_id = $1 AND reported_by_user_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [raceId, driverUserId]
  );

  if (!recentR.rows[0]) return { driverUserId, active: false };
  const age = Date.now() - new Date(recentR.rows[0].created_at).getTime();
  return { driverUserId, active: age < CLIENT_ACTIVE_WINDOW_MS };
}

// Returns true if this event should be processed — i.e. sender is the driver's client,
// or the driver's client is not currently active (fallback).
async function shouldAcceptEvent(raceId, reportingUserId) {
  const info = await getDriverClientInfo(raceId);
  if (!info) return true;                             // no known driver → accept anyone
  if (Number(info.driverUserId) === Number(reportingUserId)) return true; // sender IS the driver
  if (!info.active) return true;                      // driver client inactive → fallback
  return false;                                       // driver client active → ignore others
}

// POST /api/iracing/event
// Desktop clients POST here every poll cycle
router.post('/event', authenticateToken, async (req, res) => {
  const { event, data } = req.body;
  if (!event || !data) return res.status(400).json({ error: 'event and data required' });

  try {
    // Get active race
    const raceResult = await query(
      'SELECT * FROM races WHERE is_active = TRUE LIMIT 1'
    );
    if (raceResult.rowCount === 0) {
      return res.status(200).json({ ok: true, skipped: 'no_active_race' });
    }
    const race = raceResult.rows[0];

    if (event === 'driver_change') {
      // Driver changes accepted from any client — existing name dedup prevents duplicates
      await handleDriverChange(race, data, req.user.id);
    } else if (event === 'fuel_update') {
      if (await shouldAcceptEvent(race.id, req.user.id)) {
        await handleFuelUpdate(race, data, req.user.id);
      } else {
        return res.json({ ok: true, skipped: 'non_driver_client' });
      }
    } else if (event === 'position_update') {
      if (await shouldAcceptEvent(race.id, req.user.id)) {
        await handlePositionUpdate(race, data);
      } else {
        return res.json({ ok: true, skipped: 'non_driver_client' });
      }
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
  const stateResult = await query(
    'SELECT current_driver_name FROM race_state WHERE race_id = $1',
    [race.id]
  );
  const state = stateResult.rows[0];
  if (state && state.current_driver_name === driver_name) return;

  // Advance the stint plan (updates current_stint_index, stint_started_at, current_driver_name)
  const stintPlanInfo = await advanceStintPlan(race, driver_name, race.id);

  // Update current driver name + reset low_fuel_notified on driver change
  await query(
    `UPDATE race_state SET current_driver_name = $2, low_fuel_notified = FALSE, last_event_at = NOW() WHERE race_id = $1`,
    [race.id, driver_name]
  );

  // Look up the driver in our DB
  const driverResult = await query(
    `SELECT * FROM users
     WHERE LOWER(iracing_name) = LOWER($1) OR iracing_id = $2
     LIMIT 1`,
    [driver_name, driver_id || '']
  );
  const driverUser = driverResult.rows[0] || null;

  // Log the event
  await query(
    `INSERT INTO iracing_events
       (event_type, race_id, driver_name, driver_user_id, session_time, reported_by_user_id)
     VALUES ('driver_change', $1, $2, $3, $4, $5)`,
    [race.id, driver_name, driverUser?.id || null, session_time, reportingUserId]
  );

  // Mark previous stint as ended
  await query(
    `UPDATE stint_roster
     SET actual_end_session_time = $1
     WHERE race_id = $2
       AND actual_start_session_time IS NOT NULL
       AND actual_end_session_time IS NULL`,
    [session_time, race.id]
  );

  // Start new stint (subquery for LIMIT — PostgreSQL doesn't support LIMIT in UPDATE)
  if (driverUser) {
    await query(
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
  const nextDriverResult = await query(
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
  if (stintPlanInfo?.isSameDriver) {
    const { notifyBoxedAndOut } = require('../services/notifications');
    await notifyBoxedAndOut(driver_name, stintPlanInfo);
  } else {
    await notifyDriverChange(driver_name, driverUser, nextDriver, stintPlanInfo);
  }
}

async function handleFuelUpdate(race, data, reportingUserId) {
  const { fuel_level, fuel_pct, mins_remaining, session_time } = data;
  if (fuel_level === undefined) return;

  // Debounce: only write to DB if last fuel event was >8s ago
  const lastResult = await query(
    `SELECT created_at FROM iracing_events
     WHERE race_id = $1 AND event_type = 'fuel_update'
     ORDER BY created_at DESC LIMIT 1`,
    [race.id]
  );
  if (lastResult.rowCount > 0) {
    const diff = Date.now() - new Date(lastResult.rows[0].created_at).getTime();
    if (diff < FUEL_UPDATE_DEBOUNCE_MS) return;
  }

  // Log fuel event
  await query(
    `INSERT INTO iracing_events
       (event_type, race_id, fuel_level, fuel_pct, mins_remaining, session_time, reported_by_user_id)
     VALUES ('fuel_update', $1, $2, $3, $4, $5, $6)`,
    [race.id, fuel_level, fuel_pct, mins_remaining, session_time, reportingUserId]
  );

  // Update race state with latest fuel
  await query(
    'UPDATE race_state SET last_fuel_level = $1, last_event_at = NOW() WHERE race_id = $2',
    [fuel_level, race.id]
  );

  // Low fuel alert
  if (mins_remaining && mins_remaining <= LOW_FUEL_MINS) {
    const stateResult = await query(
      'SELECT low_fuel_notified FROM race_state WHERE race_id = $1',
      [race.id]
    );
    const alreadyNotified = stateResult.rows[0]?.low_fuel_notified;
    if (!alreadyNotified) {
      await query(
        'UPDATE race_state SET low_fuel_notified = TRUE WHERE race_id = $1',
        [race.id]
      );

      // Get next driver
      const nextDriverResult = await query(
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

async function handlePositionUpdate(race, data) {
  const {
    position, class_position, gap_to_leader, gap_ahead, gap_behind,
    laps_completed, last_lap_time, best_lap_time, nearby_cars, session_time,
  } = data;
  if (!position) return;

  // Read previous state to detect lap completion
  const prevR = await query(
    'SELECT last_lap_time, current_driver_name FROM race_state WHERE race_id = $1',
    [race.id]
  );
  const prev = prevR.rows[0] || {};

  await query(
    `UPDATE race_state SET
       position        = $1,
       class_position  = $2,
       gap_to_leader   = $3,
       gap_ahead       = $4,
       gap_behind      = $5,
       laps_completed  = $6,
       last_lap_time   = $7,
       best_lap_time   = $8,
       nearby_cars     = $9::jsonb,
       last_event_at   = NOW()
     WHERE race_id = $10`,
    [
      position, class_position ?? null, gap_to_leader ?? null,
      gap_ahead ?? null, gap_behind ?? null, laps_completed ?? null,
      last_lap_time ?? null, best_lap_time ?? null,
      JSON.stringify(nearby_cars ?? []), race.id,
    ]
  );

  // Detect new lap: last_lap_time changed to a valid positive value
  const prevLap = prev.last_lap_time ? parseFloat(prev.last_lap_time) : null;
  if (last_lap_time && last_lap_time > 0 && last_lap_time !== prevLap) {
    const driverName = prev.current_driver_name || null;
    let driverUserId = null;
    if (driverName) {
      const uR = await query(
        `SELECT id FROM users WHERE LOWER(iracing_name) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1`,
        [driverName]
      );
      driverUserId = uR.rows[0]?.id ?? null;
    }
    await query(
      `INSERT INTO race_laps (race_id, lap_number, driver_name, driver_user_id, lap_time, session_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [race.id, laps_completed ?? null, driverName, driverUserId, last_lap_time, session_time ?? null]
    );
    console.log(`[Laps] Race ${race.id}: Lap ${laps_completed} — ${driverName} — ${last_lap_time.toFixed(3)}s`);
  }
}

// GET /api/iracing/status — current race status (for desktop app dashboard)
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const raceResult = await query(
      'SELECT * FROM races WHERE is_active = TRUE LIMIT 1'
    );
    if (raceResult.rowCount === 0) {
      return res.json({ active_race: null });
    }
    const race = raceResult.rows[0];

    const stateResult = await query(
      'SELECT * FROM race_state WHERE race_id = $1',
      [race.id]
    );
    const state = stateResult.rows[0] || {};

    const lastFuelResult = await query(
      `SELECT fuel_level, fuel_pct, mins_remaining, created_at
       FROM iracing_events
       WHERE race_id = $1 AND event_type = 'fuel_update'
       ORDER BY created_at DESC LIMIT 1`,
      [race.id]
    );

    res.json({
      active_race:    race,
      current_driver: state.current_driver_name || null,
      last_fuel:      lastFuelResult.rows[0] || null,
      state: {
        position:       state.position       ?? null,
        class_position: state.class_position ?? null,
        gap_ahead:      state.gap_ahead      ?? null,
        gap_behind:     state.gap_behind     ?? null,
        laps_completed: state.laps_completed ?? null,
        last_lap_time:  state.last_lap_time  ?? null,
        best_lap_time:  state.best_lap_time  ?? null,
        nearby_cars:    state.nearby_cars    ?? [],
      },
    });
  } catch (err) {
    console.error('[iRacing status]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/iracing/telemetry — receive gzip-compressed telemetry batch from desktop client
router.post('/telemetry', authenticateToken, async (req, res) => {
  try {
    let body;
    if (req.headers['content-encoding'] === 'gzip') {
      const decompressed = await gunzip(req.body);
      body = JSON.parse(decompressed.toString('utf-8'));
    } else {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }

    const { lap, samples } = body;
    if (!samples || !Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ error: 'No samples provided' });
    }

    const raceResult = await query('SELECT id FROM races WHERE is_active = TRUE LIMIT 1');
    if (raceResult.rowCount === 0) {
      return res.json({ ok: true, skipped: 'no_active_race' });
    }
    const raceId = raceResult.rows[0].id;

    // Only store from driver's client (or fallback)
    if (!(await shouldAcceptEvent(raceId, req.user.id))) {
      return res.json({ ok: true, skipped: 'non_driver_client' });
    }

    await query(
      `INSERT INTO live_telemetry (race_id, user_id, lap, samples, sample_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [raceId, req.user.id, lap ?? null, JSON.stringify(samples), samples.length]
    );

    res.json({ ok: true, stored: samples.length });
  } catch (err) {
    console.error('[POST /telemetry]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/iracing/telemetry/live — last ~10s of samples, cursor-based via ?since=
router.get('/telemetry/live', authenticateToken, async (req, res) => {
  try {
    const raceResult = await query('SELECT id FROM races WHERE is_active = TRUE LIMIT 1');
    if (raceResult.rowCount === 0) {
      return res.json({ active: false, samples: [] });
    }
    const raceId = raceResult.rows[0].id;
    const since  = req.query.since ? parseFloat(req.query.since) : null;

    const result = await query(
      `SELECT samples FROM live_telemetry
       WHERE race_id = $1
       ORDER BY received_at DESC
       LIMIT 5`,
      [raceId]
    );

    let samples = result.rows
      .flatMap(row => row.samples)
      .sort((a, b) => a.t - b.t);

    if (since !== null) {
      samples = samples.filter(s => s.t > since);
    } else {
      samples = samples.slice(-100);
    }

    res.json({ active: true, race_id: raceId, samples });
  } catch (err) {
    console.error('[GET /telemetry/live]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/iracing/telemetry/lap/:raceId/:lap — all samples for a specific lap
router.get('/telemetry/lap/:raceId/:lap', authenticateToken, async (req, res) => {
  try {
    const raceId = parseInt(req.params.raceId);
    const lap    = parseInt(req.params.lap);

    const result = await query(
      `SELECT samples FROM live_telemetry
       WHERE race_id = $1 AND lap = $2
       ORDER BY received_at ASC`,
      [raceId, lap]
    );

    const allSamples = result.rows
      .flatMap(row => row.samples)
      .sort((a, b) => a.t - b.t);

    res.json({ race_id: raceId, lap, sample_count: allSamples.length, samples: allSamples });
  } catch (err) {
    console.error('[GET /telemetry/lap]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
