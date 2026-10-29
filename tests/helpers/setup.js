// Builds a clean test database and returns { db, config, close }.
//   TEST_DATABASE_URL  -> real PostgreSQL through the `pg` package (use this on your computer)
//   TEST_PSQL_ARGS     -> e.g. "-h /tmp/pgtest -p 5544 -U postgres" (runs SQL through the psql client)
import { execFileSync } from 'node:child_process';
import { createDb } from '../../server/db/pool.js';
import { createPsqlDb } from './psql-db.js';
import { runMigrations } from '../../server/db/migrate.js';
import { seedDev } from '../../server/db/seed-dev.js';

export const CONFIG = { production: false, port: 0, databaseUrl: '', secret: 'test-secret-test-secret-test-secret-123', cookieSecure: false, trustProxy: false, rateLimitScale: 1000, warnings: [] };

export function dbAvailable() { return Boolean(process.env.TEST_DATABASE_URL || process.env.TEST_PSQL_ARGS); }

export async function freshDb() {
  let db;
  if (process.env.TEST_DATABASE_URL) {
    db = await createDb(process.env.TEST_DATABASE_URL);
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  } else {
    const args = process.env.TEST_PSQL_ARGS.split(' ');
    execFileSync('psql', ['-X', '-q', ...args, '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public']);
    db = createPsqlDb(args);
  }
  await runMigrations(db);
  await seedDev(db);
  return db;
}
