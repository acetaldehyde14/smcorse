const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const parser = require('../services/parser');
const { query } = require('../config/database');

const router = express.Router();

// Upload telemetry file
router.post('/upload',
  authenticateToken,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { track_name, car_name, session_type } = req.body;

      // Parse the file
      const parsed = await parser.parseFile(req.file.path);

      // Create or get session
      let sessionId;
      if (req.body.session_id) {
        sessionId = req.body.session_id;
      } else {
        const sessionResult = await query(
          `INSERT INTO sessions (user_id, track_id, track_name, car_id, car_name, session_type, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING id`,
          [
            req.user.id,
            parsed.metadata.track || track_name,
            track_name || parsed.metadata.track || 'Unknown',
            parsed.metadata.car || car_name,
            car_name || parsed.metadata.car || 'Unknown',
            session_type || 'practice'
          ]
        );
        sessionId = sessionResult.rows[0].id;
      }

      // Save lap
      const fileColumn = parsed.type === 'ibt' ? 'ibt_file_path' : 
                         parsed.type === 'blap' ? 'blap_file_path' : 'olap_file_path';

      const lapResult = await query(
        `INSERT INTO laps 
         (session_id, user_id, lap_time, sector1_time, sector2_time, sector3_time,
          ${fileColumn}, telemetry_summary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING id`,
        [
          sessionId,
          req.user.id,
          parsed.lapInfo.lapTime,
          parsed.lapInfo.sectorTimes[0],
          parsed.lapInfo.sectorTimes[1],
          parsed.lapInfo.sectorTimes[2],
          req.file.path,
          JSON.stringify(parser.getTelemetrySummary(parsed))
        ]
      );

      res.json({
        message: 'File uploaded and parsed successfully',
        lap: {
          id: lapResult.rows[0].id,
          session_id: sessionId,
          lap_time: parsed.lapInfo.lapTime,
          sector_times: parsed.lapInfo.sectorTimes,
          type: parsed.type
        },
        parsed: parser.exportToJSON(parsed, 10) // Downsample for response
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: `Upload failed: ${error.message}` });
    }
  }
);

// Get user's sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT s.id, s.track_name, s.car_name, s.session_type, s.created_at,
       COUNT(l.id) as lap_count, MIN(l.lap_time) as best_lap
       FROM sessions s
       LEFT JOIN laps l ON s.id = l.session_id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get session details
router.get('/sessions/:id', authenticateToken, async (req, res) => {
  try {
    const sessionResult = await query(
      `SELECT * FROM sessions WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const lapsResult = await query(
      `SELECT id, lap_number, lap_time, sector1_time, sector2_time, sector3_time, 
       is_valid, created_at
       FROM laps
       WHERE session_id = $1
       ORDER BY lap_time ASC`,
      [req.params.id]
    );

    res.json({
      session: sessionResult.rows[0],
      laps: lapsResult.rows
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Get lap telemetry
router.get('/laps/:id/telemetry', authenticateToken, async (req, res) => {
  try {
    const lapResult = await query(
      `SELECT l.*, s.track_name, s.car_name
       FROM laps l
       JOIN sessions s ON l.session_id = s.id
       WHERE l.id = $1 AND l.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (lapResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lap not found' });
    }

    const lap = lapResult.rows[0];
    const filePath = lap.ibt_file_path || lap.blap_file_path || lap.olap_file_path;

    if (!filePath) {
      return res.status(404).json({ error: 'No telemetry file found' });
    }

    // Parse and return telemetry
    const parsed = await parser.parseFile(filePath);
    const downsampled = parser.exportToJSON(parsed, parseInt(req.query.downsample) || 10);

    res.json({
      lap: {
        id: lap.id,
        lap_time: lap.lap_time,
        track: lap.track_name,
        car: lap.car_name
      },
      telemetry: downsampled
    });
  } catch (error) {
    console.error('Get telemetry error:', error);
    res.status(500).json({ error: 'Failed to fetch telemetry' });
  }
});

module.exports = router;
