#!/usr/bin/env node
/**
 * run-migrations.js
 * Simple sequential migration runner.
 * Reads migration files from ../migrations/ in alphabetical order and
 * executes each against the configured PostgreSQL database.
 *
 * Usage:
 *   node scripts/run-migrations.js                 # run all pending
 *   node scripts/run-migrations.js --dry-run       # print files, no exec
 *   node scripts/run-migrations.js --backfill      # also run backfill/ scripts
 *
 * Tracks applied migrations in the migrations_log table.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'iracing_coach',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
});

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const BACKFILL_DIR   = path.join(MIGRATIONS_DIR, 'backfill');
const DRY_RUN        = process.argv.includes('--dry-run');
const RUN_BACKFILL   = process.argv.includes('--backfill');

async function ensureLogTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id          SERIAL PRIMARY KEY,
      filename    VARCHAR(255) UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ DEFAULT NOW(),
      duration_ms INTEGER
    )
  `);
}

function getMigrationFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(dir, f));
}

async function runFile(client, filepath) {
  const filename = path.relative(MIGRATIONS_DIR, filepath).replace(/\\/g, '/');
  const sql      = fs.readFileSync(filepath, 'utf8');

  // Check if already applied
  const check = await client.query(
    'SELECT id FROM migrations_log WHERE filename = $1', [filename]
  );
  if (check.rowCount > 0) {
    console.log(`  SKIP  ${filename} (already applied)`);
    return;
  }

  if (DRY_RUN) {
    console.log(`  DRY   ${filename}`);
    return;
  }

  const start = Date.now();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    const duration = Date.now() - start;
    await client.query(
      'INSERT INTO migrations_log (filename, duration_ms) VALUES ($1, $2)',
      [filename, duration]
    );
    await client.query('COMMIT');
    console.log(`  OK    ${filename}  (${duration}ms)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  FAIL  ${filename}`);
    console.error(`        ${err.message}`);
    throw err;
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureLogTable(client);

    const mainFiles     = getMigrationFiles(MIGRATIONS_DIR);
    const backfillFiles = RUN_BACKFILL ? getMigrationFiles(BACKFILL_DIR) : [];
    const allFiles      = [...mainFiles, ...backfillFiles];

    if (allFiles.length === 0) {
      console.log('No migration files found.');
      return;
    }

    console.log(`Running ${allFiles.length} migration file(s)${DRY_RUN ? ' (DRY RUN)' : ''}...`);
    for (const f of allFiles) {
      await runFile(client, f);
    }
    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
