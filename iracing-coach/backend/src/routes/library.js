const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

// Get reference laps (public)
router.get('/reference-laps', optionalAuth, async (req, res) => {
  try {
    const { track_id, car_id, reference_type } = req.query;

    let sql = `
      SELECT id, track_name, car_name, lap_time, sector1_time, sector2_time, sector3_time,
      driver_name, driver_rating, reference_type, created_at
      FROM reference_laps
      WHERE is_public = true
    `;
    const params = [];
    let paramIndex = 1;

    if (track_id) {
      sql += ` AND track_id = $${paramIndex++}`;
      params.push(track_id);
    }

    if (car_id) {
      sql += ` AND car_id = $${paramIndex++}`;
      params.push(car_id);
    }

    if (reference_type) {
      sql += ` AND reference_type = $${paramIndex++}`;
      params.push(reference_type);
    }

    sql += ` ORDER BY lap_time ASC LIMIT 50`;

    const result = await query(sql, params);

    res.json({ reference_laps: result.rows });
  } catch (error) {
    console.error('Get reference laps error:', error);
    res.status(500).json({ error: 'Failed to fetch reference laps' });
  }
});

// Get specific reference lap
router.get('/reference-laps/:id', optionalAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM reference_laps WHERE id = $1 AND is_public = true`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reference lap not found' });
    }

    res.json({ reference_lap: result.rows[0] });
  } catch (error) {
    console.error('Get reference lap error:', error);
    res.status(500).json({ error: 'Failed to fetch reference lap' });
  }
});

// Get track/car combinations available
router.get('/combinations', async (req, res) => {
  try {
    const result = await query(`
      SELECT DISTINCT track_id, track_name, car_id, car_name, 
      COUNT(*) as reference_count,
      MIN(lap_time) as best_time
      FROM reference_laps
      WHERE is_public = true
      GROUP BY track_id, track_name, car_id, car_name
      ORDER BY track_name, car_name
    `);

    res.json({ combinations: result.rows });
  } catch (error) {
    console.error('Get combinations error:', error);
    res.status(500).json({ error: 'Failed to fetch combinations' });
  }
});

// Search tracks
router.get('/tracks/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query too short' });
    }

    const result = await query(
      `SELECT DISTINCT track_id, track_name
       FROM reference_laps
       WHERE LOWER(track_name) LIKE LOWER($1)
       ORDER BY track_name
       LIMIT 20`,
      [`%${q}%`]
    );

    res.json({ tracks: result.rows });
  } catch (error) {
    console.error('Track search error:', error);
    res.status(500).json({ error: 'Failed to search tracks' });
  }
});

// Leaderboard for track/car
router.get('/leaderboard', async (req, res) => {
  try {
    const { track_id, car_id } = req.query;

    if (!track_id || !car_id) {
      return res.status(400).json({ error: 'track_id and car_id required' });
    }

    const result = await query(
      `SELECT driver_name, lap_time, sector1_time, sector2_time, sector3_time,
       reference_type, created_at
       FROM reference_laps
       WHERE track_id = $1 AND car_id = $2 AND is_public = true
       ORDER BY lap_time ASC
       LIMIT 25`,
      [track_id, car_id]
    );

    res.json({ leaderboard: result.rows });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
