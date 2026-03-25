const express = require('express');
const router = express.Router();
const { pool, query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/races — list all races
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM races ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('[Races] list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/races/active — get the currently active race
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM races WHERE is_active = TRUE LIMIT 1');
    if (result.rowCount === 0) return res.status(404).json({ error: 'No active race' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Races] active error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races — create a new race
router.post('/', authenticateToken, async (req, res) => {
  const { name, track } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await query(
      'INSERT INTO races (name, track) VALUES ($1, $2) RETURNING *',
      [name, track || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Races] create error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/start — mark race as active
router.post('/:id/start', authenticateToken, async (req, res) => {
  try {
    // Deactivate all other races first
    await query('UPDATE races SET is_active = FALSE');
    const result = await query(
      `UPDATE races SET is_active = TRUE, started_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Race not found' });

    // Init race state
    await query(
      `INSERT INTO race_state (race_id) VALUES ($1)
       ON CONFLICT (race_id) DO UPDATE SET low_fuel_notified = FALSE, current_driver_name = NULL`,
      [req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Races] start error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/end — end the race
router.post('/:id/end', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `UPDATE races SET is_active = FALSE, ended_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Races] end error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Roster ─────────────────────────────────────────────────────

// GET /api/races/:id/roster — get full stint roster with driver info
router.get('/:id/roster', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT sr.*, u.username, u.iracing_name,
              (u.telegram_chat_id IS NOT NULL) AS has_telegram,
              (u.discord_user_id IS NOT NULL)  AS has_discord
       FROM stint_roster sr
       JOIN users u ON u.id = sr.driver_user_id
       WHERE sr.race_id = $1
       ORDER BY sr.stint_order`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Races] roster get error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/roster — add or replace full roster
router.post('/:id/roster', authenticateToken, async (req, res) => {
  const { roster } = req.body;
  if (!Array.isArray(roster) || roster.length === 0) {
    return res.status(400).json({ error: 'roster array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM stint_roster WHERE race_id = $1', [req.params.id]);
    for (const entry of roster) {
      await client.query(
        `INSERT INTO stint_roster (race_id, driver_user_id, stint_order, planned_duration_mins)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, entry.driver_user_id, entry.stint_order, entry.planned_duration_mins || null]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: roster.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Races] roster save error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/races/:id/state — live state snapshot for one race
router.get('/:id/state', authenticateToken, async (req, res) => {
  try {
    const [raceR, stateR, fuelR] = await Promise.all([
      query('SELECT * FROM races WHERE id = $1', [req.params.id]),
      query('SELECT * FROM race_state WHERE race_id = $1', [req.params.id]),
      query(
        `SELECT fuel_level, fuel_pct, mins_remaining, created_at
         FROM iracing_events
         WHERE race_id = $1 AND event_type = 'fuel_update'
         ORDER BY created_at DESC LIMIT 1`,
        [req.params.id]
      )
    ]);
    if (raceR.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    res.json({
      race:      raceR.rows[0],
      state:     stateR.rows[0] || null,
      last_fuel: fuelR.rows[0]  || null
    });
  } catch (err) {
    console.error('[Races] state error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/event — manually log a driver change or fuel update
router.post('/:id/event', authenticateToken, async (req, res) => {
  const { event_type, driver_name, fuel_level, fuel_pct, mins_remaining } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  try {
    const raceR = await query('SELECT * FROM races WHERE id = $1', [req.params.id]);
    if (raceR.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    const race = raceR.rows[0];

    if (event_type === 'driver_change') {
      if (!driver_name || !driver_name.trim()) {
        return res.status(400).json({ error: 'driver_name required' });
      }
      const name = driver_name.trim();

      // Update race state
      await query(
        `INSERT INTO race_state (race_id, current_driver_name, low_fuel_notified)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (race_id) DO UPDATE
           SET current_driver_name = $2, low_fuel_notified = FALSE, last_event_at = NOW()`,
        [race.id, name]
      );

      // Log event
      await query(
        `INSERT INTO iracing_events (event_type, race_id, driver_name, reported_by_user_id)
         VALUES ('driver_change', $1, $2, $3)`,
        [race.id, name, req.user.id]
      );

      res.json({ ok: true });

    } else if (event_type === 'fuel_update') {
      if (fuel_level === undefined || fuel_level === null) {
        return res.status(400).json({ error: 'fuel_level required' });
      }

      await query(
        `INSERT INTO iracing_events
           (event_type, race_id, fuel_level, fuel_pct, mins_remaining, reported_by_user_id)
         VALUES ('fuel_update', $1, $2, $3, $4, $5)`,
        [race.id, fuel_level, fuel_pct || null, mins_remaining || null, req.user.id]
      );

      await query(
        'UPDATE race_state SET last_fuel_level = $1, last_event_at = NOW() WHERE race_id = $2',
        [fuel_level, race.id]
      );

      res.json({ ok: true });

    } else {
      res.status(400).json({ error: 'event_type must be driver_change or fuel_update' });
    }
  } catch (err) {
    console.error('[Races] manual event error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/races/:id/events — recent telemetry events for a race
router.get('/:id/events', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const result = await query(
      `SELECT ie.*, u.username AS reporter_username
       FROM iracing_events ie
       LEFT JOIN users u ON u.id = ie.reported_by_user_id
       WHERE ie.race_id = $1
       ORDER BY ie.created_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Races] events error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
