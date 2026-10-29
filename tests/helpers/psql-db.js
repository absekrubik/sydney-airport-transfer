// TEST HELPER ONLY. Lets the test-suite run real SQL against a PostgreSQL server through the `psql`
// command-line client when the `pg` npm package is not installed. Production code uses server/db/pool.js.
// Values are written into the SQL text here (acceptable for tests, never do this in app code).
import { spawn } from 'node:child_process';

const OUT = '__OUT_END__'; const ERR = '__ERR_END__';

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('bad number'); return String(v); }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const fill = (sql, params = []) => sql.replace(/\$(\d+)/g, (_, i) => literal(params[Number(i) - 1]));
const wraps = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);

export function createPsqlDb(psqlArgs) {
  const child = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=0', ...psqlArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = ''; let pending = null;
  const settle = () => {
    if (pending && out.includes(OUT) && err.includes(ERR)) {
      const p = pending; pending = null;
      const text = out.slice(0, out.indexOf(OUT)).trim(); const problem = err.slice(0, err.indexOf(ERR)).trim();
      out = out.slice(out.indexOf(OUT) + OUT.length); err = err.slice(err.indexOf(ERR) + ERR.length);
      p(problem ? { problem } : { text });
    }
  };
  child.stdout.on('data', (d) => { out += d; settle(); });
  child.stderr.on('data', (d) => { err += d; settle(); });
  let chain = Promise.resolve();
  const run = (sql) => { const job = chain.then(() => new Promise((resolve) => { pending = resolve; child.stdin.write(`${sql};\n\\echo ${OUT}\n\\warn ${ERR}\n`); })); chain = job.catch(() => {}); return job; };

  async function query(text, params) {
    const sql = fill(text, params);
    const r = await run(wraps(sql) ? `WITH q AS (${sql}) SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM q` : sql);
    if (r.problem) { const e = new Error(r.problem.replace(/^psql:.*?ERROR:\s*/s, '')); e.code = (/duplicate key/.test(r.problem) ? '23505' : 'DB'); throw e; }
    return { rows: wraps(sql) && r.text ? JSON.parse(r.text) : [] };
  }
  const exec = async (sql) => { const r = await run(sql); if (r.problem) throw new Error(r.problem); return { rows: [] }; };
  const self = {
    query, exec,
    async tx(fn) {
      await exec('BEGIN');
      try { const result = await fn({ query, exec }); await exec('COMMIT'); return result; } catch (e) { await run('ROLLBACK'); throw e; }
    },
    end: () => { child.stdin.end(); },
  };
  return self;
}
