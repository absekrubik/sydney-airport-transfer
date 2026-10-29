import { loadEnvFile, loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

loadEnvFile();
const db = await createDb(loadConfig().databaseUrl);
try { await runMigrations(db, console.log); console.log('Database is up to date.'); } finally { await db.end(); }
