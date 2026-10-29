// Adds SAMPLE vehicles, places and fares so the site works during development. Never run this for a real launch.
import { loadEnvFile, loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { seedDev } from '../db/seed-dev.js';

loadEnvFile();
const config = loadConfig();
if (config.production) { console.error('Refusing to add sample data when NODE_ENV=production.'); process.exit(1); }
const db = await createDb(config.databaseUrl);
try { await runMigrations(db); console.log((await seedDev(db)) === false ? 'Data already exists, nothing changed.' : 'Sample data added.'); } finally { await db.end(); }
