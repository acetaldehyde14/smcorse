'use strict';

/**
 * lapSummary.js
 * Thin wrapper around observationAnalyzer.buildLapSummary.
 * Extension point: future versions may call an LLM here to generate
 * a narrative lap summary in addition to the structured data.
 */

const { buildLapSummary } = require('./observationAnalyzer');

// Re-export for convenience
module.exports = { buildLapSummary };
