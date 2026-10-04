// src/db/index.ts
import 'dotenv/config';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema.ts';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  '';

export const isNeonConfigured = Boolean(
  connectionString &&
  !connectionString.includes('placeholder') &&
  !connectionString.includes('localhost') &&
  !connectionString.includes('127.0.0.1') &&
  (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://'))
);

export const sql: NeonQueryFunction<false, false> | null = isNeonConfigured
  ? neon(connectionString)
  : null;

export const db: NeonHttpDatabase<typeof schema> | null = sql
  ? drizzle(sql, { schema })
  : null;

export { schema };
