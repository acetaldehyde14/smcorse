'use strict';

/**
 * voiceCueCatalog.js
 * Complete catalog of all coaching voice cues.
 * Reference cues play during laps at zone entry.
 * Correction cues play when a deviation from reference is detected.
 * Summary cues play at lap end.
 */

// ── Base catalog (non-parameterized cues) ─────────────────────────────────────

const BASE_CUES = [
  // ── Reference cues ──────────────────────────────────────────────────────────
  {
    cue_key: 'reference_brake_now_at_the_marker',
    default_text: 'Brake now at the marker.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_small_lift_before_turn_in',
    default_text: 'Small lift before turn-in.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['lift', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_trail_brake_gently_into_apex',
    default_text: 'Trail brake gently into apex.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['apex', 'trail_brake', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_wait_before_throttle_pickup',
    default_text: 'Wait before picking up the throttle.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_back_to_throttle_on_exit',
    default_text: 'Back to throttle on exit.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'exit', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },

  // Additional reference cues
  {
    cue_key: 'reference_brake_firmly_here',
    default_text: 'Brake firmly here.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_light_brake_here',
    default_text: 'Light brake here.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_longer_lift_into_corner',
    default_text: 'Longer lift into the corner.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['lift', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_hold_partial_throttle_here',
    default_text: 'Hold partial throttle here.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_begin_to_feed_in_throttle',
    default_text: 'Begin to feed in the throttle.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'reference_stay_flat_here_if_stable',
    default_text: 'Stay flat here if the car is stable.',
    category: 'reference',
    priority: 1,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'flat', 'reference'],
    is_parameterized: false,
    param_slots: [],
  },

  // ── Correction cues (non-parameterized) ─────────────────────────────────────
  {
    cue_key: 'correction_release_the_brake_earlier_and_free_the_car',
    default_text: 'Release the brake earlier and free the car.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'release', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_release_the_brake_more_slowly',
    default_text: 'Release the brake more slowly.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'release', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_pick_up_throttle_a_touch_earlier',
    default_text: 'Pick up the throttle a touch earlier.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_wait_longer_before_throttle_pickup',
    default_text: 'Wait a bit longer before picking up the throttle.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_be_more_patient_wait_for_rotation',
    default_text: 'Be more patient — wait for the car to rotate.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['throttle', 'rotation', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_minimum_speed_can_be_higher_here',
    default_text: 'Your minimum speed can be higher here.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['speed', 'apex', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_brake_a_little_earlier_here',
    default_text: 'Brake a little earlier here.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_brake_a_lot_earlier_here',
    default_text: 'Brake a lot earlier here.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_use_more_initial_brake_pressure',
    default_text: 'Use more initial brake pressure.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['brake', 'pressure', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'correction_carry_about_5_kph_more_minimum_speed',
    default_text: 'Carry about 5 kilometres per hour more minimum speed.',
    category: 'correction',
    priority: 2,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['speed', 'correction'],
    is_parameterized: false,
    param_slots: [],
  },

  // ── Summary cues ─────────────────────────────────────────────────────────────
  {
    cue_key: 'summary_biggest_time_loss_was_under_braking',
    default_text: 'Your biggest time loss this lap was under braking.',
    category: 'summary',
    priority: 3,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['summary', 'brake'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'summary_biggest_time_loss_was_on_throttle_application',
    default_text: 'Your biggest time loss this lap was on throttle application.',
    category: 'summary',
    priority: 3,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['summary', 'throttle'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'summary_biggest_time_loss_was_minimum_speed_through_corners',
    default_text: 'Your biggest time loss this lap was minimum speed through corners.',
    category: 'summary',
    priority: 3,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['summary', 'speed'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'summary_good_lap_minimal_corrections_needed',
    default_text: 'Good lap — minimal corrections needed.',
    category: 'summary',
    priority: 3,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['summary', 'positive'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'summary_focus_on_corner_entry_this_stint',
    default_text: 'Focus on corner entry this stint.',
    category: 'summary',
    priority: 3,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['summary', 'entry'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'summary_focus_on_throttle_pickup_this_stint',
    default_text: 'Focus on throttle pickup this stint.',
    category: 'summary',
    priority: 3,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['summary', 'throttle'],
    is_parameterized: false,
    param_slots: [],
  },
  {
    cue_key: 'summary_best_gain_is_on_corner_exit',
    default_text: 'Your best gain this lap is on corner exit.',
    category: 'summary',
    priority: 3,
    language_code: 'en-US',
    suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
    tags: ['summary', 'exit', 'throttle'],
    is_parameterized: false,
    param_slots: [],
  },
];

// ── Parameterized cue template definitions ────────────────────────────────────

const PARAM_TEMPLATES = [
  // Brake earlier/later — meters
  {
    keyTemplate: 'correction_brake_about_{meters}_meters_earlier_here',
    textTemplate: 'Brake about {meters} metres earlier here.',
    category: 'correction',
    priority: 2,
    tags: ['brake', 'correction', 'meters'],
    param_slots: ['meters'],
    values: { meters: [5, 10, 15, 20, 25, 30] },
  },
  {
    keyTemplate: 'correction_brake_about_{meters}_meters_later_here',
    textTemplate: 'Brake about {meters} metres later here.',
    category: 'correction',
    priority: 2,
    tags: ['brake', 'correction', 'meters'],
    param_slots: ['meters'],
    values: { meters: [5, 10, 15, 20, 25, 30] },
  },
  // More/less brake — percent
  {
    keyTemplate: 'correction_add_about_{percent}_percent_more_brake_here',
    textTemplate: 'Add about {percent} percent more brake here.',
    category: 'correction',
    priority: 2,
    tags: ['brake', 'correction', 'percent'],
    param_slots: ['percent'],
    values: { percent: [5, 10, 15, 20] },
  },
  {
    keyTemplate: 'correction_use_about_{percent}_percent_less_brake_here',
    textTemplate: 'Use about {percent} percent less brake here.',
    category: 'correction',
    priority: 2,
    tags: ['brake', 'correction', 'percent'],
    param_slots: ['percent'],
    values: { percent: [5, 10, 15, 20] },
  },
  // Throttle pickup — tenths
  {
    keyTemplate: 'correction_pick_up_throttle_{tenths}_tenths_earlier',
    textTemplate: 'Pick up throttle {tenths} tenths earlier.',
    category: 'correction',
    priority: 2,
    tags: ['throttle', 'correction', 'tenths'],
    param_slots: ['tenths'],
    values: { tenths: [1, 2, 3] },
  },
  {
    keyTemplate: 'correction_wait_{tenths}_tenths_longer_before_throttle',
    textTemplate: 'Wait {tenths} tenths longer before throttle.',
    category: 'correction',
    priority: 2,
    tags: ['throttle', 'correction', 'tenths'],
    param_slots: ['tenths'],
    values: { tenths: [1, 2, 3] },
  },
  // Speed — kph
  {
    keyTemplate: 'correction_your_minimum_speed_is_about_{kph}_kph_too_low',
    textTemplate: 'Your minimum speed is about {kph} kilometres per hour too low.',
    category: 'correction',
    priority: 2,
    tags: ['speed', 'correction', 'kph'],
    param_slots: ['kph'],
    values: { kph: [3, 5, 8, 10] },
  },
];

/**
 * Expand parameterized templates into concrete cue entries.
 */
function expandParameterizedCues() {
  const expanded = [];
  for (const tmpl of PARAM_TEMPLATES) {
    const paramName = tmpl.param_slots[0]; // single param for now
    const vals = tmpl.values[paramName];
    for (const val of vals) {
      const cue_key = tmpl.keyTemplate.replace(`{${paramName}}`, val);
      const default_text = tmpl.textTemplate.replace(`{${paramName}}`, val);
      expanded.push({
        cue_key,
        default_text,
        category: tmpl.category,
        priority: tmpl.priority,
        language_code: 'en-US',
        suggested_voice_name: 'Magpie-Multilingual.EN-US.Aria',
        tags: tmpl.tags,
        is_parameterized: true,
        param_slots: tmpl.param_slots,
      });
    }
  }
  return expanded;
}

// ── Build full catalog ────────────────────────────────────────────────────────

const VOICE_CUE_CATALOG = [
  ...BASE_CUES,
  ...expandParameterizedCues(),
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

const _byKey = new Map(VOICE_CUE_CATALOG.map(c => [c.cue_key, c]));

/**
 * Get a cue entry by its cue_key.
 * @param {string} key
 * @returns {object|undefined}
 */
function getCueByKey(key) {
  return _byKey.get(key);
}

/**
 * Get all cues for a given category.
 * @param {string} category - 'reference' | 'correction' | 'summary'
 * @returns {Array}
 */
function getCuesByCategory(category) {
  return VOICE_CUE_CATALOG.filter(c => c.category === category);
}

module.exports = {
  VOICE_CUE_CATALOG,
  getCueByKey,
  getCuesByCategory,
};
