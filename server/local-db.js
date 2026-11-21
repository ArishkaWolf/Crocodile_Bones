import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export function localDatabase(filename = '.local/rooms.sqlite') {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(readFileSync(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        values: [], bind(...values) { this.values = values; return this; },
        async first() { return db.prepare(sql).get(...this.values) || null; },
        async run() { const result = db.prepare(sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    close() { db.close(); },
  };
}
