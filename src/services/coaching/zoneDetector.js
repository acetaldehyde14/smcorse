'use strict';

/**
 * zoneDetector.js
 * Pure function: takes resampled reference points and returns detected driving zones.
 * All logic is deterministic — no AI/LLM involved.
 */

const SEGMENT_TYPES = {
  BRAKE: 'brake',
  LIFT: 'lift',
  APEX: 'apex',
  THROTTLE_PICKUP: 'throttle_pickup',
  EXIT: 'exit',
};

const DISPLAY_TEXT = {
  brake: 'Brake here',
  lift: 'Small lift here',
  apex: 'Trail brake to apex',
  throttle_pickup: 'Wait for throttle',
  exit: 'Back to throttle',
};

const VOICE_KEY = {
  brake: 'reference_brake_now_at_the_marker',
  lift: 'reference_small_lift_before_turn_in',
  apex: 'reference_trail_brake_gently_into_apex',
  throttle_pickup: 'reference_wait_before_throttle_pickup',
  exit: 'reference_back_to_throttle_on_exit',
};

const CORRECTION_TEMPLATES = {
  brake: {
    brake_earlier: {
      display_template: 'Brake about {{meters}}m earlier',
      voice_key: null,
      sequence_template: ['correction_brake_{{meters}}m_earlier', 'there'],
    },
    brake_later: {
      display_template: 'Brake about {{meters}}m later',
      voice_key: null,
      sequence_template: ['correction_brake_{{meters}}m_later', 'there'],
    },
    more_brake: {
      display_template: 'Use about {{percent}}% more brake',
      voice_key: null,
      sequence_template: ['correction_add_about_{{percent}}_percent_more_brake_here', 'there'],
    },
    less_brake: {
      display_template: 'Use about {{percent}}% less brake',
      voice_key: null,
      sequence_template: ['correction_use_about_{{percent}}_percent_less_brake_here', 'there'],
    },
    release_earlier: {
      display_template: 'Release the brake earlier',
      voice_key: 'correction_release_the_brake_earlier_and_free_the_car',
    },
    release_slower: {
      display_template: 'Release the brake more slowly',
      voice_key: 'correction_release_the_brake_more_slowly',
    },
  },
  lift: {},
  apex: {
    release_earlier: {
      display_template: 'Release the brake earlier',
      voice_key: 'correction_release_the_brake_earlier_and_free_the_car',
    },
    release_slower: {
      display_template: 'Release the brake more slowly',
      voice_key: 'correction_release_the_brake_more_slowly',
    },
  },
  throttle_pickup: {
    earlier: {
      display_template: 'Get to throttle {{tenths}} tenths earlier',
      voice_key: 'correction_pick_up_throttle_a_touch_earlier',
    },
    later: {
      display_template: 'Wait {{tenths}} tenths longer before throttle',
      voice_key: 'correction_wait_longer_before_throttle_pickup',
    },
    more_patient: {
      display_template: 'More patient — wait for rotation',
      voice_key: 'correction_be_more_patient_wait_for_rotation',
    },
  },
  exit: {
    earlier: {
      display_template: 'Get to throttle {{tenths}} tenths earlier',
      voice_key: 'correction_pick_up_throttle_a_touch_earlier',
    },
  },
};

/**
 * Build a zone object with all standard fields.
 */
function buildZone(sequenceIndex, segmentType, lapDistStart, lapDistEnd, name) {
  return {
    zone_id: `zone_${sequenceIndex}_${segmentType}`,
    sequence_index: sequenceIndex,
    name,
    segment_type: segmentType,
    lap_dist_start: lapDistStart,
    lap_dist_callout: Math.max(0, lapDistStart - 0.005),
    lap_dist_end: lapDistEnd,
    generic_display_text: DISPLAY_TEXT[segmentType],
    generic_voice_key: VOICE_KEY[segmentType],
    correction_template_json: CORRECTION_TEMPLATES[segmentType] || {},
    priority: 0,
  };
}

/**
 * Generate a human-readable zone name based on sequence index and type.
 */
function zoneName(sequenceIndex, segmentType) {
  const turnNum = Math.ceil(sequenceIndex / 2);
  const typeLabel = {
    brake: 'Brake',
    lift: 'Lift',
    apex: 'Apex',
    throttle_pickup: 'Throttle Pickup',
    exit: 'Exit',
  }[segmentType] || segmentType;
  return `Turn ${turnNum} ${typeLabel}`;
}

/**
 * Merge zones that are the same type and closer than minGap lap_dist apart.
 */
function mergeCloseZones(zones, minGap = 0.005) {
  if (!zones.length) return zones;
  const merged = [zones[0]];
  for (let i = 1; i < zones.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = zones[i];
    if (curr.segment_type === prev.segment_type &&
        curr.lap_dist_start - prev.lap_dist_end < minGap) {
      // Extend previous zone
      prev.lap_dist_end = Math.max(prev.lap_dist_end, curr.lap_dist_end);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * detectZones(points)
 *
 * State-machine scan through 500 resampled reference points.
 * Returns an array of zone objects (capped at 40).
 *
 * @param {Array} points - Resampled reference points with lap_dist_pct, throttle_pct, brake_pct, speed_kph
 * @returns {Array} zones
 */
function detectZones(points) {
  if (!points || points.length < 10) return [];

  const zones = [];
  const total = points.length;

  // Smoothed values to reduce noise
  function smooth(arr, key, window = 3) {
    return arr.map((p, i) => {
      const start = Math.max(0, i - window);
      const end = Math.min(arr.length - 1, i + window);
      let sum = 0, count = 0;
      for (let j = start; j <= end; j++) {
        const v = arr[j][key];
        if (v != null) { sum += v; count++; }
      }
      return count > 0 ? sum / count : (p[key] || 0);
    });
  }

  const smoothThrottle = smooth(points, 'throttle_pct', 2);
  const smoothBrake = smooth(points, 'brake_pct', 2);
  const smoothSpeed = smooth(points, 'speed_kph', 3);

  // Minimum lap_dist_pct span for a zone to be considered valid
  const MIN_BRAKE_SPAN = 0.005;  // 0.5%
  const MIN_LIFT_SPAN  = 0.005;
  const MIN_APEX_SPAN  = 0.003;
  const MIN_TP_SPAN    = 0.005;
  const MIN_EXIT_SPAN  = 0.005;

  // Track last high-throttle position for "at least 1% gap before next brake zone"
  let lastHighThrottleIdx = -1;
  let lastHighThrottleEndIdx = -1;

  // State machine
  const STATE = {
    FREE: 'FREE',
    LIFT: 'LIFT',
    BRAKE: 'BRAKE',
    APEX: 'APEX',
    THROTTLE_PICKUP: 'THROTTLE_PICKUP',
    EXIT: 'EXIT',
  };

  let state = STATE.FREE;

  // Zone start/end tracking
  let zoneStartIdx = -1;
  let brakeWasActive = false;
  let apexCandidateIdx = -1;

  // Pending zones before sequence renumbering
  const rawZones = [];

  for (let i = 0; i < total; i++) {
    const t = smoothThrottle[i];
    const b = smoothBrake[i];
    const s = smoothSpeed[i];
    const distPct = points[i].lap_dist_pct;

    switch (state) {
      case STATE.FREE: {
        // Track when we have full throttle for gap detection
        if (t > 80) {
          lastHighThrottleEndIdx = i;
          if (lastHighThrottleIdx < 0) lastHighThrottleIdx = i;
        } else {
          if (lastHighThrottleIdx >= 0) {
            lastHighThrottleIdx = -1;
          }
        }

        // Detect lift: throttle drops >15% without significant brake
        if (t < 70 && b < 5) {
          // Check previous points were high throttle
          const prevT = i > 2 ? smoothThrottle[i - 3] : 100;
          if (prevT - t > 15) {
            state = STATE.LIFT;
            zoneStartIdx = i;
            brakeWasActive = false;
          }
        }

        // Detect brake: brake > 5 after at least 1% gap from last high throttle
        if (b > 5) {
          const gapSatisfied = lastHighThrottleEndIdx < 0 ||
            (points[i].lap_dist_pct - points[Math.max(0, lastHighThrottleEndIdx)].lap_dist_pct) > -0.02;
          if (gapSatisfied) {
            state = STATE.BRAKE;
            zoneStartIdx = i;
            brakeWasActive = true;
          }
        }
        break;
      }

      case STATE.LIFT: {
        // If brake kicks in, transition to BRAKE
        if (b > 5) {
          // Check if lift zone was long enough
          const span = distPct - points[zoneStartIdx].lap_dist_pct;
          if (span >= MIN_LIFT_SPAN) {
            rawZones.push({
              segment_type: SEGMENT_TYPES.LIFT,
              lap_dist_start: points[zoneStartIdx].lap_dist_pct,
              lap_dist_end: distPct,
            });
          }
          state = STATE.BRAKE;
          zoneStartIdx = i;
          brakeWasActive = true;
        } else if (t > 70) {
          // Throttle recovered — was a brief lift, check span
          const span = distPct - points[zoneStartIdx].lap_dist_pct;
          if (span >= MIN_LIFT_SPAN) {
            rawZones.push({
              segment_type: SEGMENT_TYPES.LIFT,
              lap_dist_start: points[zoneStartIdx].lap_dist_pct,
              lap_dist_end: distPct,
            });
          }
          state = STATE.FREE;
          lastHighThrottleIdx = i;
          lastHighThrottleEndIdx = i;
        }
        break;
      }

      case STATE.BRAKE: {
        // Record brake zone once brake releases
        if (b < 3 && brakeWasActive) {
          const span = distPct - points[zoneStartIdx].lap_dist_pct;
          if (span >= MIN_BRAKE_SPAN) {
            rawZones.push({
              segment_type: SEGMENT_TYPES.BRAKE,
              lap_dist_start: points[zoneStartIdx].lap_dist_pct,
              lap_dist_end: distPct,
            });
          }
          // Transition to APEX scan
          state = STATE.APEX;
          apexCandidateIdx = i;
          brakeWasActive = false;
        }
        break;
      }

      case STATE.APEX: {
        // Look for local speed minimum
        const prevS = i > 1 ? smoothSpeed[i - 1] : s;
        const nextS = i < total - 1 ? smoothSpeed[i + 1] : s;

        if (s <= prevS && s <= nextS) {
          // Speed minimum — mark as apex candidate
          apexCandidateIdx = i;
        }

        // Throttle recovering (>10%) signals end of apex, start throttle pickup
        if (t > 10 && apexCandidateIdx >= 0) {
          const apexDist = points[apexCandidateIdx].lap_dist_pct;
          const endDist = distPct;
          const span = endDist - apexDist;
          if (span >= MIN_APEX_SPAN) {
            rawZones.push({
              segment_type: SEGMENT_TYPES.APEX,
              lap_dist_start: apexDist,
              lap_dist_end: endDist,
            });
          }
          state = STATE.THROTTLE_PICKUP;
          zoneStartIdx = i;
        }
        // If no apex found after significant distance, go back to FREE
        else if (distPct - points[apexCandidateIdx >= 0 ? apexCandidateIdx : i].lap_dist_pct > 0.05) {
          state = STATE.FREE;
        }
        break;
      }

      case STATE.THROTTLE_PICKUP: {
        // Throttle pickup zone — ends when throttle is sustained above 60%
        if (t > 60) {
          // Check sustained for at least MIN_TP_SPAN
          const span = distPct - points[zoneStartIdx].lap_dist_pct;
          if (span >= MIN_TP_SPAN) {
            rawZones.push({
              segment_type: SEGMENT_TYPES.THROTTLE_PICKUP,
              lap_dist_start: points[zoneStartIdx].lap_dist_pct,
              lap_dist_end: distPct,
            });
            // Transition to EXIT
            state = STATE.EXIT;
            zoneStartIdx = i;
          }
        }
        // If throttle dropped back below 5, something went wrong — reset
        if (t < 5 && distPct - points[zoneStartIdx].lap_dist_pct > 0.02) {
          state = STATE.FREE;
        }
        break;
      }

      case STATE.EXIT: {
        // Exit zone — ends when throttle returns to full (>90%) for sustained distance
        if (t > 90) {
          const span = distPct - points[zoneStartIdx].lap_dist_pct;
          if (span >= MIN_EXIT_SPAN) {
            rawZones.push({
              segment_type: SEGMENT_TYPES.EXIT,
              lap_dist_start: points[zoneStartIdx].lap_dist_pct,
              lap_dist_end: distPct,
            });
          }
          state = STATE.FREE;
          lastHighThrottleIdx = i;
          lastHighThrottleEndIdx = i;
        }
        // If still not full throttle after long time, still close out
        if (distPct - points[zoneStartIdx].lap_dist_pct > 0.15) {
          rawZones.push({
            segment_type: SEGMENT_TYPES.EXIT,
            lap_dist_start: points[zoneStartIdx].lap_dist_pct,
            lap_dist_end: distPct,
          });
          state = STATE.FREE;
          lastHighThrottleIdx = i;
          lastHighThrottleEndIdx = i;
        }
        break;
      }
    }
  }

  // Close any open zones at lap end
  if (state === STATE.BRAKE && zoneStartIdx >= 0) {
    rawZones.push({
      segment_type: SEGMENT_TYPES.BRAKE,
      lap_dist_start: points[zoneStartIdx].lap_dist_pct,
      lap_dist_end: points[total - 1].lap_dist_pct,
    });
  }

  // Merge closely spaced zones of the same type
  const merged = mergeCloseZones(rawZones, 0.005);

  // Sort by lap_dist_start
  merged.sort((a, b) => a.lap_dist_start - b.lap_dist_start);

  // Cap at 40 zones
  const capped = merged.slice(0, 40);

  // Assign sequence indices and build final zone objects
  return capped.map((z, i) => ({
    ...buildZone(i + 1, z.segment_type, z.lap_dist_start, z.lap_dist_end,
      zoneName(i + 1, z.segment_type)),
  }));
}

module.exports = { detectZones };
