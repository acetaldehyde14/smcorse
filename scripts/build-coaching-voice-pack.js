#!/usr/bin/env node
'use strict';

/**
 * build-coaching-voice-pack.js
 * CLI script to synthesize all coaching voice cues and store them on disk + DB.
 *
 * Usage:
 *   node scripts/build-coaching-voice-pack.js           # skip existing assets
 *   node scripts/build-coaching-voice-pack.js --force   # re-synthesize all
 */

require('dotenv').config();
const path = require('path');
const { buildVoicePack } = require('../src/services/coaching/voicePackBuilder');

const force = process.argv.includes('--force');

const outputDir = process.env.COACHING_VOICE_OUTPUT_DIR
  ? path.join(__dirname, '..', process.env.COACHING_VOICE_OUTPUT_DIR)
  : path.join(__dirname, '..', 'public', 'coaching-voice');

const languageCode = process.env.NVIDIA_TTS_LANGUAGE || 'en-US';
const voiceName    = process.env.NVIDIA_TTS_VOICE    || 'Magpie-Multilingual.EN-US.Aria';

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║         SM CORSE Coaching Voice Pack Builder           ║');
console.log('╚════════════════════════════════════════════════════════╝');
console.log('');
console.log(`  Language  : ${languageCode}`);
console.log(`  Voice     : ${voiceName}`);
console.log(`  Output dir: ${outputDir}`);
console.log(`  Force     : ${force}`);
console.log('');

buildVoicePack({ languageCode, voiceName, outputDir, force })
  .then(({ assetsBuilt, assetsSkipped, manifestId }) => {
    console.log('');
    console.log('✓ Voice pack build complete.');
    console.log(`  Assets synthesized : ${assetsBuilt}`);
    console.log(`  Assets skipped     : ${assetsSkipped}`);
    console.log(`  Manifest ID        : ${manifestId}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('✗ Voice pack build failed:', err.message);
    process.exit(1);
  });
