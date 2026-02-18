const parser = require('../src/services/parser');

async function test() {
  try {
    const result = await parser.parseFile('c:/Users/maxim/Downloads/porsche992rgt3_spa 2024 combined 2025-07-09 12-13-18.ibt');
    console.log('=== Parse Result ===');
    console.log('Track:', result.metadata.track);
    console.log('Track Short:', result.metadata.trackShort);
    console.log('Track Config:', result.metadata.trackConfig);
    console.log('Car:', result.metadata.car);
    console.log('Session Type:', result.metadata.sessionType);
    console.log('Best Lap Time:', result.metadata.lapTime, 'seconds');
    console.log('Lap Times:', result.metadata.lapTimes);
    console.log('Duration:', result.metadata.duration.toFixed(1), 'seconds');
    console.log('Telemetry samples:', result.telemetry.length);
    console.log('');
    if (result.telemetry.length > 0) {
      console.log('Sample telemetry point:', JSON.stringify(result.telemetry[5], null, 2));
    }
  } catch (err) {
    console.error('Parse failed:', err);
  }
}

test();
