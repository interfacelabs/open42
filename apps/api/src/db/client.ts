import '../env.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema.js';

type DbClient = ReturnType<typeof drizzle>;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL is required (see .env.example)');
}

const pool = databaseUrl
  ? new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  : null;

const missingDatabaseUrl = (): DbClient =>
  new Proxy({} as DbClient, {
    get() {
      throw new Error('DATABASE_URL is required (see .env.example)');
    },
  });

export const db = pool ? drizzle({ client: pool }) : missingDatabaseUrl();
export { schema };
