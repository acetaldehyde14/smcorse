const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

// GET /api/races — list all races
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM races ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/races/active — get the currently active race
router.get('/active', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM races WHERE is_active = TRUE LIMIT 1'
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'No active race' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races — create a new race
router.post('/', verifyToken, async (req, res) => {
  const { name, track } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      `INSERT INTO races (name, track) VALUES ($1, $2) RETURNING *`,
      [name, track || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/start — mark race as active
router.post('/:id/start', verifyToken, async (req, res) => {
  try {
    // Deactivate all other races first
    await pool.query('UPDATE races SET is_active = FALSE');
    const result = await pool.query(
      `UPDATE races SET is_active = TRUE, started_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Race not found' });

    // Init race state
    await pool.query(
      `INSERT INTO race_state (race_id) VALUES ($1)
       ON CONFLICT (race_id) DO UPDATE SET low_fuel_notified = FALSE, current_driver_name = NULL`,
      [req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/end — end the race
router.post('/:id/end', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE races SET is_active = FALSE, ended_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Roster ─────────────────────────────────────────────────────

// GET /api/races/:id/roster — get full stint roster
router.get('/:id/roster', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
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
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/roster — add or replace full roster
router.post('/:id/roster', verifyToken, async (req, res) => {
  // body: { roster: [{ driver_user_id, stint_order, planned_duration_mins }] }
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
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/races/:id/events — recent telemetry events for a race
router.get('/:id/events', verifyToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const result = await pool.query(
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
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
