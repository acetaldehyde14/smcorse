const fs = require('fs');

const filePath = 'c:/Users/maxim/Downloads/porsche992rgt3_spa 2024 combined 2025-07-09 12-13-18.ibt';
const buf = fs.readFileSync(filePath);

// Header
const tickRate = buf.readInt32LE(0x08);
const sessionInfoLen = buf.readInt32LE(0x10);
const sessionInfoOffset = buf.readInt32LE(0x14);
const numVars = buf.readInt32LE(0x18);
const varHeaderOffset = buf.readInt32LE(0x1C);
const bufLen = buf.readInt32LE(0x24);
const dataOffset = buf.readInt32LE(0x34);
const totalRecords = Math.floor((buf.length - dataOffset) / bufLen);

console.log('=== IBT File Analysis ===');
console.log('File size:', buf.length, 'bytes');
console.log('TickRate:', tickRate, 'Hz');
console.log('SessionInfoLen:', sessionInfoLen);
console.log('SessionInfoOffset:', sessionInfoOffset);
console.log('NumVars:', numVars);
console.log('BufLen:', bufLen);
console.log('DataOffset:', dataOffset);
console.log('TotalRecords:', totalRecords);
console.log('Duration:', (totalRecords / tickRate).toFixed(1), 'seconds');
console.log('');

// Parse session info YAML (simple extraction)
const sessionInfo = buf.slice(sessionInfoOffset, sessionInfoOffset + sessionInfoLen).toString('ascii');

// Extract key values
function extractYAML(text, key) {
  const regex = new RegExp(key + ':\\s*(.+)');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

const trackDisplayName = extractYAML(sessionInfo, 'TrackDisplayName');
const trackShortName = extractYAML(sessionInfo, 'TrackDisplayShortName');
const trackConfig = extractYAML(sessionInfo, 'TrackConfigName');
const trackLength = extractYAML(sessionInfo, 'TrackLength');
const sessionType = extractYAML(sessionInfo, 'SessionType');

// Find driver's car
const driverCarIdx = parseInt(extractYAML(sessionInfo, 'DriverCarIdx'));

// Find the driver's car screen name
const driverSetupName = extractYAML(sessionInfo, 'DriverSetupName');

// Find CarScreenName for DriverCarIdx
const driverPattern = new RegExp(`CarIdx: ${driverCarIdx}[\\s\\S]*?CarScreenName: (.+)`, 'm');
const carMatch = sessionInfo.match(driverPattern);
const carName = carMatch ? carMatch[1].trim() : null;

console.log('=== Session Info ===');
console.log('Track:', trackDisplayName);
console.log('Track Short:', trackShortName);
console.log('Track Config:', trackConfig);
console.log('Track Length:', trackLength);
console.log('Session Type:', sessionType);
console.log('Car:', carName);
console.log('Driver Car Idx:', driverCarIdx);
console.log('Setup:', driverSetupName);
console.log('');

// Extract laps from telemetry data
console.log('=== Lap Times ===');
let lastLap = -1;
let lapTimes = [];

for (let i = 0; i < totalRecords; i++) {
  const recOffset = dataOffset + (i * bufLen);
  const lap = buf.readInt32LE(recOffset + 209);
  const bestLapTime = buf.readFloatLE(recOffset + 237);
  const lastLapTime = buf.readFloatLE(recOffset + 241);

  if (lap !== lastLap && lap >= 0) {
    if (lastLapTime > 0 && lap > 0) {
      lapTimes.push({ lap: lap, lastLapTime: lastLapTime, bestLapTime: bestLapTime });
      const mins = Math.floor(lastLapTime / 60);
      const secs = (lastLapTime % 60).toFixed(3);
      console.log(`  Lap ${lap}: lastLapTime=${mins}:${secs.padStart(6,'0')} bestLapTime=${bestLapTime.toFixed(3)}`);
    }
    lastLap = lap;
  }
}

console.log('');
console.log('Total laps with times:', lapTimes.length);
if (lapTimes.length > 0) {
  const best = Math.min(...lapTimes.map(l => l.lastLapTime));
  const bMins = Math.floor(best / 60);
  const bSecs = (best % 60).toFixed(3);
  console.log('Best lap:', `${bMins}:${bSecs.padStart(6,'0')}`);
}
