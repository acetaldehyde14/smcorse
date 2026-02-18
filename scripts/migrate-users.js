/**
 * Migration Script: SQLite to PostgreSQL
 * Migrates user data from users.db (SQLite) to PostgreSQL
 */

const Database = require('better-sqlite3');
const { pool } = require('../src/config/database');
require('dotenv').config();

async function migrateUsers() {
  console.log('========================================');
  console.log('  User Migration: SQLite → PostgreSQL');
  console.log('========================================\n');

  try {
    // Open SQLite database
    console.log('📂 Opening SQLite database...');
    const sqlite = new Database('users.db', { readonly: true });

    // Get all users from SQLite
    const users = sqlite.prepare('SELECT * FROM users').all();
    console.log(`✓ Found ${users.length} users in SQLite\n`);

    if (users.length === 0) {
      console.log('⚠ No users to migrate');
      sqlite.close();
      await pool.end();
      return;
    }

    // Migrate each user
    let migrated = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        // Check if user already exists in PostgreSQL
        const existing = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [user.email]
        );

        if (existing.rows.length > 0) {
          console.log(`⏭ Skipping ${user.email} (already exists)`);
          skipped++;
          continue;
        }

        // Insert into PostgreSQL
        // Note: SQLite uses 'password' column, PostgreSQL uses 'password_hash'
        await pool.query(
          `INSERT INTO users (email, password_hash, username, created_at)
           VALUES ($1, $2, $3, $4)`,
          [
            user.email,
            user.password, // Already hashed with bcrypt
            user.name,
            user.created_at
          ]
        );

        console.log(`✓ Migrated ${user.email}`);
        migrated++;

      } catch (error) {
        console.error(`❌ Failed to migrate ${user.email}:`, error.message);
      }
    }

    // Close connections
    sqlite.close();
    await pool.end();

    console.log('\n========================================');
    console.log('  Migration Complete');
    console.log('========================================');
    console.log(`✓ Migrated: ${migrated} users`);
    console.log(`⏭ Skipped: ${skipped} users`);
    console.log(`Total: ${users.length} users\n`);

    if (migrated > 0) {
      console.log('💾 Backup recommendation:');
      console.log('   Keep users.db file as backup');
      console.log('   You can delete it after verifying the migration\n');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run migration
migrateUsers().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
