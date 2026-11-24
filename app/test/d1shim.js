import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
// Minimal D1-compatible wrapper over node:sqlite for tests.
export function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => wrap(sql), raw: db };
}
