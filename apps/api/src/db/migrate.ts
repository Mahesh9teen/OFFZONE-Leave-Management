import type { Pool } from 'pg';
import { inTransaction } from './database.js';
import { initialSchema, leaveFeaturesSchema, offzoneSchema } from './schema.js';

export async function migrate(pool: Pool): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(1175081)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.version));
    let changed = false;
    for (const [index, sql] of [initialSchema, offzoneSchema, leaveFeaturesSchema].entries()) {
      const version = index + 1;
      if (applied.has(version)) continue;
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      changed = true;
    }
    return changed;
  });
}
