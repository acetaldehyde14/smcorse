'use strict';

/**
 * nvidiaMagpieTts.js
 * TTS provider wrapper for NVIDIA Magpie (NIM audio/speech endpoint).
 * Synthesizes coaching voice cues and saves them as WAV files.
 */

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
require('dotenv').config();

const NVIDIA_NIM_BASE_URL = process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com';
const NVIDIA_API_KEY      = process.env.NVIDIA_API_KEY;
const TTS_ENDPOINT        = `${NVIDIA_NIM_BASE_URL}/v1/audio/speech`;

/**
 * Build a standard 44-byte PCM WAV header.
 *
 * @param {number} dataLength    - Length of PCM audio data in bytes
 * @param {number} sampleRate    - Sample rate in Hz (e.g. 22050)
 * @param {number} numChannels   - Number of channels (1 = mono)
 * @param {number} bitsPerSample - Bit depth (e.g. 16)
 * @returns {Buffer} 44-byte WAV header
 */
function buildWavHeader(dataLength, sampleRate, numChannels = 1, bitsPerSample = 16) {
  const byteRate   = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const chunkSize  = 36 + dataLength;

  const header = Buffer.alloc(44);
  let offset = 0;

  // RIFF chunk descriptor
  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(chunkSize, offset); offset += 4;
  header.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4;          // sub-chunk size
  header.writeUInt16LE(1, offset); offset += 2;           // PCM = 1
  header.writeUInt16LE(numChannels, offset); offset += 2;
  header.writeUInt32LE(sampleRate, offset); offset += 4;
  header.writeUInt32LE(byteRate, offset); offset += 4;
  header.writeUInt16LE(blockAlign, offset); offset += 2;
  header.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataLength, offset);

  return header;
}

/**
 * Estimate audio duration from WAV buffer.
 * Falls back to calculating from raw data length if no WAV header.
 *
 * @param {Buffer} audioBuffer
 * @param {number} sampleRate
 * @returns {number} Duration in milliseconds
 */
function estimateDurationMs(audioBuffer, sampleRate) {
  // Check if this is a WAV file (starts with RIFF)
  if (audioBuffer.length >= 44 && audioBuffer.slice(0, 4).toString() === 'RIFF') {
    const dataSize = audioBuffer.readUInt32LE(40);
    const byteRate = audioBuffer.readUInt32LE(28);
    if (byteRate > 0) {
      return Math.round((dataSize / byteRate) * 1000);
    }
  }
  // Fallback: assume 16-bit mono
  const bytesPerSample = 2;
  const samples = audioBuffer.length / bytesPerSample;
  return Math.round((samples / sampleRate) * 1000);
}

/**
 * Check if the NVIDIA TTS endpoint is reachable.
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  try {
    await axios.get(`${NVIDIA_NIM_BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${NVIDIA_API_KEY}` },
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * synthesize
 *
 * Calls the NVIDIA NIM TTS endpoint and saves the resulting audio as a WAV file.
 *
 * @param {object} options
 * @param {string} options.text          - Text to synthesize
 * @param {string} options.cueKey        - Used as filename stem
 * @param {string} [options.languageCode]- Language code (default: 'en-US')
 * @param {string} [options.voiceName]   - Voice name (default: NVIDIA_TTS_VOICE env)
 * @param {number} [options.sampleRateHz]- Sample rate (default: NVIDIA_TTS_SAMPLE_RATE_HZ)
 * @param {string} options.outputDir     - Directory to save the file
 * @returns {Promise<{outputPath, relativePath, durationMs, sampleRateHz, mimeType}>}
 */
async function synthesize({
  text,
  cueKey,
  languageCode = process.env.NVIDIA_TTS_LANGUAGE || 'en-US',
  voiceName    = process.env.NVIDIA_TTS_VOICE    || 'Magpie-Multilingual.EN-US.Aria',
  sampleRateHz = parseInt(process.env.NVIDIA_TTS_SAMPLE_RATE_HZ || '22050'),
  outputDir,
}) {
  if (!text)       throw new Error('[nvidiaMagpieTts] text is required');
  if (!cueKey)     throw new Error('[nvidiaMagpieTts] cueKey is required');
  if (!outputDir)  throw new Error('[nvidiaMagpieTts] outputDir is required');
  if (!NVIDIA_API_KEY) throw new Error('[nvidiaMagpieTts] NVIDIA_API_KEY not set');

  // Ensure output directory exists
  await fs.promises.mkdir(outputDir, { recursive: true });

  const filename = `${cueKey}.wav`;
  const outputPath = path.join(outputDir, filename);

  const requestBody = {
    model: voiceName,
    input: text,
    voice: voiceName,
    response_format: 'wav',
  };

  let audioData;
  try {
    const response = await axios.post(TTS_ENDPOINT, requestBody, {
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'audio/wav, application/octet-stream, */*',
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const contentType = response.headers['content-type'] || '';
    let buf = Buffer.from(response.data);

    // If response is raw LPCM (not WAV), wrap it with a WAV header
    if (!contentType.includes('wav') && (buf.length < 4 || buf.slice(0, 4).toString() !== 'RIFF')) {
      console.log(`[nvidiaMagpieTts] Wrapping raw LPCM with WAV header for ${cueKey}`);
      const wavHeader = buildWavHeader(buf.length, sampleRateHz);
      buf = Buffer.concat([wavHeader, buf]);
    }

    audioData = buf;
  } catch (err) {
    const status  = err.response?.status;
    const errBody = err.response?.data
      ? Buffer.from(err.response.data).toString('utf8').slice(0, 200)
      : err.message;
    console.error(`[nvidiaMagpieTts] TTS request failed for "${cueKey}": ${status} ${errBody}`);
    throw new Error(`TTS synthesis failed for ${cueKey}: ${status} ${errBody}`);
  }

  // Save to disk
  await fs.promises.writeFile(outputPath, audioData);

  const durationMs = estimateDurationMs(audioData, sampleRateHz);

  // Compute relative path from the public directory
  const publicDir = path.join(__dirname, '..', '..', '..', 'public');
  const relativePath = path.relative(publicDir, outputPath).replace(/\\/g, '/');

  console.log(`[nvidiaMagpieTts] Synthesized "${cueKey}" -> ${outputPath} (${durationMs}ms)`);

  return {
    outputPath,
    relativePath,
    durationMs,
    sampleRateHz,
    mimeType: 'audio/wav',
  };
}

module.exports = { synthesize, isAvailable, buildWavHeader };
