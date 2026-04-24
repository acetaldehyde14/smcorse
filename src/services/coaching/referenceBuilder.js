'use strict';

/**
 * referenceBuilder.js
 * Builds coaching_reference_points and coaching_zones from telemetry_frames
 * for a given lap and reference lap record.
 */

const { query, transaction } = require('../../config/database');
const { detectZones } = require('./zoneDetector');

const RESAMPLE_COUNT = 500;
const RESAMPLE_SPACING = 1.0 / RESAMPLE_COUNT; // 0.002

/**
 * Linear interpolation between two values.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Interpolate a numeric field between two frame objects at a fractional position.
 */
function interpolateField(frameA, frameB, t, field) {
  const a = frameA[field];
  const b = frameB[field];
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return lerp(Number(a), Number(b), t);
}

/**
 * Resample raw telemetry frames to evenly-spaced lap_dist_pct points.
 * Input frames must be sorted by lap_dist_pct ascending.
 *
 * @param {Array} frames - Raw DB rows from telemetry_frames
 * @returns {Array} - 500 resampled point objects
 */
function resampleFrames(frames) {
  if (!frames || frames.length === 0) return [];

  // Normalize speed from m/s -> kph, throttle/brake from [0,1] -> [0,100]
  const normalized = frames.map(f => ({
    lap_dist_pct:  Number(f.lap_dist_pct),
    session_time_s: f.session_time != null ? Number(f.session_time) : null,
    speed_kph:     f.speed_ms != null ? Number(f.speed_ms) * 3.6 : null,
    throttle_pct:  f.throttle  != null ? Number(f.throttle) * 100 : null,
    brake_pct:     f.brake     != null ? Number(f.brake)    * 100 : null,
    gear:          f.gear      != null ? Number(f.gear)          : null,
    rpm:           f.rpm       != null ? Number(f.rpm)           : null,
    lat_accel:     f.lat_accel != null ? Number(f.lat_accel)     : null,
    long_accel:    f.long_accel!= null ? Number(f.long_accel)    : null,
    yaw_rate:      f.yaw_rate  != null ? Number(f.yaw_rate)      : null,
  }));

  // Clamp dist values to [0, 1]
  for (const p of normalized) {
    p.lap_dist_pct = Math.max(0, Math.min(1, p.lap_dist_pct));
  }

  // Sort ascending
  normalized.sort((a, b) => a.lap_dist_pct - b.lap_dist_pct);

  const FIELDS = [
    'session_time_s', 'speed_kph', 'throttle_pct', 'brake_pct',
    'gear', 'rpm', 'lat_accel', 'long_accel', 'yaw_rate',
  ];

  const resampled = [];

  for (let i = 0; i < RESAMPLE_COUNT; i++) {
    const targetDist = i * RESAMPLE_SPACING;

    // Find surrounding frames
    let lo = 0, hi = normalized.length - 1;

    // Binary search for the segment containing targetDist
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (normalized[mid].lap_dist_pct <= targetDist) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // If targetDist is before all frames, use first
    if (targetDist <= normalized[0].lap_dist_pct) {
      resampled.push({ point_index: i, lap_dist_pct: targetDist, ...normalized[0] });
      continue;
    }

    // If targetDist is after all frames, use last
    if (targetDist >= normalized[normalized.length - 1].lap_dist_pct) {
      resampled.push({ point_index: i, lap_dist_pct: targetDist, ...normalized[normalized.length - 1] });
      continue;
    }

    const frameA = normalized[lo];
    const frameB = normalized[hi];

    const range = frameB.lap_dist_pct - frameA.lap_dist_pct;
    const t = range > 0 ? (targetDist - frameA.lap_dist_pct) / range : 0;

    const point = { point_index: i, lap_dist_pct: targetDist };
    for (const field of FIELDS) {
      point[field] = interpolateField(frameA, frameB, t, field);
    }

    resampled.push(point);
  }

  return resampled;
}

/**
 * Find the resampled point closest to a given lap_dist_pct.
 */
function findPointAtDist(points, dist) {
  let best = points[0];
  let bestDiff = Math.abs(points[0].lap_dist_pct - dist);
  for (const p of points) {
    const diff = Math.abs(p.lap_dist_pct - dist);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best;
}

/**
 * Get all points within a lap dist range.
 */
function pointsInRange(points, start, end) {
  return points.filter(p => p.lap_dist_pct >= start && p.lap_dist_pct <= end);
}

/**
 * Compute target metrics for a zone from reference points.
 */
function computeZoneTargets(zone, points) {
  const zonePoints = pointsInRange(points, zone.lap_dist_start, zone.lap_dist_end);
  if (!zonePoints.length) return {};

  const startPoint = findPointAtDist(points, zone.lap_dist_start);
  const endPoint   = findPointAtDist(points, zone.lap_dist_end);

  const speeds     = zonePoints.map(p => p.speed_kph).filter(v => v != null);
  const brakes     = zonePoints.map(p => p.brake_pct).filter(v => v != null);
  const throttles  = zonePoints.map(p => p.throttle_pct).filter(v => v != null);

  const target_entry_speed_kph = startPoint.speed_kph;
  const target_exit_speed_kph  = endPoint.speed_kph;
  const target_min_speed_kph   = speeds.length ? Math.min(...speeds) : null;
  const target_brake_peak_pct  = brakes.length ? Math.max(...brakes) : null;
  const target_throttle_min_pct = throttles.length ? Math.min(...throttles) : null;

  // Find brake release point: where brake drops below 5% after peak
  let target_brake_release_pct = null;
  let peakBrakeIdx = -1;
  let peakBrake = -1;
  for (let i = 0; i < zonePoints.length; i++) {
    const b = zonePoints[i].brake_pct;
    if (b != null && b > peakBrake) { peakBrake = b; peakBrakeIdx = i; }
  }
  if (peakBrakeIdx >= 0) {
    for (let i = peakBrakeIdx; i < zonePoints.length; i++) {
      const b = zonePoints[i].brake_pct;
      if (b != null && b < 5) {
        target_brake_release_pct = zonePoints[i].lap_dist_pct;
        break;
      }
    }
  }

  // Find throttle reapply: where throttle first rises above 10% sustainably after zone midpoint
  const midDist = (zone.lap_dist_start + zone.lap_dist_end) / 2;
  let target_throttle_reapply_pct = null;
  let inThrottle = false;
  let throttleStartIdx = -1;
  for (let i = 0; i < zonePoints.length; i++) {
    const p = zonePoints[i];
    if (p.lap_dist_pct < midDist) continue;
    const th = p.throttle_pct;
    if (th != null && th > 10 && !inThrottle) {
      inThrottle = true;
      throttleStartIdx = i;
    } else if (th != null && th <= 5) {
      inThrottle = false;
      throttleStartIdx = -1;
    }
    // Sustained for at least 3 points
    if (inThrottle && throttleStartIdx >= 0 && i - throttleStartIdx >= 2) {
      target_throttle_reapply_pct = zonePoints[throttleStartIdx].lap_dist_pct;
      break;
    }
  }

  // Gear at minimum speed
  const minSpeedPoint = zonePoints.reduce((best, p) => {
    if (p.speed_kph == null) return best;
    if (!best || p.speed_kph < best.speed_kph) return p;
    return best;
  }, null);
  const target_gear = minSpeedPoint?.gear != null ? Math.round(minSpeedPoint.gear) : null;

  // Duration from session_time
  const startTime = startPoint.session_time_s;
  const endTime   = endPoint.session_time_s;
  const target_duration_s = (startTime != null && endTime != null)
    ? Math.abs(endTime - startTime)
    : null;

  return {
    target_entry_speed_kph,
    target_exit_speed_kph,
    target_min_speed_kph,
    target_brake_peak_pct,
    target_brake_release_pct,
    target_throttle_reapply_pct,
    target_throttle_min_pct,
    target_gear,
    target_duration_s,
  };
}

/**
 * buildReferenceForLap
 *
 * Main entry point. Given a coaching_reference_laps.id and a laps.id,
 * loads telemetry frames, resamples, detects zones and writes everything to DB.
 *
 * @param {number} referenceId - coaching_reference_laps.id
 * @param {number} lapId       - laps.id to load telemetry from
 * @param {object} [db]        - optional pg client (for transactions); falls back to pool query
 * @returns {{ pointsInserted: number, zonesInserted: number }}
 */
async function buildReferenceForLap(referenceId, lapId, db) {
  const dbQuery = db
    ? (sql, params) => db.query(sql, params)
    : query;

  // 1. Load telemetry frames
  const framesResult = await dbQuery(
    `SELECT lap_dist_pct, session_time, speed_ms, throttle, brake, gear, rpm,
            lat_accel, long_accel, yaw_rate
     FROM telemetry_frames
     WHERE lap_id = $1
     ORDER BY lap_dist_pct ASC`,
    [lapId]
  );

  const frames = framesResult.rows;

  if (!frames.length) {
    console.warn(`[referenceBuilder] No telemetry frames found for lap_id=${lapId}`);
    return { pointsInserted: 0, zonesInserted: 0 };
  }

  // 2. Resample to 500 evenly-spaced points
  const points = resampleFrames(frames);

  // 3. Delete existing reference points for this reference
  await dbQuery(
    'DELETE FROM coaching_reference_points WHERE reference_lap_id = $1',
    [referenceId]
  );

  // 4. Bulk insert reference points
  const pointValues = [];
  const pointParams = [];
  let pIdx = 1;
  for (const p of points) {
    pointValues.push(`($${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++})`);
    pointParams.push(
      referenceId,
      p.point_index,
      p.lap_dist_pct,
      p.session_time_s,
      p.speed_kph,
      p.throttle_pct,
      p.brake_pct,
      p.gear,
      p.rpm,
      p.lat_accel,
      p.long_accel,
      p.yaw_rate,
      null  // curvature — not in telemetry_frames currently
    );
  }

  if (pointValues.length > 0) {
    await dbQuery(
      `INSERT INTO coaching_reference_points
         (reference_lap_id, point_index, lap_dist_pct, session_time_s, speed_kph,
          throttle_pct, brake_pct, gear, rpm, lat_accel, long_accel, yaw_rate, curvature)
       VALUES ${pointValues.join(',')}`,
      pointParams
    );
  }

  // 5. Detect zones from resampled points
  const rawZones = detectZones(points);

  // 6. Delete existing zones for this reference
  await dbQuery(
    'DELETE FROM coaching_zones WHERE reference_lap_id = $1',
    [referenceId]
  );

  // 7. Compute target metrics and bulk insert zones
  let zonesInserted = 0;
  for (const zone of rawZones) {
    const targets = computeZoneTargets(zone, points);

    await dbQuery(
      `INSERT INTO coaching_zones
         (reference_lap_id, zone_id, sequence_index, name, segment_type,
          lap_dist_start, lap_dist_callout, lap_dist_end,
          target_entry_speed_kph, target_min_speed_kph, target_exit_speed_kph,
          target_brake_initial_pct, target_brake_peak_pct, target_brake_release_pct,
          target_throttle_min_pct, target_throttle_reapply_pct,
          target_gear, target_duration_s,
          priority, generic_display_text, generic_voice_key,
          correction_template_json, updated_at)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())`,
      [
        referenceId,
        zone.zone_id,
        zone.sequence_index,
        zone.name,
        zone.segment_type,
        zone.lap_dist_start,
        zone.lap_dist_callout,
        zone.lap_dist_end,
        targets.target_entry_speed_kph  ?? null,
        targets.target_min_speed_kph    ?? null,
        targets.target_exit_speed_kph   ?? null,
        null,  // target_brake_initial_pct (no clear source)
        targets.target_brake_peak_pct   ?? null,
        targets.target_brake_release_pct ?? null,
        targets.target_throttle_min_pct ?? null,
        targets.target_throttle_reapply_pct ?? null,
        targets.target_gear             ?? null,
        targets.target_duration_s       ?? null,
        zone.priority,
        zone.generic_display_text,
        zone.generic_voice_key,
        JSON.stringify(zone.correction_template_json),
      ]
    );
    zonesInserted++;
  }

  // 8. Update updated_at on reference lap
  await dbQuery(
    'UPDATE coaching_reference_laps SET updated_at = NOW() WHERE id = $1',
    [referenceId]
  );

  console.log(`[referenceBuilder] Built reference ${referenceId}: ${points.length} points, ${zonesInserted} zones`);

  return { pointsInserted: points.length, zonesInserted };
}

module.exports = { buildReferenceForLap };
