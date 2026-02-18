const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const parser = require('../services/parser');
const { query } = require('../config/database');

const router = express.Router();

// Upload telemetry file
router.post('/upload',
  authenticateToken,
  upload.single('telemetry'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileExt = req.file.originalname.split('.').pop().toLowerCase();

      // Parse the telemetry file to extract track, car, and lap info
      let trackName = 'Unknown Track';
      let carName = 'Unknown Car';
      let sessionType = 'practice';
      let bestLapTime = 0;
      let lapTimes = [];
      let telemetrySummary = { status: 'uploaded', file_type: fileExt };

      try {
        console.log('Parsing telemetry file:', req.file.path);
        const parsed = await parser.parseFile(req.file.path);

        if (parsed && parsed.metadata) {
          trackName = parsed.metadata.track || trackName;
          carName = parsed.metadata.car || carName;
          sessionType = (parsed.metadata.sessionType || 'practice').toLowerCase();
          bestLapTime = parsed.metadata.lapTime || 0;
          lapTimes = parsed.metadata.lapTimes || [];
          telemetrySummary = {
            status: 'parsed',
            file_type: fileExt,
            track: trackName,
            trackShort: parsed.metadata.trackShort,
            trackConfig: parsed.metadata.trackConfig,
            car: carName,
            best_lap_time: bestLapTime,
            lap_count: lapTimes.length,
            duration: parsed.metadata.duration,
            telemetry_samples: (parsed.telemetry || []).length
          };
        }
        console.log('Parsed telemetry:', { trackName, carName, bestLapTime, laps: lapTimes.length });
      } catch (parseError) {
        console.error('Parse error (continuing with upload):', parseError.message);
        telemetrySummary = {
          status: 'parse_failed',
          file_type: fileExt,
          error: parseError.message
        };
      }

      // Create session with extracted info
      const sessionResult = await query(
        `INSERT INTO sessions (user_id, track_id, track_name, car_id, car_name, session_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id`,
        [
          req.user.id,
          trackName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          trackName,
          carName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          carName,
          req.body.session_type || sessionType
        ]
      );
      const sessionId = sessionResult.rows[0].id;

      const fileColumn = fileExt === 'ibt' ? 'ibt_file_path' :
                         fileExt === 'blap' ? 'blap_file_path' : 'olap_file_path';

      // Save each extracted lap as a separate record
      if (lapTimes.length > 0) {
        for (let i = 0; i < lapTimes.length; i++) {
          await query(
            `INSERT INTO laps
             (session_id, user_id, lap_number, lap_time, ${fileColumn}, telemetry_summary, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
              sessionId,
              req.user.id,
              lapTimes[i].lap,
              lapTimes[i].time,
              req.file.path,
              JSON.stringify(telemetrySummary)
            ]
          );
        }
      } else {
        // No laps extracted, save a single record with file reference
        await query(
          `INSERT INTO laps
           (session_id, user_id, lap_time, ${fileColumn}, telemetry_summary, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            sessionId,
            req.user.id,
            bestLapTime,
            req.file.path,
            JSON.stringify(telemetrySummary)
          ]
        );
      }

      res.json({
        message: 'File uploaded and parsed successfully.',
        session: {
          id: sessionId,
          track: trackName,
          car: carName,
          session_type: sessionType,
          best_lap: bestLapTime,
          lap_count: lapTimes.length,
          status: 'parsed'
        }
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

// Get lap telemetry (high-resolution per-lap data for visualization)
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

    const ext = require('path').extname(filePath).toLowerCase();

    // For IBT files: extract high-res per-lap telemetry
    if (ext === '.ibt' && lap.lap_number) {
      try {
        const lapTelemetry = await parser.parseLapTelemetry(filePath, lap.lap_number);
        return res.json({
          lap: {
            id: lap.id,
            lap_number: lap.lap_number,
            lap_time: lap.lap_time,
            track: lap.track_name,
            car: lap.car_name
          },
          telemetry: lapTelemetry
        });
      } catch (parseErr) {
        console.error('Per-lap parse error, falling back:', parseErr.message);
      }
    }

    // Fallback: return full session telemetry (downsampled)
    const parsed = await parser.parseFile(filePath);
    const downsampled = parser.exportToJSON(parsed, parseInt(req.query.downsample) || 10);

    res.json({
      lap: {
        id: lap.id,
        lap_number: lap.lap_number,
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

// Get all user laps (for coaching/library selection)
router.get('/all-laps', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT l.id, l.lap_number, l.lap_time, l.session_id,
       s.track_name, s.car_name, s.created_at,
       l.ibt_file_path, l.blap_file_path, l.olap_file_path
       FROM laps l
       JOIN sessions s ON l.session_id = s.id
       WHERE l.user_id = $1 AND l.lap_time > 0
       ORDER BY l.lap_time ASC`,
      [req.user.id]
    );
    res.json({ laps: result.rows });
  } catch (error) {
    console.error('Get all laps error:', error);
    res.status(500).json({ error: 'Failed to fetch laps' });
  }
});

module.exports = router;
