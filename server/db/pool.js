// The only file that talks to the `pg` driver. Everything else uses { query, tx, exec }.
export async function createDb(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30000 });
  pool.on('error', (e) => console.error('Database pool error:', e.message));
  const wrap = (client) => ({ query: (text, params) => client.query(text, params), exec: (sql) => client.query(sql) });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
        throw e;
      } finally { client.release(); }
    },
    end: () => pool.end(),
  };
}
