// Creates an admin user. The password is typed at a hidden prompt and never stored in a file or shell history.
import readline from 'node:readline';
import { loadEnvFile, loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { createUser } from '../services/auth.js';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); else if (s.includes('\n') || s.includes('\r')) process.stdout.write('\n'); };
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

loadEnvFile();
const db = await createDb(loadConfig().databaseUrl);
try {
  const email = (await ask('Email: ')).trim();
  const fullName = (await ask('Full name: ')).trim();
  const role = (await ask('Role (owner or staff) [owner]: ')).trim() || 'owner';
  const password = await ask('Password (12+ characters): ', { hidden: true });
  const again = await ask('Repeat password: ', { hidden: true });
  if (password !== again) throw new Error('Passwords did not match.');
  await createUser(db, { email, fullName, role, password });
  console.log(`Created ${role} ${email}. You can sign in at /admin/login.html`);
} catch (e) { console.error(`Could not create the user: ${e.message}`); process.exitCode = 1; } finally { await db.end(); }
