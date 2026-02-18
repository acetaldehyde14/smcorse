const parser = require('../src/services/parser');
const fs = require('fs');
const path = require('path');

async function test() {
  const blapDir = 'c:/Users/maxim/Documents/smcorse/uploads/blap';
  const files = fs.readdirSync(blapDir).filter(f => f.endsWith('.blap'));

  for (const f of files) {
    const filePath = path.join(blapDir, f);
    console.log('Testing:', f);
    try {
      const result = await parser.parseFile(filePath);
      console.log('Result:', JSON.stringify(result.metadata, null, 2));
    } catch (e) {
      console.error('Error:', e.message);
    }
    console.log('');
  }
}

test();
