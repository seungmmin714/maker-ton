import { AsyncLocalStorage } from 'node:async_hooks';

async function providerCall(operation) {
  try { return await operation(); } catch (error) {
    // pg/provider errors can carry connection metadata. Retain only a bounded
    // machine code, never the provider message, detail, query, cause or URL.
    const safe = new Error('PostgreSQL operation failed');
    safe.code = /^[A-Z0-9_]{1,40}$/.test(error?.code || '') ? error.code : 'DATABASE_ERROR';
    throw safe;
  }
}
const query = (client, sql) => providerCall(() => client.query(sql));

// Application SQL uses SQLite-style positional parameters. Quoted SQL text and
// comments must remain untouched; all input values still go through pg binding.
export function postgresSql(sql) {
  let parameter = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    token => token === '?' ? `$${++parameter}` : token);
}

function rows(result) {
  const integers = result.fields.filter(field => field.dataTypeID === 20).map(field => field.name);
  return result.rows.map(row => {
    for (const name of integers) {
      if (row[name] === null) continue;
      const value = Number(row[name]);
      if (!Number.isSafeInteger(value)) throw new RangeError('Database integer exceeds the supported range');
      row[name] = value;
    }
    return row;
  });
}

export async function createPostgresDatabase(connectionString, options = {}) {
  const schema = options.schema || 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid database schema');
  let pool = options.pool;
  if (!pool) {
    let address;
    try { address = new URL(connectionString); } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL'); }
    if (!['postgres:', 'postgresql:'].includes(address.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000, maxLifetimeSeconds: 300, allowExitOnIdle: true });
    // The pool removes failed idle clients. Never log the error's connection
    // context, SQL or provider message, which can contain private data.
    pool.on('error', () => console.warn('PostgreSQL idle connection closed.'));
  }
  const context = new AsyncLocalStorage();
  const pending = new Set();
  let closing = false, closePromise;

  async function isolated(callback) {
    const client = await providerCall(() => pool.connect());
    const owner = { client, active: true };
    let begun = false, unusable = false;
    try {
      await query(client, `BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15s'; SET LOCAL search_path="${schema}"`);
      begun = true;
      // Every operation, including reads and standalone writes, takes this
      // transaction-scoped lock. It preserves the SQLite adapter's serialized
      // semantics across separate Vercel processes and pooled connections.
      // Acquire it in its own statement so subsequent reads get a fresh
      // READ COMMITTED snapshot after waiting. Never use a session-level lock.
      await query(client, 'SELECT pg_advisory_xact_lock(184732901, 1)');
      const value = await context.run(owner, () => callback(client));
      await query(client, 'COMMIT');
      return value;
    } catch (error) {
      if (begun) {
        try { await query(client, 'ROLLBACK'); } catch { unusable = true; }
      } else unusable = true;
      throw error;
    } finally {
      owner.active = false;
      client.release(unusable);
    }
  }
  function schedule(callback) {
    const owner = context.getStore();
    if (owner) return owner.active ? Promise.resolve().then(() => callback(owner.client)) : Promise.reject(new Error('Transaction has ended'));
    if (closing) return Promise.reject(new Error('Database is closed'));
    const promise = isolated(callback);
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  return {
    prepare(sql) {
      const text = postgresSql(sql);
      const execute = values => schedule(client => query(client, { text, values }));
      return {
        get: async (...values) => rows(await execute(values))[0],
        all: async (...values) => rows(await execute(values)),
        run: async (...values) => ({ changes: Number((await execute(values)).rowCount || 0) }),
      };
    },
    exec: sql => schedule(async client => { await query(client, sql); }),
    transaction(callback) {
      if (context.getStore()) return Promise.reject(new Error('Nested transactions are not supported'));
      return schedule(() => callback());
    },
    close() {
      if (context.getStore()?.active) return Promise.reject(new Error('Cannot close a database inside its transaction'));
      if (!closePromise) {
        closing = true;
        closePromise = (async () => { await Promise.allSettled([...pending]); await providerCall(() => pool.end()); })();
      }
      return closePromise;
    },
  };
}
