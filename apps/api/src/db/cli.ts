import { Pool } from 'pg';
import { readEnvironment } from '../config.js';
import { migrate } from './migrate.js';
import { seedDemo } from './seed.js';

const environment = readEnvironment(process.env);
const pool = new Pool({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  const command = process.argv[2];
  if (command === 'migrate') {
    const applied = await migrate(pool);
    console.log(applied ? 'Database migration applied.' : 'Database is already up to date.');
  } else if (command === 'seed') {
    const password = process.env.SEED_PASSWORD;
    if (!password) throw new Error('Set SEED_PASSWORD before seeding.');
    const inserted = await seedDemo(pool, password, new Date().toISOString().slice(0, 10));
    console.log(inserted ? 'Seeded 1 admin, 2 managers, 8 employees, 3 leave types, demo holidays, and 40 requests.' : 'Database already has users; seed skipped without changing existing data.');
  } else {
    throw new Error('Use the migrate or seed command.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database command failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
