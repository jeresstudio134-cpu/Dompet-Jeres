import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';

let ready: Promise<void> | null = null;

// Membuat tabel kalau belum ada. Aman dijalankan berulang dan tidak mengubah data.
// Kalau mengubah schema.ts, ubah juga di sini (atau jalankan `npm run db:push`).
export function ensureSchema(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    return Promise.resolve();
  }
  if (!ready) {
    ready = (async () => {
      const db = getDb();

      await Promise.all([
        db.execute(sql`
          CREATE TABLE IF NOT EXISTS accounts (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            type VARCHAR(20) NOT NULL,
            color VARCHAR(20) DEFAULT '#0284c7',
            icon_name VARCHAR(50) DEFAULT 'Wallet',
            initial_balance BIGINT DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        db.execute(sql`
          CREATE TABLE IF NOT EXISTS transactions (
            id VARCHAR(64) PRIMARY KEY,
            no INTEGER,
            date DATE NOT NULL,
            description VARCHAR(255) NOT NULL,
            account_id VARCHAR(50),
            type VARCHAR(10) NOT NULL,
            category VARCHAR(50) NOT NULL,
            amount BIGINT NOT NULL,
            notes TEXT,
            transfer_target_account_id VARCHAR(50),
            linked_transaction_id VARCHAR(64),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        db.execute(sql`
          CREATE TABLE IF NOT EXISTS categories (
            name VARCHAR(50) PRIMARY KEY,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        db.execute(sql`
          CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
      ]);

      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id)`),
        db.execute(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT`),
      ]);
    })().catch(err => {
      ready = null; // coba lagi di permintaan berikutnya
      throw err;
    });
  }
  return ready;
}