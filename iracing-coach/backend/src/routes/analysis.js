const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const coachingService = require('../services/coaching');
const comparisonEngine = require('../services/comparison');
const { query } = require('../config/database');

const router = express.Router();

// Compare two laps and generate coaching
router.post('/compare', authenticateToken, async (req, res) => {
  try {
    const { driver_lap_id, reference_lap_id } = req.body;

    if (!driver_lap_id || !reference_lap_id) {
      return res.status(400).json({ 
        error: 'Both driver_lap_id and reference_lap_id are required' 
      });
    }

    // Generate coaching
    const result = await coachingService.generateCoaching(
      driver_lap_id,
      reference_lap_id,
      req.user.id
    );

    res.json(result);
  } catch (error) {
    console.error('Comparison error:', error);
    res.status(500).json({ error: `Analysis failed: ${error.message}` });
  }
});

// Get coaching history
router.get('/coaching', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT cs.id, cs.created_at, cs.time_delta, cs.coaching_summary,
       l.lap_time as driver_lap_time, rl.lap_time as reference_lap_time,
       s.track_name, s.car_name
       FROM coaching_sessions cs
       JOIN laps l ON cs.lap_id = l.id
       JOIN reference_laps rl ON cs.reference_lap_id = rl.id
       JOIN sessions s ON l.session_id = s.id
       WHERE cs.user_id = $1
       ORDER BY cs.created_at DESC
       LIMIT 20`,
      [req.user.id]
    );

    res.json({ coaching_sessions: result.rows });
  } catch (error) {
    console.error('Get coaching error:', error);
    res.status(500).json({ error: 'Failed to fetch coaching history' });
  }
});

// Get specific coaching session
router.get('/coaching/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT cs.*, 
       l.lap_time as driver_lap_time, l.sector1_time as driver_s1, 
       l.sector2_time as driver_s2, l.sector3_time as driver_s3,
       rl.lap_time as reference_lap_time, rl.sector1_time as ref_s1,
       rl.sector2_time as ref_s2, rl.sector3_time as ref_s3,
       s.track_name, s.car_name, rl.driver_name as coach_name
       FROM coaching_sessions cs
       JOIN laps l ON cs.lap_id = l.id
       JOIN reference_laps rl ON cs.reference_lap_id = rl.id
       JOIN sessions s ON l.session_id = s.id
       WHERE cs.id = $1 AND cs.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Coaching session not found' });
    }

    res.json({ coaching: result.rows[0] });
  } catch (error) {
    console.error('Get coaching session error:', error);
    res.status(500).json({ error: 'Failed to fetch coaching session' });
  }
});

// Track learning coaching
router.post('/track-learning', authenticateToken, async (req, res) => {
  try {
    const { session_id } = req.body;

    if (!session_id) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    const result = await coachingService.generateTrackLearning(
      session_id,
      req.user.id
    );

    res.json(result);
  } catch (error) {
    console.error('Track learning error:', error);
    res.status(500).json({ error: `Track learning failed: ${error.message}` });
  }
});

// Chat with AI coach
router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const result = await coachingService.chat(req.user.id, message, context || {});

    res.json(result);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: `Chat failed: ${error.message}` });
  }
});

// Rate coaching session
router.post('/coaching/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be between 1 and 5' });
    }

    await query(
      `UPDATE coaching_sessions 
       SET user_rating = $1, user_feedback = $2
       WHERE id = $3 AND user_id = $4`,
      [rating, feedback || null, req.params.id, req.user.id]
    );

    res.json({ message: 'Rating saved' });
  } catch (error) {
    console.error('Rate coaching error:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

module.exports = router;
