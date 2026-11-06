import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Async database contract used by the application:
 *   prepare(sql).get/all/run(...values), exec(sql), transaction(async fn), close().
 * run resolves to { changes }. get resolves to a row or undefined.
 * A transaction callback and all its statements must use one isolated connection.
 */
export async function createSqliteDatabase(filename) {
  const { DatabaseSync } = await import('node:sqlite');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  if (filename !== ':memory:') chmodSync(filename, 0o600);

  const context = new AsyncLocalStorage();
  let tail = Promise.resolve();
  let closed = false;
  let closePromise;

  // Every operation shares the queue. An unrelated request cannot read or write
  // the connection while an async transaction callback is waiting at an await.
  function schedule(operation) {
    if (context.getStore()?.active) return Promise.resolve().then(operation);
    if (closed || closePromise) return Promise.reject(new Error('Database is closed'));
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }

  const database = {
    prepare(sql) {
      return {
        get: (...values) => schedule(() => raw.prepare(sql).get(...values)),
        all: (...values) => schedule(() => raw.prepare(sql).all(...values)),
        run: (...values) => schedule(() => ({ changes: Number(raw.prepare(sql).run(...values).changes) })),
      };
    },
    exec: sql => schedule(() => raw.exec(sql)),
    transaction(callback) {
      if (context.getStore()?.active) return Promise.reject(new Error('Nested transactions are not supported'));
      return schedule(async () => {
        const owner = { active: true };
        raw.exec('BEGIN IMMEDIATE');
        try {
          const value = await context.run(owner, callback);
          raw.exec('COMMIT');
          return value;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        } finally {
          // A task spawned by the callback must not retain transaction access
          // after the transaction itself has ended.
          owner.active = false;
        }
      });
    },
    close() {
      if (context.getStore()?.active) return Promise.reject(new Error('Cannot close a database inside its transaction'));
      if (!closePromise) closePromise = schedule(() => { raw.close(); closed = true; });
      return closePromise;
    },
  };
  return database;
}
