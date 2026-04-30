'use strict';

/**
 * coaching.js
 * API routes for the real-time coaching system.
 * All routes require authentication via authenticateToken middleware.
 */

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { query, transaction } = require('../config/database');
const { buildReferenceForLap } = require('../services/coaching/referenceBuilder');
const { analyzeObservation }   = require('../services/coaching/observationAnalyzer');
const { buildLapSummary }      = require('../services/coaching/lapSummary');

const router = express.Router();
const COACHING_VOICE_DIR = path.join(__dirname, '../../public/coaching-voice');
const REQUIRED_CONTEXT_CLIPS = ['here', 'there', 'thiscorner', 'nextcorner', 'lastcorner'];
const FORBIDDEN_CLIP_PATTERNS = [
  ['corner', 'turn'].join('_') + '_',
  ['turn', '1'].join('_'),
  ['turn', '2'].join('_'),
  ['turn', '3'].join('_'),
  ['corner', 'next', 'turn'].join('_'),
];

function isForbiddenClipKey(key) {
  return FORBIDDEN_CLIP_PATTERNS.some(pattern => key.includes(pattern));
}

function wavPathForKey(key) {
  return path.join(COACHING_VOICE_DIR, `${key}.wav`);
}

function clipExists(key) {
  return fs.existsSync(wavPathForKey(key));
}

function buildStartupCue() {
  const sequence = clipExists('track')
    ? ['coaching_active', 'track']
    : ['coaching_active'];

  return {
    display_text: 'Coaching active for this track',
    sequence,
  };
}

function contextForReferenceZone(zone) {
  if (zone.segment_type === 'lift') return 'nextcorner';
  if (zone.segment_type === 'apex' || zone.segment_type === 'throttle_pickup') return 'thiscorner';
  return 'here';
}

function decorateCoachingZone(zone) {
  const sequence = zone.generic_voice_key
    ? [zone.generic_voice_key, contextForReferenceZone(zone)]
    : [];

  return {
    ...zone,
    display_text: zone.generic_display_text || null,
    voice_key: null,
    sequence,
    cue_type: 'reference',
  };
}

function buildFilesystemVoiceManifest() {
  const clips = {};

  for (const key of REQUIRED_CONTEXT_CLIPS) {
    clips[key] = `/coaching-voice/${key}.wav`;
  }

  if (fs.existsSync(COACHING_VOICE_DIR)) {
    const files = fs.readdirSync(COACHING_VOICE_DIR, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.wav') continue;
      const key = path.basename(file.name, path.extname(file.name));
      if (isForbiddenClipKey(key)) continue;
      clips[key] = `/coaching-voice/${file.name}`;
    }
  }

  return {
    version: 1,
    clips,
  };
}

// ── Reference management ──────────────────────────────────────────────────────

/**
 * POST /api/coaching/reference/:lapId/activate
 * Create a coaching reference from an existing lap.
 * Body: { title?, notes?, track_id?, car_id?, track_config? }
 * track_id and car_id are auto-resolved from the lap's session when omitted.
 */
router.post('/reference/:lapId/activate', async (req, res) => {
  const lapId = parseInt(req.params.lapId);

  if (!Number.isFinite(lapId)) {
    return res.status(400).json({ error: 'Invalid lapId' });
  }

  const { title, notes, track_config } = req.body;
  let { track_id, car_id } = req.body;

  try {
    // Look up session info for this lap; auto-resolve track/car if omitted
    const lapResult = await query(
      `SELECT l.session_id, s.track_id, s.car_id
       FROM laps l JOIN sessions s ON s.id = l.session_id
       WHERE l.id = $1`,
      [lapId]
    );
    if (!lapResult.rows.length) {
      return res.status(404).json({ error: 'Lap not found' });
    }
    const { session_id: sessionId, track_id: sTrackId, car_id: sCarId } = lapResult.rows[0];
    track_id = track_id || sTrackId;
    car_id   = car_id   || sCarId;

    if (!track_id || !car_id) {
      return res.status(400).json({ error: 'track_id and car_id are required' });
    }

    const referenceId = await transaction(async (client) => {
      // Deactivate previous active reference for same user+track+car
      await client.query(
        `UPDATE coaching_reference_laps
         SET is_active = FALSE, updated_at = NOW()
         WHERE user_id = $1 AND track_id = $2 AND car_id = $3 AND is_active = TRUE`,
        [req.user.id, track_id, car_id]
      );

      // Insert new reference lap
      const insertResult = await client.query(
        `INSERT INTO coaching_reference_laps
           (user_id, session_id, lap_id, track_id, car_id, track_config,
            title, notes, source_type, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded', TRUE, NOW())
         RETURNING id`,
        [req.user.id, sessionId, lapId, track_id, car_id, track_config || null,
         title || null, notes || null]
      );

      return insertResult.rows[0].id;
    });

    res.json({ reference_id: referenceId, status: 'activated' });
  } catch (err) {
    console.error('[coaching] activate error:', err);
    res.status(500).json({ error: 'Failed to activate reference lap' });
  }
});

/**
 * POST /api/coaching/reference/:referenceId/rebuild
 * Rebuild reference points and zones from telemetry frames.
 */
router.post('/reference/:referenceId/rebuild', async (req, res) => {
  const referenceId = parseInt(req.params.referenceId);

  if (!Number.isFinite(referenceId)) {
    return res.status(400).json({ error: 'Invalid referenceId' });
  }

  try {
    // Get the lap_id for this reference (and verify ownership)
    const refResult = await query(
      'SELECT lap_id FROM coaching_reference_laps WHERE id = $1 AND user_id = $2',
      [referenceId, req.user.id]
    );
    if (!refResult.rows.length) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    const { lap_id } = refResult.rows[0];
    if (!lap_id) {
      return res.status(400).json({ error: 'Reference has no associated lap' });
    }

    const result = await buildReferenceForLap(referenceId, lap_id);

    res.json(result);
  } catch (err) {
    console.error('[coaching] rebuild error:', err);
    res.status(500).json({ error: 'Failed to rebuild reference' });
  }
});

/**
 * GET /api/coaching/reference/active
 * Get all active references for the current user.
 */
router.get('/reference/active', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, session_id, lap_id, track_id, track_name, track_config,
              car_id, car_name, title, notes, created_at, updated_at
       FROM coaching_reference_laps
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json(result.rows.map(decorateCoachingZone));
  } catch (err) {
    console.error('[coaching] active references error:', err);
    res.status(500).json({ error: 'Failed to fetch active references' });
  }
});

/**
 * GET /api/coaching/reference/:referenceId
 * Get metadata for a specific reference lap.
 */
router.get('/reference/:referenceId', async (req, res) => {
  const referenceId = parseInt(req.params.referenceId);

  try {
    const result = await query(
      `SELECT id, session_id, lap_id, track_id, track_name, track_config,
              car_id, car_name, setup_hash, weather_bucket, source_type,
              title, notes, is_active, created_at, updated_at
       FROM coaching_reference_laps
       WHERE id = $1 AND user_id = $2`,
      [referenceId, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Reference not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[coaching] get reference error:', err);
    res.status(500).json({ error: 'Failed to fetch reference' });
  }
});

/**
 * GET /api/coaching/reference/:referenceId/zones
 * Get all zones for a reference lap.
 */
router.get('/reference/:referenceId/zones', async (req, res) => {
  const referenceId = parseInt(req.params.referenceId);

  try {
    // Verify ownership
    const ownerCheck = await query(
      'SELECT id FROM coaching_reference_laps WHERE id = $1 AND user_id = $2',
      [referenceId, req.user.id]
    );
    if (!ownerCheck.rows.length) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    const result = await query(
      `SELECT id, zone_id, sequence_index, name, segment_type,
              lap_dist_start, lap_dist_callout, lap_dist_end,
              target_entry_speed_kph, target_min_speed_kph, target_exit_speed_kph,
              target_brake_initial_pct, target_brake_peak_pct, target_brake_release_pct,
              target_throttle_min_pct, target_throttle_reapply_pct,
              target_gear, target_duration_s, priority,
              generic_display_text, generic_voice_key, correction_template_json
       FROM coaching_zones
       WHERE reference_lap_id = $1
       ORDER BY sequence_index ASC`,
      [referenceId]
    );
    res.json(result.rows.map(decorateCoachingZone));
  } catch (err) {
    console.error('[coaching] get zones error:', err);
    res.status(500).json({ error: 'Failed to fetch zones' });
  }
});

// ── Profile ───────────────────────────────────────────────────────────────────

/**
 * GET /api/coaching/profile/active?track_id=&car_id=
 * Get the active coaching profile (reference + zones) for a track/car combo.
 * Intended for desktop client consumption.
 */
router.get('/profile/active', async (req, res) => {
  const { track_id, car_id } = req.query;

  if (!track_id || !car_id) {
    return res.status(400).json({ error: 'track_id and car_id query params required' });
  }

  try {
    // Get active reference for this user/track/car
    const refResult = await query(
      `SELECT crl.id, crl.lap_id, crl.track_id, crl.track_name, crl.track_config, crl.car_id, crl.car_name,
              crl.title, crl.notes, crl.created_at, crl.updated_at,
              t.length_meters AS track_length_m
       FROM coaching_reference_laps
       crl
       LEFT JOIN tracks t
         ON t.track_code = crl.track_id
       WHERE crl.user_id = $1 AND crl.track_id = $2 AND crl.car_id = $3 AND crl.is_active = TRUE
       LIMIT 1`,
      [req.user.id, track_id, car_id]
    );

    if (!refResult.rows.length) {
      return res.json({
        profile_id: null,
        track_id: String(track_id),
        car_id: String(car_id),
        track_name: null,
        car_name: null,
        track_length_m: null,
        version: 1,
        startup_cue: null,
        zones: [],
      });
    }

    const reference = refResult.rows[0];

    const zonesResult = await query(
      `SELECT zone_id, sequence_index, name, segment_type,
              lap_dist_start, lap_dist_callout, lap_dist_end,
              target_entry_speed_kph, target_min_speed_kph, target_exit_speed_kph,
              target_brake_peak_pct, target_brake_release_pct,
              target_throttle_reapply_pct, target_gear, target_duration_s,
              priority, generic_display_text, generic_voice_key, correction_template_json
       FROM coaching_zones
       WHERE reference_lap_id = $1
       ORDER BY sequence_index ASC`,
      [reference.id]
    );

    res.json({
      profile_id: reference.id,
      track_id: reference.track_id,
      car_id: reference.car_id,
      track_name: reference.track_name,
      car_name: reference.car_name,
      track_length_m: reference.track_length_m || null,
      version: 1,
      startup_cue: buildStartupCue(),
      zones: zonesResult.rows.map(decorateCoachingZone),
    });
  } catch (err) {
    console.error('[coaching] profile/active error:', err);
    res.status(500).json({ error: 'Failed to fetch coaching profile' });
  }
});

/**
 * GET /api/coaching/profile/by-session/:sessionId
 * Resolve session track/car and return active profile for that context.
 */
router.get('/profile/by-session/:sessionId', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (!Number.isFinite(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  try {
    const sessionResult = await query(
      'SELECT track_id, car_id FROM sessions WHERE id = $1 LIMIT 1',
      [sessionId]
    );

    if (!sessionResult.rows.length) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { track_id, car_id } = sessionResult.rows[0];
    if (!track_id || !car_id) {
      return res.status(400).json({ error: 'Session has no track_id/car_id' });
    }

    const refResult = await query(
      `SELECT crl.id, crl.track_id, crl.track_name, crl.car_id, crl.car_name,
              t.length_meters AS track_length_m
       FROM coaching_reference_laps crl
       LEFT JOIN tracks t
         ON t.track_code = crl.track_id
       WHERE crl.user_id = $1
         AND crl.track_id = $2
         AND crl.car_id = $3
         AND crl.is_active = TRUE
       LIMIT 1`,
      [req.user.id, track_id, car_id]
    );

    if (!refResult.rows.length) {
      return res.json({
        profile_id: null,
        track_id: String(track_id),
        car_id: String(car_id),
        track_name: null,
        car_name: null,
        track_length_m: null,
        version: 1,
        startup_cue: null,
        zones: [],
      });
    }

    const reference = refResult.rows[0];
    const zonesResult = await query(
      `SELECT zone_id, sequence_index, name, segment_type,
              lap_dist_start, lap_dist_callout, lap_dist_end,
              target_entry_speed_kph, target_min_speed_kph, target_exit_speed_kph,
              target_brake_peak_pct, target_brake_release_pct,
              target_throttle_reapply_pct, target_gear, target_duration_s,
              priority, generic_display_text, generic_voice_key, correction_template_json
       FROM coaching_zones
       WHERE reference_lap_id = $1
       ORDER BY sequence_index ASC`,
      [reference.id]
    );

    return res.json({
      profile_id: reference.id,
      track_id: reference.track_id,
      car_id: reference.car_id,
      track_name: reference.track_name,
      car_name: reference.car_name,
      track_length_m: reference.track_length_m || null,
      version: 1,
      startup_cue: buildStartupCue(),
      zones: zonesResult.rows.map(decorateCoachingZone),
    });
  } catch (err) {
    console.error('[coaching] profile/by-session error:', err);
    return res.status(500).json({ error: 'Failed to fetch profile by session' });
  }
});

// ── Observations ──────────────────────────────────────────────────────────────

/**
 * POST /api/coaching/observations
 * Ingest zone observations from the desktop client.
 * Body: { session_id, lap_number, lap_id?, observations: [{zone_id, ...observed_*}] }
 */
router.post('/observations', async (req, res) => {
  const { session_id, lap_number, lap_id, observations } = req.body;

  if (!session_id || lap_number == null || !Array.isArray(observations)) {
    return res.status(400).json({ error: 'session_id, lap_number and observations[] are required' });
  }

  try {
    // Look up the active reference to get zone targets
    // We'll use the reference_lap_id from the first observation that has one,
    // or find the active reference for this session's track/car
    const sessionResult = await query(
      'SELECT track_id, car_id FROM sessions WHERE id = $1',
      [session_id]
    );

    let referenceZonesMap = {};
    let referenceId = null;

    if (sessionResult.rows.length) {
      const { track_id, car_id } = sessionResult.rows[0];
      if (track_id && car_id) {
        const refResult = await query(
          `SELECT crl.id AS reference_id, cz.zone_id,
                  cz.lap_dist_callout, cz.target_brake_peak_pct,
                  cz.target_min_speed_kph, cz.target_entry_speed_kph,
                  cz.target_exit_speed_kph, cz.target_duration_s,
                  cz.target_throttle_reapply_pct
           FROM coaching_reference_laps crl
           JOIN coaching_zones cz ON cz.reference_lap_id = crl.id
           WHERE crl.user_id = $1 AND crl.track_id = $2 AND crl.car_id = $3
             AND crl.is_active = TRUE
           LIMIT 200`,
          [req.user.id, track_id, car_id]
        );

        for (const row of refResult.rows) {
          referenceId = row.reference_id;
          referenceZonesMap[row.zone_id] = row;
        }
      }
    }

    const insertedObs = [];
    const recommendations = [];

    for (const obs of observations) {
      const zone_id = obs.zone_id;
      const referenceZone = referenceZonesMap[zone_id] || null;

      // Compute deltas if we have a reference zone
      const analysis = referenceZone
        ? analyzeObservation(obs, referenceZone)
        : {
            delta_brake_start_m: null,
            delta_peak_brake_pct: null,
            delta_throttle_reapply_s: null,
            delta_min_speed_kph: null,
            delta_entry_speed_kph: null,
            recommendation_key: null,
            recommendation_payload: null,
            correction_event: null,
          };

      const insertResult = await query(
        `INSERT INTO coaching_zone_observations
           (session_id, lap_id, lap_number, zone_id, reference_lap_id,
            observed_brake_start_lap_dist, observed_brake_peak_pct, observed_brake_release_lap_dist,
            observed_throttle_off_lap_dist, observed_throttle_reapply_lap_dist,
            observed_entry_speed_kph, observed_min_speed_kph, observed_exit_speed_kph,
            observed_min_gear, observed_duration_s,
            delta_brake_start_m, delta_peak_brake_pct, delta_throttle_reapply_s,
            delta_min_speed_kph, delta_entry_speed_kph,
            recommendation_key, recommendation_payload)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING id`,
        [
          session_id,
          lap_id || null,
          lap_number,
          zone_id,
          referenceId,
          obs.observed_brake_start_lap_dist    ?? null,
          obs.observed_brake_peak_pct          ?? null,
          obs.observed_brake_release_lap_dist  ?? null,
          obs.observed_throttle_off_lap_dist   ?? null,
          obs.observed_throttle_reapply_lap_dist ?? null,
          obs.observed_entry_speed_kph         ?? null,
          obs.observed_min_speed_kph           ?? null,
          obs.observed_exit_speed_kph          ?? null,
          obs.observed_min_gear                ?? null,
          obs.observed_duration_s              ?? null,
          analysis.delta_brake_start_m         ?? null,
          analysis.delta_peak_brake_pct        ?? null,
          analysis.delta_throttle_reapply_s    ?? null,
          analysis.delta_min_speed_kph         ?? null,
          analysis.delta_entry_speed_kph       ?? null,
          analysis.recommendation_key          ?? null,
          analysis.recommendation_payload ? JSON.stringify(analysis.recommendation_payload) : null,
        ]
      );

      insertedObs.push(insertResult.rows[0].id);

      if (analysis.recommendation_key) {
        recommendations.push({
          display_text: analysis.correction_event?.display_text || null,
          voice_key: null,
          sequence: analysis.correction_event?.sequence || [],
          priority: analysis.correction_event?.priority || 'correction',
          zone_id,
          cue_type: analysis.correction_event?.cue_type || 'correction',
          recommendation_key: analysis.recommendation_key,
          recommendation_payload: analysis.recommendation_payload,
        });
      }
    }

    res.json({
      inserted: insertedObs.length,
      recommendations,
    });
  } catch (err) {
    console.error('[coaching] observations error:', err);
    res.status(500).json({ error: 'Failed to insert observations' });
  }
});

// ── Feedback events ───────────────────────────────────────────────────────────

/**
 * POST /api/coaching/feedback-events
 * Store coaching cue events generated by the desktop client.
 * Body: { session_id, lap_number, events: [{zone_id?, cue_key, cue_text?, cue_mode?}] }
 */
router.post('/feedback-events', async (req, res) => {
  const { session_id, lap_number, events } = req.body;

  if (!session_id || lap_number == null || !Array.isArray(events)) {
    return res.status(400).json({ error: 'session_id, lap_number and events[] are required' });
  }

  try {
    let inserted = 0;
    for (const evt of events) {
      if (!evt.cue_key) continue;
      await query(
        `INSERT INTO coaching_feedback_events
           (session_id, lap_number, zone_id, cue_key, cue_text, cue_mode, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session_id,
          lap_number,
          evt.zone_id || null,
          evt.cue_key,
          evt.cue_text || null,
          evt.cue_mode || 'display',
          evt.payload ? JSON.stringify(evt.payload) : null,
        ]
      );
      inserted++;
    }
    res.json({ inserted });
  } catch (err) {
    console.error('[coaching] feedback-events error:', err);
    res.status(500).json({ error: 'Failed to store feedback events' });
  }
});

// ── Summaries ─────────────────────────────────────────────────────────────────

/**
 * GET /api/coaching/lap-summary?session_id=&lap_number=
 * Return the lap summary JSON for a given session+lap.
 */
router.get('/lap-summary', async (req, res) => {
  const sessionId = parseInt(req.query.session_id);
  const lapNumber = parseInt(req.query.lap_number);

  if (!Number.isFinite(sessionId) || !Number.isFinite(lapNumber)) {
    return res.status(400).json({ error: 'session_id and lap_number query params required' });
  }

  try {
    const summary = await buildLapSummary(sessionId, lapNumber);
    res.json(summary);
  } catch (err) {
    console.error('[coaching] lap-summary error:', err);
    res.status(500).json({ error: 'Failed to build lap summary' });
  }
});

// ── Voice ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/coaching/voice/manifest
 * Return the latest voice cue manifest JSON.
 */
router.get('/voice/manifest', async (req, res) => {
  try {
    const filesystemManifest = buildFilesystemVoiceManifest();
    if (Object.keys(filesystemManifest.clips).length > 0) {
      return res.json(filesystemManifest);
    }

    const result = await query(
      `SELECT manifest_json
       FROM coaching_voice_manifests
       ORDER BY id DESC
       LIMIT 1`
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'No voice manifest found — run build-coaching-voice-pack first' });
    }
    const dbManifest = result.rows[0].manifest_json || {};
    if (Array.isArray(dbManifest.cues) && !dbManifest.clips) {
      const clips = {};
      for (const cue of dbManifest.cues) {
        if (!cue.cue_key || !cue.relative_path) continue;
        if (isForbiddenClipKey(cue.cue_key)) continue;
        clips[cue.cue_key] = cue.relative_path.startsWith('/')
          ? cue.relative_path
          : `/${cue.relative_path}`;
      }
      return res.json({ version: dbManifest.version || 1, clips });
    }

    res.json(dbManifest);
  } catch (err) {
    console.error('[coaching] voice/manifest error:', err);
    res.status(500).json({ error: 'Failed to fetch manifest' });
  }
});

/**
 * GET /api/coaching/voice/asset/:cueKey
 * Serve the WAV file for a given cue_key.
 * Looks up the relative_path from coaching_voice_assets.
 */
router.get('/voice/asset/:cueKey', async (req, res) => {
  const { cueKey } = req.params;

  try {
    const result = await query(
      'SELECT relative_path, mime_type FROM coaching_voice_assets WHERE cue_key = $1',
      [cueKey]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Voice asset not found' });
    }

    const { relative_path, mime_type } = result.rows[0];
    if (!relative_path) {
      return res.status(404).json({ error: 'Voice asset has no file path' });
    }

    const publicDir = path.join(__dirname, '..', '..', 'public');
    const absPath   = path.join(publicDir, relative_path);

    // Check file exists
    try {
      await fs.promises.access(absPath, fs.constants.F_OK);
    } catch {
      return res.status(404).json({ error: 'Voice asset file not found on disk' });
    }

    res.setHeader('Content-Type', mime_type || 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(absPath);
  } catch (err) {
    console.error('[coaching] voice/asset error:', err);
    res.status(500).json({ error: 'Failed to serve voice asset' });
  }
});

// ── Reference candidates ──────────────────────────────────────────────────────

/**
 * GET /api/coaching/reference/candidates?track_id=&car_id=&limit=
 * Return valid laps for a track/car combo, flagging any already set as active reference.
 */
router.get('/reference/candidates', async (req, res) => {
  const { track_id, car_id, limit = 20 } = req.query;

  if (!track_id || !car_id) {
    return res.status(400).json({ error: 'track_id and car_id are required' });
  }

  try {
    const userId = req.user.id;
    const safeLimit = Math.min(parseInt(limit, 10) || 20, 100);

    const result = await query(
      `SELECT
         l.id AS lap_id,
         l.session_id,
         l.lap_number,
         l.lap_time AS lap_time_s,
         l.is_valid,
         l.created_at,
         s.track_id,
         s.track_name,
         s.car_id,
         s.car_name,
         CASE WHEN crl.id IS NOT NULL THEN true ELSE false END AS is_active_reference
       FROM laps l
       JOIN sessions s ON s.id = l.session_id
       LEFT JOIN coaching_reference_laps crl
         ON crl.lap_id = l.id AND crl.is_active = true
       WHERE l.user_id = $1
         AND s.track_id = $2
         AND s.car_id   = $3
         AND COALESCE(l.is_valid, true) = true
         AND l.lap_time IS NOT NULL
       ORDER BY l.lap_time ASC, l.created_at DESC
       LIMIT $4`,
      [userId, track_id, car_id, safeLimit]
    );

    res.json({ track_id, car_id, laps: result.rows });
  } catch (err) {
    console.error('[coaching] reference/candidates error:', err);
    res.status(500).json({ error: 'Failed to fetch reference lap candidates' });
  }
});

module.exports = router;
