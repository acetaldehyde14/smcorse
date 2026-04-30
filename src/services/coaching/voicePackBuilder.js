'use strict';

/**
 * voicePackBuilder.js
 * Synthesizes all voice cue catalog entries and stores assets in the DB.
 * Uses NVIDIA Magpie TTS. Idempotent — skips existing assets unless --force.
 */

const fs   = require('fs');
const path = require('path');
const { query } = require('../../config/database');
const { VOICE_CUE_CATALOG } = require('./voiceCueCatalog');
const { synthesize } = require('../tts/nvidiaMagpieTts');

/**
 * buildVoicePack
 *
 * @param {object} options
 * @param {string} [options.languageCode] - Language code (default: env NVIDIA_TTS_LANGUAGE)
 * @param {string} [options.voiceName]    - Voice name (default: env NVIDIA_TTS_VOICE)
 * @param {string} [options.outputDir]    - Directory to save WAV files
 * @param {boolean} [options.force]       - Re-synthesize even if file already exists
 * @returns {Promise<{assetsBuilt, assetsSkipped, manifestId}>}
 */
async function buildVoicePack({
  languageCode = process.env.NVIDIA_TTS_LANGUAGE || 'en-US',
  voiceName    = process.env.NVIDIA_TTS_VOICE    || 'Magpie-Multilingual.EN-US.Aria',
  outputDir    = process.env.COACHING_VOICE_OUTPUT_DIR
                   ? path.join(__dirname, '..', '..', '..', process.env.COACHING_VOICE_OUTPUT_DIR)
                   : path.join(__dirname, '..', '..', '..', 'public', 'coaching-voice'),
  force = false,
} = {}) {
  // Ensure output directory exists
  await fs.promises.mkdir(outputDir, { recursive: true });

  let assetsBuilt   = 0;
  let assetsSkipped = 0;
  const manifestCues = [];
  const manifestClips = {};

  for (const cue of VOICE_CUE_CATALOG) {
    const { cue_key, default_text } = cue;

    try {
      // Check if asset already exists in DB
      const existing = await query(
        'SELECT relative_path FROM coaching_voice_assets WHERE cue_key = $1',
        [cue_key]
      );

      if (!force && existing.rows.length > 0) {
        const relPath = existing.rows[0].relative_path;
        if (relPath) {
          const absPath = path.join(__dirname, '..', '..', '..', 'public', relPath);
          try {
            await fs.promises.access(absPath, fs.constants.F_OK);
            // File exists — skip
            assetsSkipped++;
            manifestCues.push({
              cue_key,
              relative_path: relPath,
              duration_ms: null,
              text: default_text,
            });
            manifestClips[cue_key] = relPath.startsWith('/') ? relPath : `/${relPath}`;
            continue;
          } catch {
            // File missing — re-synthesize
          }
        }
      }

      // Synthesize
      const result = await synthesize({
        text: default_text,
        cueKey: cue_key,
        languageCode,
        voiceName,
        outputDir,
      });

      // Upsert into coaching_voice_assets
      await query(
        `INSERT INTO coaching_voice_assets
           (cue_key, text, language_code, voice_name, provider,
            relative_path, mime_type, duration_ms, sample_rate_hz, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (cue_key) DO UPDATE SET
           text          = EXCLUDED.text,
           language_code = EXCLUDED.language_code,
           voice_name    = EXCLUDED.voice_name,
           provider      = EXCLUDED.provider,
           relative_path = EXCLUDED.relative_path,
           mime_type     = EXCLUDED.mime_type,
           duration_ms   = EXCLUDED.duration_ms,
           sample_rate_hz= EXCLUDED.sample_rate_hz,
           updated_at    = NOW()`,
        [
          cue_key,
          default_text,
          languageCode,
          voiceName,
          'nvidia_magpie',
          result.relativePath,
          result.mimeType,
          result.durationMs,
          result.sampleRateHz,
        ]
      );

      manifestCues.push({
        cue_key,
        relative_path: result.relativePath,
        duration_ms: result.durationMs,
        text: default_text,
      });
      manifestClips[cue_key] = result.relativePath.startsWith('/')
        ? result.relativePath
        : `/${result.relativePath}`;

      assetsBuilt++;
    } catch (err) {
      console.error(`[voicePackBuilder] Failed to synthesize "${cue_key}": ${err.message}`);
      // Continue with remaining cues — don't abort the whole pack build
    }
  }

  // Build manifest object
  const manifestObj = {
    version: Date.now(),
    language_code: languageCode,
    voice_name: voiceName,
    generated_at: new Date().toISOString(),
    clips: manifestClips,
    cues: manifestCues,
  };

  // Determine next manifest version number
  const versionResult = await query(
    `SELECT COALESCE(MAX(manifest_version), 0) + 1 AS next_version
     FROM coaching_voice_manifests
     WHERE language_code = $1 AND voice_name = $2`,
    [languageCode, voiceName]
  );
  const nextVersion = versionResult.rows[0]?.next_version ?? 1;
  manifestObj.version = nextVersion;

  // Insert manifest
  const manifestResult = await query(
    `INSERT INTO coaching_voice_manifests (manifest_version, language_code, voice_name, manifest_json)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [nextVersion, languageCode, voiceName, JSON.stringify(manifestObj)]
  );

  const manifestId = manifestResult.rows[0]?.id;

  console.log(`[voicePackBuilder] Done. Built: ${assetsBuilt}, Skipped: ${assetsSkipped}, ManifestId: ${manifestId}`);

  return { assetsBuilt, assetsSkipped, manifestId };
}

module.exports = { buildVoicePack };
