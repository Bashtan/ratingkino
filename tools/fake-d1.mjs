/* A small stand-in for D1's API over SQLite, for tests, with foreign keys on as in D1.
   Applies migrations/users/ in order. */
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const statement = (text, args = []) => ({
    bind: (...values) => statement(text, values),
    runNow: () => sql.prepare(text).run(...args),
    run: async () => sql.prepare(text).run(...args),
    all: async () => ({ results: sql.prepare(text).all(...args) }),
    first: async column => { const row = sql.prepare(text).get(...args) ?? null; return column ? row?.[column] ?? null : row; },
  });
  const db = {
    prepare: text => statement(text),
    batch: async list => {
      sql.exec('BEGIN');
      try { list.forEach(s => s.runNow()); sql.exec('COMMIT'); } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
  const migrations = new URL('../migrations/users/', import.meta.url);
  for (const file of readdirSync(migrations).sort()) sql.exec(readFileSync(new URL(file, migrations), 'utf8'));
  return db;
}
