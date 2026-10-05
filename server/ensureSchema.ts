import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';

let ready: Promise<void> | null = null;

async function safeExec(query: ReturnType<typeof sql>) {
  try {
    await getDb().execute(query);
  } catch (err) {
    console.warn('DDL warning (ignored):', (err as any)?.cause?.message || (err as any)?.message || err);
  }
}

// Membuat seluruh 8 tabel & kolom sesuai skema Neon. Aman dijalankan berulang dan tidak mengubah data.
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
      // 1. Buat ke-8 tabel sesuai skema di Neon
      await Promise.all([
        safeExec(sql`
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
        safeExec(sql`
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
        safeExec(sql`
          CREATE TABLE IF NOT EXISTS categories (
            name VARCHAR(50) PRIMARY KEY,
            opening_balance BIGINT DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        safeExec(sql`
          CREATE TABLE IF NOT EXISTS kantongs (
            name VARCHAR(50) PRIMARY KEY,
            opening_balance BIGINT DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        safeExec(sql`
          CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        safeExec(sql`
          CREATE TABLE IF NOT EXISTS debts (
            id VARCHAR(64) PRIMARY KEY,
            type VARCHAR(20) NOT NULL,
            name VARCHAR(100) NOT NULL,
            counterparty VARCHAR(100),
            total_amount BIGINT NOT NULL,
            start_date TEXT NOT NULL,
            due_date TEXT,
            installment_amount BIGINT,
            installment_period INTEGER,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            archived_at TIMESTAMP WITH TIME ZONE
          )
        `),
        safeExec(sql`
          CREATE TABLE IF NOT EXISTS debt_payments (
            id VARCHAR(64) PRIMARY KEY,
            debt_id VARCHAR(64) NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            amount BIGINT NOT NULL,
            account_id VARCHAR(50),
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
        safeExec(sql`
          CREATE TABLE IF NOT EXISTS yearly_archives (
            id VARCHAR(64) PRIMARY KEY,
            year INTEGER NOT NULL UNIQUE,
            transaction_count INTEGER NOT NULL,
            data JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `),
      ]);

      // 2. Pastikan seluruh kolom ada pada tabel di Neon
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS kantong VARCHAR(50)`);
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT`);
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS no INTEGER`);
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_id VARCHAR(50)`);
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT ''`);
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_target_account_id VARCHAR(50)`);
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS linked_transaction_id VARCHAR(64)`);
      await safeExec(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`);

      await safeExec(sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0`);
      await safeExec(sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`);

      await safeExec(sql`ALTER TABLE kantongs ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0`);
      await safeExec(sql`ALTER TABLE kantongs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`);

      await safeExec(sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#0284c7'`);
      await safeExec(sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS icon_name VARCHAR(50) DEFAULT 'Wallet'`);
      await safeExec(sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS initial_balance BIGINT DEFAULT 0`);
      await safeExec(sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`);

      await safeExec(sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE`);

      // 3. Buat index
      await safeExec(sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date)`);
      await safeExec(sql`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id)`);
    })().catch(err => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
