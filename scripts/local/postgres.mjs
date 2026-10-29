import { PGlite } from '@electric-sql/pglite';

export function createLocalPool(database) {
  let tail = Promise.resolve();
  async function connect() {
    const previous = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    let released = false;
    const query = async (text, values = []) => {
      const result = await database.query(text, values);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    };
    const sql = (parts, ...values) => query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values);
    return { query, sql, release() { if (!released) { released = true; unlock(); } } };
  }
  const sql = async (parts, ...values) => {
    const client = await connect();
    try { return await client.sql(parts, ...values); } finally { client.release(); }
  };
  sql.connect = connect;
  sql.query = async (text, values) => {
    const client = await connect();
    try { return await client.query(text, values); } finally { client.release(); }
  };
  return sql;
}
const key = Symbol.for('withbooth.local.database');
export const sql = createLocalPool(globalThis[key] ??= new PGlite(process.env.POS_LOCAL_DATA_DIR || '.local-data/postgres'));
