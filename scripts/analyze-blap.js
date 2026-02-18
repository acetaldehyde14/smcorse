const fs = require('fs');
const path = require('path');

// Find the blap file
const blapDir = 'c:/Users/maxim/Documents/smcorse/uploads/blap';
const files = fs.readdirSync(blapDir).filter(f => f.endsWith('.blap'));
const filePath = path.join(blapDir, files[0]);
console.log('File:', filePath);

const buf = fs.readFileSync(filePath);
console.log('File size:', buf.length, 'bytes');
console.log('');

function readStr(off, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    if (off + i >= buf.length) break;
    if (buf[off + i] === 0) break;
    s += String.fromCharCode(buf[off + i]);
  }
  return s;
}

console.log('=== BLAP Header ===');
console.log('Magic:', buf.slice(0, 4).toString('ascii'));
console.log('Version:', buf.readInt32LE(4));
console.log('Field @0x08:', buf.readInt32LE(8));
console.log('iRacing ID:', buf.readInt32LE(0x0C));
console.log('Driver:', readStr(0x10, 128));
console.log('Field @0x8C:', buf.readInt32LE(0x8C));
console.log('CarPath:', readStr(0x90, 64));
console.log('Field @0xD0:', buf.readInt32LE(0xD0));
console.log('String @0xD4:', readStr(0xD4, 64));
console.log('');

// Look for track name patterns in the file
console.log('=== Searching for track strings ===');
const text = buf.toString('ascii', 0, Math.min(buf.length, 5000));
const trackPatterns = ['spa', 'monza', 'silvers', 'nurbur', 'lemans', 'daytona', 'road', 'watkins', 'track', 'combined'];
trackPatterns.forEach(p => {
  const idx = text.toLowerCase().indexOf(p);
  if (idx >= 0) {
    console.log(`Found "${p}" at offset 0x${idx.toString(16)} (${idx}):`, readStr(idx, 60));
  }
});

console.log('');

// Look for lap time floats
console.log('=== Possible lap times (100-300 seconds) ===');
for (let i = 0; i < Math.min(buf.length, 2000); i += 4) {
  const f = buf.readFloatLE(i);
  if (f > 100 && f < 300 && f !== Math.floor(f)) {
    const mins = Math.floor(f / 60);
    const secs = (f % 60).toFixed(3);
    console.log(`  Offset 0x${i.toString(16)}: ${f.toFixed(3)}s (${mins}:${secs.padStart(6, '0')})`);
  }
}

console.log('');

// Dump more of the header area as hex
console.log('=== Bytes 0x0200-0x0300 ===');
for (let i = 0x200; i < Math.min(0x300, buf.length); i += 16) {
  let hex = '';
  let ascii = '';
  for (let j = 0; j < 16 && i + j < buf.length; j++) {
    hex += buf[i + j].toString(16).padStart(2, '0') + ' ';
    const c = buf[i + j];
    ascii += (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.';
  }
  console.log(i.toString(16).padStart(4, '0') + '  ' + hex.padEnd(48) + '  ' + ascii);
}

// Check for data structure after header
console.log('');
console.log('=== Data structure analysis ===');
// Read potential record size indicators
for (let off = 0x1F0; off <= 0x220; off += 4) {
  console.log(`Int32 @0x${off.toString(16)}: ${buf.readInt32LE(off)}`);
  console.log(`Float @0x${off.toString(16)}: ${buf.readFloatLE(off)}`);
}

// Check where repeating data patterns start (telemetry samples)
console.log('');
let dataStart = 0;
for (let i = 0x200; i < Math.min(buf.length - 100, 2000); i++) {
  // Look for a region with mostly float-like patterns
  const f1 = buf.readFloatLE(i);
  const f2 = buf.readFloatLE(i + 4);
  const f3 = buf.readFloatLE(i + 8);
  if (f1 > -1000 && f1 < 1000 && f2 > -1000 && f2 < 1000 && f3 > -1000 && f3 < 1000 &&
      f1 !== 0 && f2 !== 0 && f3 !== 0) {
    if (dataStart === 0) {
      dataStart = i;
      console.log(`Possible data start at 0x${i.toString(16)} (${i}):`);
      console.log(`  f1=${f1.toFixed(4)}, f2=${f2.toFixed(4)}, f3=${f3.toFixed(4)}`);
    }
  }
}

// Try to figure out sample size by looking for repeating patterns
if (dataStart > 0) {
  const remainingBytes = buf.length - dataStart;
  console.log(`Remaining bytes from data start: ${remainingBytes}`);
  // Common sample sizes
  [12, 16, 20, 24, 28, 32, 36, 40, 44, 48].forEach(ss => {
    const numSamples = Math.floor(remainingBytes / ss);
    if (remainingBytes % ss === 0 || Math.abs(remainingBytes / ss - numSamples) < 0.01) {
      console.log(`  Sample size ${ss} -> ${numSamples} samples (remainder: ${remainingBytes % ss})`);
    }
  });
}
