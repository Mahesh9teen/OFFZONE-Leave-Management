import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { ENVIRONMENT, type Environment } from '../config.js';

export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  readOnly = false,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Database transaction and rollback failed.');
    }
    throw error;
  } finally {
    client.release();
  }
}

@Injectable()
export class Database implements OnModuleInit, OnApplicationShutdown {
  readonly pool: Pool;
  private readonly logger = new Logger(Database.name);

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.pool = new Pool({
      connectionString: environment.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      application_name: 'leave-management',
    });
    this.pool.on('error', () => this.logger.error('An idle PostgreSQL connection failed. Check database availability.'));
  }

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }

  transaction<T>(work: (client: PoolClient) => Promise<T>, readOnly = false) {
    return inTransaction(this.pool, work, readOnly);
  }
}
