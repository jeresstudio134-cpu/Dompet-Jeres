import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';

let ready: Promise<void> | null = null;

// Membuat tabel & kolom kalau belum ada. Aman dijalankan berulang dan tidak mengubah data.
// Kalau mengubah schema.ts, ubah juga di sini (atau jalankan `npm run db:push`).
export function ensureSchema(force = false): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    return Promise.resolve();
  }
  if (force) {
    ready = null;
  }
  if (!ready) {
    ready = (async () => {
      const db = getDb();

      // 1. Buat semua tabel utama (masing-masing tabel berbeda, aman dijalankan paralel)
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
            kantong VARCHAR(50),
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
            opening_balance BIGINT DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        db.execute(sql`
          CREATE TABLE IF NOT EXISTS kantongs (
            name VARCHAR(50) PRIMARY KEY,
            opening_balance BIGINT DEFAULT 0,
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

      // 2. Pastikan seluruh kolom skema terbaru ada pada tabel yang sudah dibuat sebelumnya
      // Menggunakan satu perintah ALTER TABLE per tabel agar tidak terjadi lock contention di Postgres/Neon
      await Promise.all([
        db.execute(sql`
          ALTER TABLE accounts
            ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#0284c7',
            ADD COLUMN IF NOT EXISTS icon_name VARCHAR(50) DEFAULT 'Wallet',
            ADD COLUMN IF NOT EXISTS initial_balance BIGINT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        db.execute(sql`
          ALTER TABLE transactions
            ADD COLUMN IF NOT EXISTS no INTEGER,
            ADD COLUMN IF NOT EXISTS account_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT '',
            ADD COLUMN IF NOT EXISTS kantong VARCHAR(50),
            ADD COLUMN IF NOT EXISTS notes TEXT,
            ADD COLUMN IF NOT EXISTS transfer_target_account_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS linked_transaction_id VARCHAR(64),
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        db.execute(sql`
          ALTER TABLE categories
            ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        db.execute(sql`
          ALTER TABLE kantongs
            ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        db.execute(sql`
          ALTER TABLE settings
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
      ]);

      // 3. Buat index pada tabel transactions secara berurutan setelah ALTER TABLE selesai
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id)`);
    })().catch(err => {
      ready = null; // coba lagi di permintaan berikutnya
      throw err;
    });
  }
  return ready;
}
