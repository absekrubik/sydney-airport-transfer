import http from 'node:http';
import { loadEnvFile, loadConfig } from './config.js';
import { createDb } from './db/pool.js';
import { createApp } from './app.js';

loadEnvFile();
const config = loadConfig();
const db = await createDb(config.databaseUrl);
const app = createApp({ db, config });
const server = http.createServer(app.handler);
server.requestTimeout = 30_000;
server.listen(config.port, () => {
  config.warnings.forEach((w) => console.warn(`! ${w}`));
  console.log(`Airport transfers running at http://localhost:${config.port}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(async () => { await db.end(); process.exit(0); }));
