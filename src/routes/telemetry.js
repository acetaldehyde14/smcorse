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
    'lat_accel', 'long_accel', 'yaw_rate', 'steer_torque', 'track_temp_c', 'air_temp_c',
    'x_pos', 'y_pos', 'source'
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
        f.x_pos ?? null,
        f.y_pos ?? null,
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
  const { frames } = await parser.parseFrames(filePath, 60);
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
  (req, res, next) => upload.single('telemetry')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  }),
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

      // Mark file-upload sessions as closed immediately — they're complete
      await query(`UPDATE sessions SET status = 'closed', ended_at = NOW() WHERE id = $1`, [sessionId]);

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
async function resolveLiveSession(sessionId, userId, options = {}) {
  const ownerClause = options.allowTeamRead ? '' : 'AND user_id = $2';
  const params = options.allowTeamRead ? [sessionId] : [sessionId, userId];

  const canonical = await query(
    `SELECT id, track_name, car_name, session_type, ingest_mode, status, created_at, ended_at
     FROM sessions
     WHERE id = $1 ${ownerClause}
     LIMIT 1`,
    params
  );
  if (canonical.rowCount > 0) {
    return { source: 'sessions', session: canonical.rows[0] };
  }

  const fallback = await query(
    `SELECT id, track_name, car_name, session_type, started_at, ended_at, created_at
     FROM telemetry_sessions
     WHERE id = $1 ${ownerClause}
     LIMIT 1`,
    params
  );
  if (fallback.rowCount > 0) {
    const row = fallback.rows[0];
    return {
      source: 'telemetry_sessions',
      session: {
        id: row.id,
        track_name: row.track_name,
        car_name: row.car_name,
        session_type: row.session_type,
        ingest_mode: 'live',
        status: row.ended_at ? 'closed' : 'open',
        created_at: row.started_at || row.created_at,
        ended_at: row.ended_at || null
      }
    };
  }

  return null;
}

function parseBatchFrame(frame) {
  const toNum = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    session_time: toNum(frame?.session_time ?? frame?.t),
    lap_number: frame?.lap_number ?? frame?.lap ?? null,
    lap_dist_pct: toNum(frame?.lap_dist_pct ?? frame?.ldp),
    speed_kph: toNum(frame?.speed_kph ?? frame?.spd),
    throttle: toNum(frame?.throttle ?? frame?.thr),
    brake: toNum(frame?.brake ?? frame?.brk),
    steering_deg: toNum(frame?.steering_deg ?? frame?.steer),
    gear: frame?.gear ?? null,
    rpm: frame?.rpm ?? null,
    lat_accel: toNum(frame?.lat_accel ?? frame?.glat),
    long_accel: toNum(frame?.long_accel ?? frame?.glon ?? frame?.long),
    yaw_rate: toNum(frame?.yaw_rate ?? frame?.yaw)
  };
}

router.post('/live/session/start', authenticateToken, async (req, res) => {
  const {
    sim_session_uid, sub_session_id, track_id, track_name,
    car_id, car_name, session_type, driver_name, iracing_driver_id, started_at,
  } = req.body;

  if (!track_id && !track_name) {
    return res.status(400).json({ error: 'track_id or track_name is required' });
  }
  if (!session_type) {
    return res.status(400).json({ error: 'session_type is required' });
  }

  try {
    // Reuse existing telemetry_session if same iRacing subsession (client reconnected)
    if (sim_session_uid) {
      const existing = await query(
        'SELECT id FROM telemetry_sessions WHERE sim_session_uid = $1 AND user_id = $2 AND ended_at IS NULL LIMIT 1',
        [sim_session_uid, req.user.id]
      );
      if (existing.rowCount > 0) {
        return res.json({ session_id: existing.rows[0].id });
      }
    }

    const result = await query(
      `INSERT INTO telemetry_sessions
         (user_id, sim_session_uid, track_id, track_name, car_id, car_name,
          session_type, driver_name, iracing_driver_id, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        req.user.id,
        sim_session_uid || null,
        track_id || track_name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        track_name || null,
        car_id || null,
        car_name || null,
        session_type,
        driver_name || null,
        iracing_driver_id ? String(iracing_driver_id) : null,
        started_at || new Date().toISOString(),
      ]
    );

    res.json({ session_id: result.rows[0].id });
  } catch (err) {
    console.error('[Telemetry] session/start error:', err);
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

// POST /api/telemetry/live/batch  — store a batch of raw frames as JSONB in telemetry_batches
router.post('/live/batch', authenticateToken, async (req, res) => {
  const { session_id, lap_number, sample_rate_hz, frames } = req.body;

  if (!session_id || !Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: 'session_id and frames[] required' });
  }

  try {
    const sess = await query(
      'SELECT id FROM telemetry_sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (!sess.rowCount) return res.status(404).json({ error: 'Session not found' });

    await query(
      `INSERT INTO telemetry_batches (session_id, lap_number, sample_rate, samples)
       VALUES ($1, $2, $3, $4)`,
      [session_id, lap_number || 0, sample_rate_hz || 60, JSON.stringify(frames)]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[Telemetry] batch error:', err);
    res.status(500).json({ error: 'Failed to store batch' });
  }
});

// POST /api/telemetry/live/lap-complete — record a completed lap in telemetry_laps
router.post('/live/lap-complete', authenticateToken, async (req, res) => {
  const { session_id, lap_number, lap_time_s, lap_time, is_valid, incidents } = req.body;
  const normalizedLapTime = lap_time_s ?? lap_time ?? null;

  if (!session_id || lap_number == null) {
    return res.status(400).json({ error: 'session_id and lap_number required' });
  }

  try {
    const sess = await query(
      'SELECT id FROM telemetry_sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (!sess.rowCount) return res.status(404).json({ error: 'Session not found' });

    await query(
      `INSERT INTO telemetry_laps (session_id, lap_number, lap_time_s, is_valid, incidents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, lap_number) DO UPDATE
         SET lap_time_s = EXCLUDED.lap_time_s,
             is_valid   = EXCLUDED.is_valid,
             incidents  = EXCLUDED.incidents`,
      [session_id, lap_number, normalizedLapTime, is_valid !== false, incidents || 0]
    );

    const canonicalSession = await query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
      [session_id, req.user.id]
    );
    if (canonicalSession.rowCount > 0) {
      const existingLap = await query(
        'SELECT id FROM laps WHERE session_id = $1 AND lap_number = $2 LIMIT 1',
        [session_id, lap_number]
      );
      if (existingLap.rowCount > 0) {
        await query(
          `UPDATE laps SET lap_time = COALESCE($1, lap_time), is_valid = $2
           WHERE id = $3`,
          [normalizedLapTime, is_valid !== false, existingLap.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO laps (session_id, user_id, lap_number, lap_time, is_valid, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [session_id, req.user.id, lap_number, normalizedLapTime, is_valid !== false]
        );
      }
    }

    if (normalizedLapTime != null) {
      await query(
        `UPDATE telemetry_sessions
         SET best_lap_s = LEAST(COALESCE(best_lap_s, $2), $2)
         WHERE id = $1 AND user_id = $3`,
        [session_id, Number(normalizedLapTime), req.user.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Telemetry] lap-complete error:', err);
    res.status(500).json({ error: 'Failed to record lap' });
  }
});

// POST /api/telemetry/live/session/end
// Handles both the legacy `sessions` table (desktop client) and the new `telemetry_sessions` table.
router.post('/live/session/end', authenticateToken, async (req, res) => {
  try {
    const { session_id, total_laps, best_lap_s, avg_fuel_per_lap } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    // Try new telemetry_sessions table first
    const newResult = await query(
      `UPDATE telemetry_sessions
       SET ended_at = NOW(), total_laps = $2, best_lap_s = $3, avg_fuel_per_lap = $4
       WHERE id = $1 AND user_id = $5`,
      [session_id, total_laps || null, best_lap_s || null, avg_fuel_per_lap || null, req.user.id]
    );

    // Always also try legacy sessions table (Python desktop client uses this)
    const result = await query(
      `UPDATE sessions SET status = 'closed', ended_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [session_id, req.user.id]
    );

    // 404 only if neither table had a matching row
    if (!result.rows.length && !newResult.rowCount) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Capture which table(s) were updated before sending the response
    const isCanonicalSession = result.rows.length > 0;
    const isTelemetrySession = newResult.rowCount > 0 && !isCanonicalSession;

    res.json({ ok: true, session_id });

    // Async: create lap entries from live frames, compute features, and promote telemetry_sessions
    (async () => {
      try {
        if (isCanonicalSession) {
          // For canonical live sessions: create laps from telemetry_frames if not already present
          const sessRow = await query(
            `SELECT ingest_mode, user_id FROM sessions WHERE id = $1`,
            [session_id]
          );
          if (sessRow.rows[0]?.ingest_mode === 'live') {
            const lapGroups = await query(
              `SELECT lap_number,
                      MIN(session_time) as t_start,
                      MAX(session_time) as t_end,
                      COUNT(*) as frame_count
               FROM telemetry_frames
               WHERE session_id = $1 AND lap_number IS NOT NULL AND lap_number > 0
               GROUP BY lap_number
               HAVING COUNT(*) >= 10
               ORDER BY lap_number`,
              [session_id]
            );
            for (const g of lapGroups.rows) {
              const lapTime = parseFloat(g.t_end) - parseFloat(g.t_start);
              if (lapTime < 30 || lapTime > 7200) continue;
              const exists = await query(
                `SELECT 1 FROM laps WHERE session_id = $1 AND lap_number = $2 LIMIT 1`,
                [session_id, g.lap_number]
              );
              if (exists.rowCount > 0) continue;
              const ins = await query(
                `INSERT INTO laps (session_id, user_id, lap_number, lap_time, created_at)
                 VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
                [session_id, req.user.id, g.lap_number, lapTime.toFixed(3)]
              );
              const lapId = ins.rows[0].id;
              await query(
                `UPDATE telemetry_frames SET lap_id = $1
                 WHERE session_id = $2 AND lap_number = $3 AND lap_id IS NULL`,
                [lapId, session_id, g.lap_number]
              );
            }
            console.log(`[session/end] Created laps from live frames for session ${session_id}`);
          }

          // Compute features for any laps that don't have them yet
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
        }

        if (isTelemetrySession) {
          // Promote telemetry_sessions → canonical sessions/laps/telemetry_frames tables
          // so the laps appear in the library, coaching interface, and all-laps endpoint.
          const tsRow = await query(
            'SELECT * FROM telemetry_sessions WHERE id = $1',
            [session_id]
          );
          if (!tsRow.rowCount) return;
          const ts = tsRow.rows[0];

          const newSess = await query(
            `INSERT INTO sessions
               (user_id, track_id, track_name, car_id, car_name, session_type, ingest_mode, status, created_at, ended_at)
             VALUES ($1,$2,$3,$4,$5,$6,'live','closed',$7,$8)
             RETURNING id, created_at`,
            [
              ts.user_id,
              ts.track_id || (ts.track_name || '').toLowerCase().replace(/[^a-z0-9]/g, '_'),
              ts.track_name,
              ts.car_id || (ts.car_name || '').toLowerCase().replace(/[^a-z0-9]/g, '_'),
              ts.car_name,
              ts.session_type,
              ts.started_at || ts.created_at,
              ts.ended_at || new Date().toISOString()
            ]
          );
          const canonicalSessionId = newSess.rows[0].id;
          const sessionCreatedAt = newSess.rows[0].created_at;

          const tLaps = await query(
            `SELECT * FROM telemetry_laps
             WHERE session_id = $1 AND lap_time_s > 30 AND lap_time_s < 7200
             ORDER BY lap_number`,
            [session_id]
          );

          for (const tLap of tLaps.rows) {
            const lapIns = await query(
              `INSERT INTO laps (session_id, user_id, lap_number, lap_time, is_valid, created_at)
               VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
              [canonicalSessionId, ts.user_id, tLap.lap_number, tLap.lap_time_s, tLap.is_valid]
            );
            const lapId = lapIns.rows[0].id;

            const batches = await query(
              'SELECT samples FROM telemetry_batches WHERE session_id = $1 AND lap_number = $2 ORDER BY id',
              [session_id, tLap.lap_number]
            );

            const allFrames = batches.rows
              .flatMap(r => (Array.isArray(r.samples) ? r.samples : []))
              .map(parseBatchFrame)
              .filter(f => f.session_time != null);

            if (allFrames.length > 0) {
              const baseTs = new Date(sessionCreatedAt).getTime();
              for (const f of allFrames) {
                f.ts = new Date(baseTs + f.session_time * 1000).toISOString();
                f.lap_id = lapId;
                f.lap_number = tLap.lap_number;
              }
              await bulkInsertFrames(query, allFrames, canonicalSessionId, ts.user_id, lapId, 'live');

              const features = computeLapFeatures(allFrames);
              await insertLapFeatures(query, lapId, canonicalSessionId, ts.user_id, tLap.lap_time_s, null, features);
            }
          }

          console.log(`[session/end] Promoted telemetry_session ${session_id} → canonical session ${canonicalSessionId} (${tLaps.rows.length} laps)`);
        }
      } catch (e) {
        console.error('[session/end] Post-processing error:', e.message);
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
    const resolved = await resolveLiveSession(req.params.id, req.user.id, { allowTeamRead: true });
    if (!resolved) return res.status(404).json({ error: 'Session not found' });

    const [frameCount, lapCount] = resolved.source === 'sessions'
      ? await Promise.all([
          query('SELECT COUNT(*) FROM telemetry_frames WHERE session_id = $1', [req.params.id]),
          query('SELECT COUNT(*) FROM laps WHERE session_id = $1', [req.params.id])
        ])
      : await Promise.all([
          query(
            `SELECT COALESCE(SUM(jsonb_array_length(samples)), 0)::bigint AS count
             FROM telemetry_batches WHERE session_id = $1`,
            [req.params.id]
          ),
          query('SELECT COUNT(*) FROM telemetry_laps WHERE session_id = $1', [req.params.id])
        ]);

    res.json({
      session: resolved.session,
      frame_count: parseInt(frameCount.rows[0].count),
      lap_count:   parseInt(lapCount.rows[0].count)
    });
  } catch (error) {
    console.error('live/session/:id/status error:', error);
    res.status(500).json({ error: 'Failed to fetch session status' });
  }
});

// GET /api/telemetry/live/active
// Returns the best available session for the live page:
//   1. Most recent open live-streamed session (desktop client running)
//   2. Fallback: most recent session that has telemetry frames (IBT upload)
router.get('/live/active', authenticateToken, async (req, res) => {
  try {
    // Only return a session if it is an open live session with a frame in the last 90 seconds.
    // This ensures the tracker stops showing when the desktop client disconnects.
    const result = await query(
      `SELECT s.id, s.ingest_mode, s.status
       FROM sessions s
       WHERE s.status = 'open'
         AND s.ingest_mode = 'live'
         AND EXISTS (
           SELECT 1 FROM telemetry_frames tf
           WHERE tf.session_id = s.id
             AND tf.ts > NOW() - INTERVAL '90 seconds'
           LIMIT 1
         )
       ORDER BY s.created_at DESC
       LIMIT 1`,
      []
    );
    if (result.rows.length) {
      return res.json({
        session_id:  result.rows[0].id,
        ingest_mode: result.rows[0].ingest_mode,
        is_live:     true
      });
    }

    const legacy = await query(
      `SELECT ts.id
       FROM telemetry_sessions ts
       WHERE ts.ended_at IS NULL
         AND EXISTS (
           SELECT 1 FROM telemetry_batches tb
           WHERE tb.session_id = ts.id
             AND tb.created_at > NOW() - INTERVAL '120 seconds'
           LIMIT 1
         )
       ORDER BY ts.started_at DESC NULLS LAST, ts.created_at DESC
       LIMIT 1`,
      []
    );
    if (!legacy.rows.length) return res.json({ session_id: null, is_live: false });
    return res.json({
      session_id: legacy.rows[0].id,
      ingest_mode: 'live',
      is_live: true
    });
  } catch (error) {
    console.error('live/active error:', error);
    res.status(500).json({ error: 'Failed to fetch active session' });
  }
});

// GET /api/telemetry/live/session/:id/frames
// Returns frames after since_session_time, up to limit rows (max 1000).
router.get('/live/session/:id/frames', authenticateToken, async (req, res) => {
  try {
    const sinceTime = parseFloat(req.query.since_session_time) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);

    const resolved = await resolveLiveSession(req.params.id, req.user.id, { allowTeamRead: true });
    if (!resolved) return res.status(404).json({ error: 'Session not found' });

    let frames = [];
    if (resolved.source === 'sessions') {
      const result = await query(
        `SELECT session_time, lap_number, lap_dist_pct,
                speed_kph, throttle, brake, steering_deg, gear, rpm,
                lat_accel, long_accel, yaw_rate
         FROM telemetry_frames
         WHERE session_id = $1 AND session_time > $2
         ORDER BY session_time ASC
         LIMIT $3`,
        [req.params.id, sinceTime, limit]
      );
      frames = result.rows;
    } else {
      const batches = await query(
        `SELECT samples
         FROM telemetry_batches
         WHERE session_id = $1
         ORDER BY created_at DESC
         LIMIT 8`,
        [req.params.id]
      );
      frames = batches.rows
        .flatMap((r) => (Array.isArray(r.samples) ? r.samples : []))
        .map(parseBatchFrame)
        .filter((f) => f.session_time != null && f.session_time > sinceTime)
        .sort((a, b) => a.session_time - b.session_time)
        .slice(-limit);
    }
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
    const resolved = await resolveLiveSession(req.params.id, req.user.id, { allowTeamRead: true });
    if (!resolved) return res.status(404).json({ error: 'Session not found' });

    let lf = null;
    let laps = [];
    let frameCount = 0;
    if (resolved.source === 'sessions') {
      const [latestFrame, lapsResult, frameCountResult] = await Promise.all([
        query(
          `SELECT session_time, lap_number, speed_kph, throttle, brake, gear, rpm, ts
           FROM telemetry_frames WHERE session_id = $1
           ORDER BY session_time DESC LIMIT 1`,
          [req.params.id]
        ),
        query(
          `SELECT lap_number, lap_time FROM laps WHERE session_id = $1
           ORDER BY lap_number ASC`,
          [req.params.id]
        ),
        query('SELECT COUNT(*) FROM telemetry_frames WHERE session_id = $1', [req.params.id])
      ]);
      lf = latestFrame.rows[0] ?? null;
      laps = lapsResult.rows;
      frameCount = parseInt(frameCountResult.rows[0].count);
    } else {
      const [lapRows, batchRows] = await Promise.all([
        query(
          `SELECT lap_number, lap_time_s AS lap_time
           FROM telemetry_laps
           WHERE session_id = $1
           ORDER BY lap_number ASC`,
          [req.params.id]
        ),
        query(
          `SELECT samples
           FROM telemetry_batches
           WHERE session_id = $1
           ORDER BY created_at DESC
           LIMIT 8`,
          [req.params.id]
        )
      ]);
      laps = lapRows.rows;
      const parsed = batchRows.rows
        .flatMap((r) => (Array.isArray(r.samples) ? r.samples : []))
        .map(parseBatchFrame)
        .filter((f) => f.session_time != null)
        .sort((a, b) => a.session_time - b.session_time);
      frameCount = parsed.length;
      if (parsed.length > 0) {
        const last = parsed[parsed.length - 1];
        lf = {
          session_time: last.session_time,
          lap_number: last.lap_number,
          speed_kph: last.speed_kph,
          throttle: last.throttle,
          brake: last.brake,
          gear: last.gear,
          rpm: last.rpm,
          ts: null
        };
      }
    }

    const best = laps.reduce(
      (b, l) => (!b || Number(l.lap_time) < Number(b.lap_time)) ? l : b,
      null
    );

    res.json({
      session:             resolved.session,
      status:              resolved.session.status,
      frame_count:         frameCount,
      latest_session_time: lf ? parseFloat(lf.session_time) : null,
      last_frame_ts:       lf?.ts ?? null,
      current_lap:         lf?.lap_number ?? null,
      best_lap_number:     best?.lap_number ?? null,
      best_lap_time:       best?.lap_time ?? null,
      lap_count:           laps.length,
      laps,
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
// GET /api/telemetry/sessions/:sessionId/laps — laps from telemetry_laps for a telemetry_session
router.get('/sessions/:sessionId/laps', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;
  try {
    const sess = await query(
      'SELECT id FROM telemetry_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );
    if (!sess.rowCount) return res.status(404).json({ error: 'Session not found' });

    const result = await query(
      `SELECT lap_number, lap_time_s, is_valid, incidents
       FROM telemetry_laps WHERE session_id = $1 ORDER BY lap_number`,
      [sessionId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Telemetry] sessions/:id/laps error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/telemetry/sessions/:sessionId/lap/:lapNumber
// Return all samples for one lap from telemetry_batches, sorted by lap_dist_pct, deduped
router.get('/sessions/:sessionId/lap/:lapNumber', authenticateToken, async (req, res) => {
  const { sessionId, lapNumber } = req.params;
  try {
    const sess = await query(
      'SELECT id FROM telemetry_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );
    if (!sess.rowCount) return res.status(404).json({ error: 'Session not found' });

    const result = await query(
      `SELECT samples FROM telemetry_batches
       WHERE session_id = $1 AND lap_number = $2 ORDER BY id`,
      [sessionId, lapNumber]
    );

    // Flatten all batches into one sorted, deduped array
    const allSamples = result.rows.flatMap(row => row.samples);
    allSamples.sort((a, b) => (a.ldp ?? a.lap_dist_pct ?? 0) - (b.ldp ?? b.lap_dist_pct ?? 0));

    const deduped = [];
    let lastLdp = -1;
    for (const s of allSamples) {
      const ldp = s.ldp ?? s.lap_dist_pct ?? 0;
      if (ldp - lastLdp >= 0.0005) { deduped.push(s); lastLdp = ldp; }
    }

    res.json(deduped);
  } catch (err) {
    console.error('[Telemetry] sessions/:id/lap/:n error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
                steering_deg, gear, rpm, lat_accel, long_accel, yaw_rate,
                x_pos, y_pos
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
       ORDER BY s.created_at DESC, l.lap_number ASC`,
      [req.user.id]
    );
    res.json({ laps: result.rows });
  } catch (error) {
    console.error('Get all laps error:', error);
    res.status(500).json({ error: 'Failed to fetch laps' });
  }
});

module.exports = router;
