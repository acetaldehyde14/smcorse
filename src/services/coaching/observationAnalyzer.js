'use strict';

/**
 * observationAnalyzer.js
 * Deterministic analysis of zone observations vs. reference targets.
 * Produces delta values and recommendation keys — no LLM involved.
 */

const { query } = require('../../config/database');

// Default track length in metres when unknown
const DEFAULT_TRACK_LENGTH_M = 5000;

/**
 * analyzeObservation
 *
 * Compares observed zone metrics against the reference zone targets
 * and returns delta fields plus a recommendation key.
 *
 * @param {object} observation  - Observed metrics (observed_* fields)
 * @param {object} referenceZone - Zone row from coaching_zones (target_* fields)
 * @param {number} [trackLengthM=5000] - Track length in metres
 * @returns {object} delta fields + recommendation_key + recommendation_payload
 */
function analyzeObservation(observation, referenceZone, trackLengthM = DEFAULT_TRACK_LENGTH_M) {
  const deltas = {};

  // Delta: brake start position in metres
  // Positive = braked later than reference (need to brake earlier)
  // Negative = braked earlier than reference
  if (observation.observed_brake_start_lap_dist != null && referenceZone.lap_dist_callout != null) {
    deltas.delta_brake_start_m =
      (observation.observed_brake_start_lap_dist - referenceZone.lap_dist_callout) * trackLengthM;
  } else {
    deltas.delta_brake_start_m = null;
  }

  // Delta: peak brake pressure
  if (observation.observed_brake_peak_pct != null && referenceZone.target_brake_peak_pct != null) {
    deltas.delta_peak_brake_pct =
      observation.observed_brake_peak_pct - referenceZone.target_brake_peak_pct;
  } else {
    deltas.delta_peak_brake_pct = null;
  }

  // Delta: throttle reapply timing (in seconds via duration proxy)
  // We use observed_duration_s vs target_duration_s as a proxy
  if (observation.observed_duration_s != null && referenceZone.target_duration_s != null) {
    deltas.delta_throttle_reapply_s =
      observation.observed_duration_s - referenceZone.target_duration_s;
  } else {
    deltas.delta_throttle_reapply_s = null;
  }

  // Delta: minimum speed through zone
  if (observation.observed_min_speed_kph != null && referenceZone.target_min_speed_kph != null) {
    deltas.delta_min_speed_kph =
      observation.observed_min_speed_kph - referenceZone.target_min_speed_kph;
  } else {
    deltas.delta_min_speed_kph = null;
  }

  // Delta: entry speed
  if (observation.observed_entry_speed_kph != null && referenceZone.target_entry_speed_kph != null) {
    deltas.delta_entry_speed_kph =
      observation.observed_entry_speed_kph - referenceZone.target_entry_speed_kph;
  } else {
    deltas.delta_entry_speed_kph = null;
  }

  // Pick recommendation based on largest deviation
  let recommendation_key = null;
  let recommendation_payload = {};
  let maxScore = 0;

  function consider(key, score, payload) {
    if (Math.abs(score) > maxScore) {
      maxScore = Math.abs(score);
      recommendation_key = key;
      recommendation_payload = payload;
    }
  }

  // Brake start: positive delta_brake_start_m means braked later (need to brake earlier)
  if (deltas.delta_brake_start_m != null) {
    if (deltas.delta_brake_start_m > 10) {
      consider('brake_earlier', deltas.delta_brake_start_m, {
        meters: Math.round(deltas.delta_brake_start_m),
      });
    } else if (deltas.delta_brake_start_m < -10) {
      consider('brake_later', -deltas.delta_brake_start_m, {
        meters: Math.round(-deltas.delta_brake_start_m),
      });
    }
  }

  // Peak brake pressure
  if (deltas.delta_peak_brake_pct != null) {
    if (deltas.delta_peak_brake_pct < -15) {
      consider('more_brake', -deltas.delta_peak_brake_pct, {
        percent: Math.round(-deltas.delta_peak_brake_pct),
      });
    } else if (deltas.delta_peak_brake_pct > 15) {
      consider('less_brake', deltas.delta_peak_brake_pct, {
        percent: Math.round(deltas.delta_peak_brake_pct),
      });
    }
  }

  // Minimum speed: negative delta means too slow
  if (deltas.delta_min_speed_kph != null) {
    if (deltas.delta_min_speed_kph < -3) {
      consider('minimum_speed_can_be_higher_here', -deltas.delta_min_speed_kph, {
        kph: Math.round(-deltas.delta_min_speed_kph),
      });
    }
  }

  // Throttle reapply: positive delta means took longer (pick up earlier)
  if (deltas.delta_throttle_reapply_s != null) {
    if (deltas.delta_throttle_reapply_s > 0.15) {
      consider('pick_up_throttle_earlier', deltas.delta_throttle_reapply_s * 10, {
        tenths: Math.round(deltas.delta_throttle_reapply_s * 10),
      });
    }
  }

  return {
    ...deltas,
    recommendation_key,
    recommendation_payload: Object.keys(recommendation_payload).length
      ? recommendation_payload
      : null,
  };
}

/**
 * buildLapSummary
 *
 * Loads all zone observations for a session+lap and produces a structured
 * summary identifying the biggest improvement opportunities.
 *
 * @param {number} sessionId
 * @param {number} lapNumber
 * @param {object} [db] - optional pg client; falls back to pool query
 * @returns {object} Summary object
 */
async function buildLapSummary(sessionId, lapNumber, db) {
  const dbQuery = db
    ? (sql, params) => db.query(sql, params)
    : query;

  const result = await dbQuery(
    `SELECT zone_id, recommendation_key, recommendation_payload,
            delta_brake_start_m, delta_peak_brake_pct,
            delta_throttle_reapply_s, delta_min_speed_kph, delta_entry_speed_kph
     FROM coaching_zone_observations
     WHERE session_id = $1 AND lap_number = $2
     ORDER BY created_at ASC`,
    [sessionId, lapNumber]
  );

  const observations = result.rows;

  if (!observations.length) {
    return {
      session_id: sessionId,
      lap_number: lapNumber,
      biggest_braking_opportunity: null,
      biggest_throttle_opportunity: null,
      biggest_speed_opportunity: null,
      top_zones_to_improve: [],
      summary_cue_keys: ['summary_good_lap_minimal_corrections_needed'],
    };
  }

  // Score each zone observation
  const scored = observations.map(obs => {
    const brakeScore = Math.abs(obs.delta_brake_start_m ?? 0);
    const throttleScore = Math.abs(obs.delta_throttle_reapply_s ?? 0) * 10; // convert to same magnitude
    const speedScore = Math.abs(obs.delta_min_speed_kph ?? 0);
    const totalScore = brakeScore * 0.4 + throttleScore * 0.3 + speedScore * 0.3;

    return {
      zone_id: obs.zone_id,
      recommendation_key: obs.recommendation_key,
      recommendation_payload: obs.recommendation_payload,
      delta_brake_start_m: obs.delta_brake_start_m,
      delta_throttle_reapply_s: obs.delta_throttle_reapply_s,
      delta_min_speed_kph: obs.delta_min_speed_kph,
      brakeScore,
      throttleScore,
      speedScore,
      totalScore,
    };
  });

  // Sort by total score descending
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // Biggest braking opportunity
  const brakeObs = [...scored].sort((a, b) => b.brakeScore - a.brakeScore)[0];
  const biggest_braking_opportunity = brakeObs && brakeObs.brakeScore > 0 ? {
    zone_id: brakeObs.zone_id,
    delta_m: brakeObs.delta_brake_start_m,
    recommendation_key: brakeObs.recommendation_key || 'brake_earlier',
  } : null;

  // Biggest throttle opportunity
  const throttleObs = [...scored].sort((a, b) => b.throttleScore - a.throttleScore)[0];
  const biggest_throttle_opportunity = throttleObs && throttleObs.throttleScore > 0 ? {
    zone_id: throttleObs.zone_id,
    delta_s: throttleObs.delta_throttle_reapply_s,
    recommendation_key: throttleObs.recommendation_key || 'pick_up_throttle_earlier',
  } : null;

  // Biggest speed opportunity
  const speedObs = [...scored].sort((a, b) => b.speedScore - a.speedScore)[0];
  const biggest_speed_opportunity = speedObs && speedObs.speedScore > 0 ? {
    zone_id: speedObs.zone_id,
    delta_kph: speedObs.delta_min_speed_kph,
  } : null;

  // Top 3 zones to improve
  const top_zones_to_improve = scored.slice(0, 3).map(obs => ({
    zone_id: obs.zone_id,
    score: Math.round(obs.totalScore * 10) / 10,
    issues: [
      obs.delta_brake_start_m && Math.abs(obs.delta_brake_start_m) > 5
        ? `brake_point_${obs.delta_brake_start_m > 0 ? 'late' : 'early'}`
        : null,
      obs.delta_min_speed_kph && obs.delta_min_speed_kph < -2
        ? 'speed_loss'
        : null,
      obs.delta_throttle_reapply_s && obs.delta_throttle_reapply_s > 0.1
        ? 'throttle_late'
        : null,
    ].filter(Boolean),
  }));

  // Determine summary cue keys
  const summary_cue_keys = [];
  if (biggest_braking_opportunity) {
    summary_cue_keys.push('summary_biggest_time_loss_was_under_braking');
  } else if (biggest_throttle_opportunity) {
    summary_cue_keys.push('summary_biggest_time_loss_was_on_throttle_application');
  } else if (biggest_speed_opportunity) {
    summary_cue_keys.push('summary_biggest_time_loss_was_minimum_speed_through_corners');
  } else {
    summary_cue_keys.push('summary_good_lap_minimal_corrections_needed');
  }

  return {
    session_id: sessionId,
    lap_number: lapNumber,
    biggest_braking_opportunity,
    biggest_throttle_opportunity,
    biggest_speed_opportunity,
    top_zones_to_improve,
    summary_cue_keys,
  };
}

module.exports = { analyzeObservation, buildLapSummary };
