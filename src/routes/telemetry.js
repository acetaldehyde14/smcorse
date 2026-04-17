const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const parser = require('../services/parser');
const { query, transaction } = require('../config/database');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Compute aggregate lap features from an array of telemetry frame rows.
 * Frames must have: speed_kph, throttle, brake, steering_deg (all nullable).
 */
function computeLapFeatures(frames) {
  if (!frames.length) return {};

  const defined = (arr) => arr.filter(v => v != null && !Number.isNaN(Number(v))).map(Number);
  const avg = (arr) => { const d = defined(arr); return d.length ? d.reduce((a, b) => a + b, 0) / d.length : null; };
  const maxVal = (arr) => { const d = defined(arr); return d.length ? Math.max(...d) : null; };
  const minVal = (arr) => { const d = defined(arr); return d.length ? Math.min(...d) : null; };

  const speeds    = frames.map(f => f.speed_kph);
  const throttles = frames.map(f => f.throttle);
  const brakes    = frames.map(f => f.brake);
  const steerings = frames.map(f => f.steering_deg);

  // throttle_full_pct: fraction of frames where throttle >= 0.98
  const tDef = defined(throttles);
  const throttleFullPct = tDef.length
    ? (tDef.filter(t => t >= 0.98).length / tDef.length * 100)
    : null;

  // brake_zone_count: count transitions into braking (brake > 0.05)
  let brakeZoneCount = 0;
  let inBrake = false;
  for (const b of defined(brakes)) {
    if (b > 0.05 && !inBrake) { brakeZoneCount++; inBrake = true; }
    else if (b <= 0.05) inBrake = false;
  }

  // steering_variance
  const sDef = defined(steerings);
  const steeringMean = avg(sDef);
  const steeringVariance = steeringMean != null
    ? avg(sDef.map(s => (s - steeringMean) ** 2))
    : null;

  // lift_count: throttle drops below 0.1 while not braking
  let liftCount = 0;
  let prevT = tDef[0] ?? 0;
  for (let i = 1; i < frames.length; i++) {
    const t = frames[i].throttle;
    const b = frames[i].brake ?? 0;
    if (t != null && prevT >= 0.5 && t < 0.1 && b < 0.05) liftCount++;
    if (t != null) prevT = Number(t);
  }

  // smoothness_score: based on frame-to-frame delta of throttle + brake
  let deltaSum = 0, deltaCount = 0;
  for (let i = 1; i < frames.length; i++) {
    const dt = (Number(frames[i].throttle) || 0) - (Number(frames[i - 1].throttle) || 0);
    const db = (Number(frames[i].brake) || 0) - (Number(frames[i - 1].brake) || 0);
    deltaSum += dt * dt + db * db;
    deltaCount++;
  }
  const smoothnessScore = deltaCount > 0
    ? Math.max(0, Math.min(100, 100 - Math.sqrt(deltaSum / deltaCount) * 500))
    : null;

  return {
    avg_speed_kph:     avg(speeds),
    max_speed_kph:     maxVal(speeds),
    min_speed_kph:     minVal(speeds),
    throttle_full_pct: throttleFullPct,
    brake_peak:        maxVal(brakes),
    brake_zone_count:  brakeZoneCount,
    steering_variance: steeringVariance,
    lift_count:        liftCount,
    wheelspin_events:  0,
    lockup_events:     0,
    smoothness_score:  smoothnessScore,
    consistency_score: null,
    entry_speed_avg:   null,
    apex_speed_avg:    null,
    exit_speed_avg:    null
  };
}

/**
 * Bulk-insert frames into telemetry_frames in chunks of 500.
 * queryFn is either the module-level query() or a client.query.bind(client).
 */
async function bulkInsertFrames(queryFn, frames, sessionId, userId, lapId, source) {
  const CHUNK = 500;
  const cols = [
    'session_id', 'lap_id', 'user_id', 'ts', 'session_time', 'lap_number', 'lap_dist_pct',
    'speed_kph', 'throttle', 'brake', 'clutch', 'steering_deg', 'gear', 'rpm',
    'lat_accel', 'long_accel', 'yaw_rate', 'steer_torque', 'track_temp_c', 'air_temp_c', 'source'
  ];

  for (let i = 0; i < frames.length; i += CHUNK) {
    const chunk = frames.slice(i, i + CHUNK);
    const placeholders = [];
    const params = [];
    let p = 1;

    for (const f of chunk) {
      placeholders.push(`(${cols.map(() => `$${p++}`).join(',')})`);
      params.push(
        sessionId,
        lapId ?? f.lap_id ?? null,
        userId,
        f.ts,
        f.session_time,
        f.lap_number ?? null,
        f.lap_dist_pct ?? null,
        f.speed_kph ?? null,
        f.throttle ?? null,
        f.brake ?? null,
        f.clutch ?? null,
        f.steering_deg ?? null,
        f.gear ?? null,
        f.rpm ?? null,
        f.lat_accel ?? null,
        f.long_accel ?? null,
        f.yaw_rate ?? null,
        f.steer_torque ?? null,
        f.track_temp_c ?? null,
        f.air_temp_c ?? null,
        source
      );
    }

    await queryFn(
      `INSERT INTO telemetry_frames (${cols.join(',')}) VALUES ${placeholders.join(',')}`,
      params
    );
  }
}

/**
 * Insert a single row into lap_features.
 */
async function insertLapFeatures(queryFn, lapId, sessionId, userId, lapTime, sectorTimes, features) {
  await queryFn(
    `INSERT INTO lap_features
       (lap_id, session_id, user_id, lap_time,
        sector1_time, sector2_time, sector3_time,
        avg_speed_kph, max_speed_kph, min_speed_kph,
        throttle_full_pct, brake_peak, brake_zone_count, steering_variance,
        entry_speed_avg, apex_speed_avg, exit_speed_avg,
        lift_count, wheelspin_events, lockup_events,
        consistency_score, smoothness_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (lap_id) DO UPDATE SET
       avg_speed_kph     = EXCLUDED.avg_speed_kph,
       max_speed_kph     = EXCLUDED.max_speed_kph,
       min_speed_kph     = EXCLUDED.min_speed_kph,
       throttle_full_pct = EXCLUDED.throttle_full_pct,
       brake_peak        = EXCLUDED.brake_peak,
       brake_zone_count  = EXCLUDED.brake_zone_count,
       steering_variance = EXCLUDED.steering_variance,
       lift_count        = EXCLUDED.lift_count,
       smoothness_score  = EXCLUDED.smoothness_score`,
    [
      lapId, sessionId, userId, lapTime,
      sectorTimes?.[0] ?? null, sectorTimes?.[1] ?? null, sectorTimes?.[2] ?? null,
      features.avg_speed_kph, features.max_speed_kph, features.min_speed_kph,
      features.throttle_full_pct, features.brake_peak, features.brake_zone_count,
      features.steering_variance,
      features.entry_speed_avg, features.apex_speed_avg, features.exit_speed_avg,
      features.lift_count, features.wheelspin_events, features.lockup_events,
      features.consistency_score, features.smoothness_score
    ]
  );
}

/**
 * Async IBT backfill: parse frames at 15 Hz and populate telemetry_frames + lap_features.
 * Runs after the upload response has already been sent.
 */
async function backfillIBTFrames(sessionId, lapIdMap, userId, filePath, sessionCreatedAt) {
  console.log(`[backfill] Starting IBT frame backfill for session ${sessionId}`);
  const { frames } = await parser.parseFrames(filePath, 15);
  if (!frames.length) {
    console.log('[backfill] No frames extracted, skipping');
    return;
  }

  // Attach timestamps relative to session creation
  const baseTs = new Date(sessionCreatedAt).getTime();
  for (const f of frames) {
    f.ts = new Date(baseTs + f.session_time * 1000).toISOString();
    f.lap_id = lapIdMap.get(f.lap_number) ?? null;
  }

  await bulkInsertFrames(query, frames, sessionId, userId, null, 'ibt');

  // Compute and insert lap_features for each lap that has frames
  const lapGroups = new Map();
  for (const f of frames) {
    if (f.lap_id == null) continue;
    if (!lapGroups.has(f.lap_id)) lapGroups.set(f.lap_id, []);
    lapGroups.get(f.lap_id).push(f);
  }

  for (const [lapId, lapFrames] of lapGroups) {
    // Find lap_time from the laps table
    const lapRow = await query('SELECT lap_time FROM laps WHERE id = $1', [lapId]);
    const lapTime = lapRow.rows[0]?.lap_time ?? null;
    const features = computeLapFeatures(lapFrames);
    await insertLapFeatures(query, lapId, sessionId, userId, lapTime, null, features);
  }

  console.log(`[backfill] Done: ${frames.length} frames, ${lapGroups.size} laps featured for session ${sessionId}`);
}

// ── Upload telemetry file ─────────────────────────────────────────

router.post('/upload',
  authenticateToken,
  upload.single('telemetry'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileExt = req.file.originalname.split('.').pop().toLowerCase();

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

      const sessionResult = await query(
        `INSERT INTO sessions (user_id, track_id, track_name, car_id, car_name, session_type, ingest_mode, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'file', NOW())
         RETURNING id, created_at`,
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
      const sessionCreatedAt = sessionResult.rows[0].created_at;

      const fileColumn = fileExt === 'ibt'  ? 'ibt_file_path' :
                         fileExt === 'blap' ? 'blap_file_path' : 'olap_file_path';

      // Map lap_number → lap DB id for backfill
      const lapIdMap = new Map();

      if (lapTimes.length > 0) {
        for (let i = 0; i < lapTimes.length; i++) {
          const r = await query(
            `INSERT INTO laps
             (session_id, user_id, lap_number, lap_time, ${fileColumn}, telemetry_summary, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
            [sessionId, req.user.id, lapTimes[i].lap, lapTimes[i].time, req.file.path, JSON.stringify(telemetrySummary)]
          );
          lapIdMap.set(lapTimes[i].lap, r.rows[0].id);
        }
      } else {
        await query(
          `INSERT INTO laps
           (session_id, user_id, lap_time, ${fileColumn}, telemetry_summary, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [sessionId, req.user.id, bestLapTime, req.file.path, JSON.stringify(telemetrySummary)]
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

      // Async IBT backfill — runs after response is sent
      if (fileExt === 'ibt' && lapIdMap.size > 0) {
        backfillIBTFrames(sessionId, lapIdMap, req.user.id, req.file.path, sessionCreatedAt)
          .catch(e => console.error('[backfill] Error:', e.message));
      }
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: `Upload failed: ${error.message}` });
    }
  }
);

// ── Live session routes ───────────────────────────────────────────

// POST /api/telemetry/live/session/start
router.post('/live/session/start', authenticateToken, async (req, res) => {
  try {
    const {
      sim_session_uid, sub_session_id,
      track_id, track_name, car_id, car_name, session_type,
      driver_name, iracing_driver_id, started_at
    } = req.body;

    if (!track_name || !car_name) {
      return res.status(400).json({ error: 'track_name and car_name are required' });
    }

    const result = await query(
      `INSERT INTO sessions
         (user_id, track_id, track_name, car_id, car_name, session_type,
          sim_session_uid, sub_session_id, iracing_driver_id, ingest_mode, status,
          created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'live','open',$10)
       RETURNING id`,
      [
        req.user.id,
        track_id || track_name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        track_name,
        car_id || car_name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        car_name,
        session_type || 'practice',
        sim_session_uid || null,
        sub_session_id || null,
        iracing_driver_id || null,
        started_at ? new Date(started_at) : new Date()
      ]
    );

    res.json({ session_id: result.rows[0].id, ingest_mode: 'live' });
  } catch (error) {
    console.error('live/session/start error:', error);
    res.status(500).json({ error: 'Failed to start live session' });
  }
});

// POST /api/telemetry/live/frame  (single frame)
router.post('/live/frame', authenticateToken, async (req, res) => {
  try {
    const { session_id, lap_number, ts, session_time, ...rest } = req.body;
    if (!session_id || session_time == null) {
      return res.status(400).json({ error: 'session_id and session_time are required' });
    }

    // Verify ownership
    const sess = await query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });

    await query(
      `INSERT INTO telemetry_frames
         (session_id, user_id, ts, session_time, lap_number, lap_dist_pct,
          speed_kph, throttle, brake, clutch, steering_deg, gear, rpm,
          lat_accel, long_accel, yaw_rate, steer_torque, track_temp_c, air_temp_c, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'live')`,
      [
        session_id, req.user.id,
        ts ? new Date(ts) : new Date(),
        session_time, lap_number ?? null, rest.lap_dist_pct ?? null,
        rest.speed_kph ?? null, rest.throttle ?? null, rest.brake ?? null, rest.clutch ?? null,
        rest.steering_deg ?? null, rest.gear ?? null, rest.rpm ?? null,
        rest.lat_accel ?? null, rest.long_accel ?? null, rest.yaw_rate ?? null,
        rest.steer_torque ?? null, rest.track_temp_c ?? null, rest.air_temp_c ?? null
      ]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('live/frame error:', error);
    res.status(500).json({ error: 'Failed to insert frame' });
  }
});

// POST /api/telemetry/live/batch  (multiple frames for one lap)
router.post('/live/batch', authenticateToken, async (req, res) => {
  try {
    const { session_id, lap_number, sample_rate_hz, frames } = req.body;
    if (!session_id || !Array.isArray(frames) || !frames.length) {
      return res.status(400).json({ error: 'session_id and frames[] are required' });
    }

    const sess = await query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });

    // Normalize frames: attach lap_number and parse ts
    const normalised = frames.map(f => ({
      ...f,
      ts:         f.ts ? new Date(f.ts) : new Date(),
      lap_number: f.lap_number ?? lap_number ?? null
    }));

    await bulkInsertFrames(query, normalised, session_id, req.user.id, null, 'live');

    res.json({ ok: true, inserted: normalised.length });
  } catch (error) {
    console.error('live/batch error:', error);
    res.status(500).json({ error: 'Failed to insert batch' });
  }
});

// POST /api/telemetry/live/lap-complete
// Finalizes a lap: creates a laps row, links frames, computes lap_features.
router.post('/live/lap-complete', authenticateToken, async (req, res) => {
  try {
    const { session_id, lap_number, lap_time, sector1_time, sector2_time, sector3_time, is_valid = true } = req.body;
    if (!session_id || lap_number == null || lap_time == null) {
      return res.status(400).json({ error: 'session_id, lap_number, and lap_time are required' });
    }

    const sess = await query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });

    const lapId = await transaction(async (client) => {
      // Insert the lap record
      const lapResult = await client.query(
        `INSERT INTO laps
           (session_id, user_id, lap_number, lap_time, sector1_time, sector2_time, sector3_time, is_valid, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         RETURNING id`,
        [session_id, req.user.id, lap_number, lap_time, sector1_time ?? null, sector2_time ?? null, sector3_time ?? null, is_valid]
      );
      const newLapId = lapResult.rows[0].id;

      // Link unassigned frames for this lap
      await client.query(
        `UPDATE telemetry_frames
         SET lap_id = $1
         WHERE session_id = $2 AND lap_number = $3 AND lap_id IS NULL`,
        [newLapId, session_id, lap_number]
      );

      // Fetch frames for feature computation
      const framesResult = await client.query(
        `SELECT speed_kph, throttle, brake, steering_deg
         FROM telemetry_frames
         WHERE lap_id = $1
         ORDER BY session_time`,
        [newLapId]
      );

      const features = computeLapFeatures(framesResult.rows);
      await insertLapFeatures(
        client.query.bind(client),
        newLapId, session_id, req.user.id, lap_time,
        [sector1_time, sector2_time, sector3_time],
        features
      );

      return newLapId;
    });

    res.json({ ok: true, lap_id: lapId });
  } catch (error) {
    console.error('live/lap-complete error:', error);
    res.status(500).json({ error: 'Failed to finalize lap' });
  }
});

// POST /api/telemetry/live/session/end
router.post('/live/session/end', authenticateToken, async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const result = await query(
      `UPDATE sessions SET status = 'closed', ended_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [session_id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Session not found' });

    res.json({ ok: true, session_id });

    // Async: compute features for any laps that don't have them yet
    (async () => {
      try {
        const unfeaturized = await query(
          `SELECT l.id, l.lap_time, l.session_id
           FROM laps l
           LEFT JOIN lap_features lf ON lf.lap_id = l.id
           WHERE l.session_id = $1 AND lf.lap_id IS NULL`,
          [session_id]
        );
        for (const lap of unfeaturized.rows) {
          const framesResult = await query(
            `SELECT speed_kph, throttle, brake, steering_deg
             FROM telemetry_frames WHERE lap_id = $1 ORDER BY session_time`,
            [lap.id]
          );
          if (!framesResult.rows.length) continue;
          const features = computeLapFeatures(framesResult.rows);
          await insertLapFeatures(query, lap.id, session_id, req.user.id, lap.lap_time, null, features);
        }
        console.log(`[session/end] Feature extraction done for session ${session_id}`);
      } catch (e) {
        console.error('[session/end] Feature extraction error:', e.message);
      }
    })();
  } catch (error) {
    console.error('live/session/end error:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// GET /api/telemetry/live/session/:id/status
router.get('/live/session/:id/status', authenticateToken, async (req, res) => {
  try {
    const sessResult = await query(
      `SELECT id, track_name, car_name, session_type, ingest_mode, status, created_at, ended_at
       FROM sessions WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!sessResult.rows.length) return res.status(404).json({ error: 'Session not found' });

    const [frameCount, lapCount] = await Promise.all([
      query('SELECT COUNT(*) FROM telemetry_frames WHERE session_id = $1', [req.params.id]),
      query('SELECT COUNT(*) FROM laps WHERE session_id = $1', [req.params.id])
    ]);

    res.json({
      session: sessResult.rows[0],
      frame_count: parseInt(frameCount.rows[0].count),
      lap_count:   parseInt(lapCount.rows[0].count)
    });
  } catch (error) {
    console.error('live/session/:id/status error:', error);
    res.status(500).json({ error: 'Failed to fetch session status' });
  }
});

// GET /api/telemetry/live/session/:id/frames
// Returns frames after since_session_time, up to limit rows (max 1000).
router.get('/live/session/:id/frames', authenticateToken, async (req, res) => {
  try {
    const sinceTime = parseFloat(req.query.since_session_time) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);

    const sess = await query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });

    const result = await query(
      `SELECT session_time, lap_number, lap_dist_pct,
              speed_kph, throttle, brake, steering_deg, gear, rpm,
              lat_accel, long_accel, yaw_rate
       FROM telemetry_frames
       WHERE session_id = $1 AND user_id = $2 AND session_time > $3
       ORDER BY session_time ASC
       LIMIT $4`,
      [req.params.id, req.user.id, sinceTime, limit]
    );

    const frames = result.rows;
    res.json({
      session_id:          parseInt(req.params.id),
      latest_session_time: frames.length ? parseFloat(frames[frames.length - 1].session_time) : sinceTime,
      frames
    });
  } catch (error) {
    console.error('live/session/:id/frames error:', error);
    res.status(500).json({ error: 'Failed to fetch frames' });
  }
});

// GET /api/telemetry/live/session/:id/summary
// Extends /status with current lap values and lap table — used by the live graph page.
router.get('/live/session/:id/summary', authenticateToken, async (req, res) => {
  try {
    const sessResult = await query(
      `SELECT id, track_name, car_name, session_type, ingest_mode, status, created_at, ended_at
       FROM sessions WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!sessResult.rows.length) return res.status(404).json({ error: 'Session not found' });

    const [latestFrame, lapsResult, frameCount] = await Promise.all([
      query(
        `SELECT session_time, lap_number, speed_kph, throttle, brake, gear, rpm, ts
         FROM telemetry_frames WHERE session_id = $1 AND user_id = $2
         ORDER BY session_time DESC LIMIT 1`,
        [req.params.id, req.user.id]
      ),
      query(
        `SELECT lap_number, lap_time FROM laps WHERE session_id = $1
         ORDER BY lap_time ASC`,
        [req.params.id]
      ),
      query('SELECT COUNT(*) FROM telemetry_frames WHERE session_id = $1', [req.params.id])
    ]);

    const lf = latestFrame.rows[0] ?? null;
    const best = lapsResult.rows[0] ?? null;

    res.json({
      session:             sessResult.rows[0],
      status:              sessResult.rows[0].status,
      frame_count:         parseInt(frameCount.rows[0].count),
      latest_session_time: lf ? parseFloat(lf.session_time) : null,
      last_frame_ts:       lf?.ts ?? null,
      current_lap:         lf?.lap_number ?? null,
      best_lap_number:     best?.lap_number ?? null,
      best_lap_time:       best?.lap_time ?? null,
      lap_count:           lapsResult.rows.length,
      laps:                lapsResult.rows,
      latest: lf ? {
        speed_kph: lf.speed_kph != null ? parseFloat(lf.speed_kph) : null,
        throttle:  lf.throttle  != null ? parseFloat(lf.throttle)  : null,
        brake:     lf.brake     != null ? parseFloat(lf.brake)     : null,
        gear:      lf.gear,
        rpm:       lf.rpm != null ? parseInt(lf.rpm) : null
      } : null
    });
  } catch (error) {
    console.error('live/session/:id/summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ── Existing session / lap routes ─────────────────────────────────

// Get user's sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT s.id, s.track_name, s.car_name, s.session_type, s.ingest_mode, s.status, s.created_at,
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

    res.json({ session: sessionResult.rows[0], laps: lapsResult.rows });
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

    // If frames are stored in telemetry_frames, use those first
    const frameCheck = await query(
      'SELECT COUNT(*) FROM telemetry_frames WHERE lap_id = $1',
      [lap.id]
    );
    if (parseInt(frameCheck.rows[0].count) > 0) {
      const frames = await query(
        `SELECT session_time, lap_dist_pct, speed_kph, throttle, brake,
                steering_deg, gear, rpm, lat_accel, long_accel, yaw_rate
         FROM telemetry_frames WHERE lap_id = $1 ORDER BY session_time`,
        [lap.id]
      );
      return res.json({
        lap: { id: lap.id, lap_number: lap.lap_number, lap_time: lap.lap_time, track: lap.track_name, car: lap.car_name },
        source: 'telemetry_frames',
        telemetry: frames.rows
      });
    }

    const filePath = lap.ibt_file_path || lap.blap_file_path || lap.olap_file_path;
    if (!filePath) {
      return res.status(404).json({ error: 'No telemetry file found' });
    }

    const ext = require('path').extname(filePath).toLowerCase();

    if (ext === '.ibt' && lap.lap_number) {
      try {
        const lapTelemetry = await parser.parseLapTelemetry(filePath, lap.lap_number);
        return res.json({
          lap: { id: lap.id, lap_number: lap.lap_number, lap_time: lap.lap_time, track: lap.track_name, car: lap.car_name },
          source: 'ibt_file',
          telemetry: lapTelemetry
        });
      } catch (parseErr) {
        console.error('Per-lap parse error, falling back:', parseErr.message);
      }
    }

    const parsed = await parser.parseFile(filePath);
    const downsampled = parser.exportToJSON(parsed, parseInt(req.query.downsample) || 10);
    res.json({
      lap: { id: lap.id, lap_number: lap.lap_number, lap_time: lap.lap_time, track: lap.track_name, car: lap.car_name },
      source: 'ibt_file_downsampled',
      telemetry: downsampled
    });
  } catch (error) {
    console.error('Get telemetry error:', error);
    res.status(500).json({ error: 'Failed to fetch telemetry' });
  }
});

// GET /api/telemetry/laps/:id/channels
// Returns available telemetry channels and their value ranges for a lap.
router.get('/laps/:id/channels', authenticateToken, async (req, res) => {
  try {
    const lapResult = await query(
      `SELECT l.id, l.lap_number, l.lap_time, l.user_id, l.session_id, s.track_name, s.car_name
       FROM laps l JOIN sessions s ON l.session_id = s.id
       WHERE l.id = $1 AND l.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!lapResult.rows.length) return res.status(404).json({ error: 'Lap not found' });
    const lap = lapResult.rows[0];

    const stats = await query(
      `SELECT
         COUNT(*) as frame_count,
         MIN(session_time) as t_start, MAX(session_time) as t_end,
         COUNT(speed_kph)    as speed_count,   MIN(speed_kph)    as speed_min,   MAX(speed_kph)    as speed_max,
         COUNT(throttle)     as throttle_count, MIN(throttle)     as throttle_min, MAX(throttle)    as throttle_max,
         COUNT(brake)        as brake_count,    MIN(brake)        as brake_min,   MAX(brake)        as brake_max,
         COUNT(steering_deg) as steer_count,    MIN(steering_deg) as steer_min,  MAX(steering_deg)  as steer_max,
         COUNT(gear)         as gear_count,
         COUNT(rpm)          as rpm_count,      MIN(rpm)          as rpm_min,    MAX(rpm)           as rpm_max,
         COUNT(lat_accel)    as lat_accel_count,
         COUNT(long_accel)   as long_accel_count,
         COUNT(yaw_rate)     as yaw_rate_count,
         COUNT(lap_dist_pct) as dist_count,
         MIN(source)         as source
       FROM telemetry_frames
       WHERE lap_id = $1`,
      [lap.id]
    );

    const s = stats.rows[0];
    const frameCount = parseInt(s.frame_count);
    if (!frameCount) return res.json({ lap_id: lap.id, frame_count: 0, channels: [] });

    const duration = parseFloat(s.t_end) - parseFloat(s.t_start);
    const sampleRateHz = duration > 0 ? Math.round(frameCount / duration) : null;

    const channelList = [];
    const addChannel = (name, count, min, max) => {
      if (parseInt(count) > 0) channelList.push({ name, min: parseFloat(min), max: parseFloat(max) });
    };

    addChannel('speed_kph',    s.speed_count,      s.speed_min,    s.speed_max);
    addChannel('throttle',     s.throttle_count,   s.throttle_min, s.throttle_max);
    addChannel('brake',        s.brake_count,      s.brake_min,    s.brake_max);
    addChannel('steering_deg', s.steer_count,      s.steer_min,    s.steer_max);
    addChannel('rpm',          s.rpm_count,        s.rpm_min,      s.rpm_max);
    if (parseInt(s.gear_count))       channelList.push({ name: 'gear' });
    if (parseInt(s.lat_accel_count))  channelList.push({ name: 'lat_accel' });
    if (parseInt(s.long_accel_count)) channelList.push({ name: 'long_accel' });
    if (parseInt(s.yaw_rate_count))   channelList.push({ name: 'yaw_rate' });
    if (parseInt(s.dist_count))       channelList.push({ name: 'lap_dist_pct' });

    res.json({
      lap_id:        lap.id,
      lap_number:    lap.lap_number,
      lap_time:      lap.lap_time,
      track:         lap.track_name,
      car:           lap.car_name,
      source:        s.source,
      frame_count:   frameCount,
      duration_s:    parseFloat(duration.toFixed(3)),
      sample_rate_hz: sampleRateHz,
      channels:      channelList
    });
  } catch (error) {
    console.error('laps/:id/channels error:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// GET /api/telemetry/laps/:id/features
router.get('/laps/:id/features', authenticateToken, async (req, res) => {
  try {
    const lapResult = await query(
      `SELECT l.id, l.user_id FROM laps l WHERE l.id = $1 AND l.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!lapResult.rows.length) return res.status(404).json({ error: 'Lap not found' });

    const featResult = await query(
      'SELECT * FROM lap_features WHERE lap_id = $1',
      [req.params.id]
    );
    if (!featResult.rows.length) {
      return res.status(404).json({ error: 'No features computed for this lap yet' });
    }

    res.json({ features: featResult.rows[0] });
  } catch (error) {
    console.error('laps/:id/features error:', error);
    res.status(500).json({ error: 'Failed to fetch lap features' });
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
