import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

function createDb(url: string) {
  return drizzle(neon(url), { schema });
}

let instance: ReturnType<typeof createDb> | null = null;

// Koneksi dibuat saat pertama dipakai, supaya error "DATABASE_URL kosong" muncul sebagai pesan API yang jelas
export function getDb() {
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL belum diisi. Tambahkan di Environment Variables (Vercel) atau file .env.');
  }
  if (!instance) instance = createDb(url);
  return instance;
}