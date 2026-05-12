import './src/env.ts';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required (set in .env.local)');
}

export default defineConfig({
  schema: ['./src/db/schema.ts', '../../packages/cloud/api/schema-cloud.ts'],
  out: '../../packages/cloud/migrations-bundled',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: false,
  verbose: true,
});
