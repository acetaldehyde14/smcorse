const fs = require('fs');
const buf = fs.readFileSync('c:/Users/maxim/Documents/smcorse/uploads/blap/1_1770926596963_313251_porsche992rgt3.blap');

// Search for ALL readable strings in the file
console.log('=== All strings found in BLAP file ===');
let currentStr = '';
let strStart = 0;
for (let i = 0; i < buf.length; i++) {
  const c = buf[i];
  if (c >= 32 && c <= 126) {
    if (currentStr.length === 0) strStart = i;
    currentStr += String.fromCharCode(c);
  } else {
    if (currentStr.length >= 4) {
      console.log(`  0x${strStart.toString(16).padStart(4, '0')} (${strStart}): "${currentStr}"`);
    }
    currentStr = '';
  }
}

// Also check the lap time area more carefully
console.log('');
console.log('=== Area around lap time (0x5A0-0x620) ===');
for (let i = 0x5A0; i < 0x620; i += 4) {
  const intVal = buf.readInt32LE(i);
  const floatVal = buf.readFloatLE(i);
  if ((floatVal > 0.01 && floatVal < 100000) || (intVal > 0 && intVal < 100000)) {
    console.log(`  0x${i.toString(16)}: int=${intVal} float=${floatVal.toFixed(4)}`);
  }
}

// Check for track ID (169 was car ID at 0x8C)
console.log('');
console.log('=== Looking for track ID (int16/int32 values near header) ===');
for (let i = 0x0C; i < 0x100; i += 4) {
  const val = buf.readInt32LE(i);
  if (val > 0 && val < 10000) {
    console.log(`  0x${i.toString(16)}: ${val}`);
  }
}
