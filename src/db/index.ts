import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

export { schema };

export function getCleanDatabaseUrl(): string {
  let raw = (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^(DATABASE_URL|NEON_DATABASE_URL)\s*=\s*/i, '').trim();
  raw = raw.replace(/^psql\s+/i, '').trim();
  raw = raw.replace(/^['"]+|['"]+$/g, '').trim();
  return raw;
}

function createDb(url: string) {
  return drizzle(neon(url), { schema });
}

const dbUrl = getCleanDatabaseUrl();
export const isNeonConfigured = Boolean(dbUrl);

let sql: ReturnType<typeof neon<false, false>>;
let db: ReturnType<typeof createDb>;

try {
  if (dbUrl) {
    sql = neon(dbUrl);
    db = createDb(dbUrl);
  } else {
    console.warn('[AI Studio] Database not connected — using mock');
    const noOp = {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async (d: any) => d?.data ?? {},
      update: async (d: any) => d?.data ?? {},
      delete: async () => ({}),
    };
    db = new Proxy(
      {},
      {
        get: (_, prop) =>
          prop === 'query' ? new Proxy({}, { get: () => noOp }) : async () => [],
      }
    ) as any;
    sql = (async () => []) as any;
  }
} catch {
  console.warn('[AI Studio] Database not connected — using mock');
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {},
    delete: async () => ({}),
  };
  db = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'query' ? new Proxy({}, { get: () => noOp }) : async () => [],
    }
  ) as any;
  sql = (async () => []) as any;
}

export { db, sql };

let instance: ReturnType<typeof createDb> | null = null;
let lastUrl = '';

export function hasDatabaseUrl(): boolean {
  return Boolean(getCleanDatabaseUrl());
}

// Koneksi dibuat saat pertama dipakai, supaya error "DATABASE_URL kosong" muncul sebagai pesan API yang jelas
export function getDb() {
  const url = getCleanDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL belum diisi. Tambahkan di Environment Variables (Vercel) atau file .env.');
  }
  if (!instance || lastUrl !== url) {
    instance = createDb(url);
    lastUrl = url;
  }
  return instance;
}