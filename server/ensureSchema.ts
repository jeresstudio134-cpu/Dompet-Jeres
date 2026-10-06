import { sql } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from '../src/db/index.js';

// Naikkan angka ini (mis. '2') setiap kali menambah tabel/kolom/index/migrasi baru.
// Selama versi di tabel settings sama, setup schema dilewati (hanya 1 query SELECT).
const SCHEMA_VERSION = '1';

let ready: Promise<void> | null = null;
let ddlFailures = 0;

async function safeExec(query: ReturnType<typeof sql>) {
  try {
    await getDb().execute(query);
  } catch (err) {
    ddlFailures++;
    console.warn('DDL warning (ignored):', (err as any)?.cause?.message || (err as any)?.message || err);
  }
}

async function isSchemaCurrent(): Promise<boolean> {
  try {
    const res: any = await getDb().execute(
      sql`SELECT value FROM settings WHERE key = 'schema_version'`
    );
    const rows = res?.rows ?? res;
    return rows?.[0]?.value === SCHEMA_VERSION;
  } catch {
    // Tabel settings belum ada -> jalankan setup penuh.
    return false;
  }
}

// Membuat seluruh tabel, memastikan kolom kompatibel, dan memigrasikan data lama (category -> kantong) secara otomatis.
// Dijalankan penuh hanya jika versi schema di database berbeda dari SCHEMA_VERSION.
export function ensureSchema(force = false): Promise<void> {
  if (!hasDatabaseUrl()) {
    return Promise.resolve();
  }
  if (force) {
    ready = null;
  }
  if (!ready) {
    ready = (async () => {
      // 0. Jika schema sudah up-to-date, lewati semuanya (cepat saat cold start).
      if (!force && (await isSchemaCurrent())) return;

      ddlFailures = 0;

      // 1. Buat seluruh tabel secara paralel
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

      // 2. Pastikan seluruh kolom & index ada. ALTER digabung per tabel (1 query per tabel,
      //    tidak saling menunggu lock karena tabelnya berbeda).
      await Promise.all([
        safeExec(sql`
          ALTER TABLE transactions
            ADD COLUMN IF NOT EXISTS kantong VARCHAR(50),
            ADD COLUMN IF NOT EXISTS notes TEXT,
            ADD COLUMN IF NOT EXISTS no INTEGER,
            ADD COLUMN IF NOT EXISTS account_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT '',
            ADD COLUMN IF NOT EXISTS transfer_target_account_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS linked_transaction_id VARCHAR(64),
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        safeExec(sql`
          ALTER TABLE categories
            ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        safeExec(sql`
          ALTER TABLE kantongs
            ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        safeExec(sql`
          ALTER TABLE accounts
            ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#0284c7',
            ADD COLUMN IF NOT EXISTS icon_name VARCHAR(50) DEFAULT 'Wallet',
            ADD COLUMN IF NOT EXISTS initial_balance BIGINT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `),
        safeExec(sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE`),
        safeExec(sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date)`),
        safeExec(sql`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id)`),
      ]);

      // 3. Migrasi otomatis dari skema lama (di mana Kantong disimpan di tabel categories & kolom transactions.category)
      //    ke infrastruktur baru (tabel kantongs & kolom transactions.kantong):
      await Promise.all([
        // a) Jika tabel kantongs masih kosong, salin daftar kantong lama dari tabel categories
        safeExec(sql`
          INSERT INTO kantongs (name, opening_balance, created_at)
          SELECT TRIM(name), COALESCE(opening_balance, 0), COALESCE(created_at, CURRENT_TIMESTAMP)
          FROM categories
          WHERE name IS NOT NULL
            AND TRIM(name) <> ''
            AND TRIM(name) NOT IN ('-', 'Pindah Saldo', 'Pindah Kantong', 'Lainnya', 'Lain-lain', 'lainya', 'lain nya')
            AND NOT EXISTS (SELECT 1 FROM kantongs LIMIT 1)
          ON CONFLICT (name) DO NOTHING
        `),
        // b) Pastikan semua nilai category lama pada transaksi yang belum punya kantong juga terdaftar di tabel kantongs
        safeExec(sql`
          INSERT INTO kantongs (name)
          SELECT DISTINCT TRIM(category)
          FROM transactions
          WHERE (kantong IS NULL OR TRIM(kantong) = '' OR kantong = '-')
            AND category IS NOT NULL
            AND TRIM(category) <> ''
            AND TRIM(category) NOT IN ('-', 'Pindah Saldo', 'Pindah Kantong', 'Lainnya', 'Lain-lain', 'lainya', 'lain nya')
          ON CONFLICT (name) DO NOTHING
        `),
      ]);

      // c) Isi kolom kantong dari kolom category untuk seluruh transaksi lama yang kantong-nya masih NULL/kosong
      await safeExec(sql`
        UPDATE transactions
        SET kantong = TRIM(category)
        WHERE (kantong IS NULL OR TRIM(kantong) = '' OR kantong = '-')
          AND category IS NOT NULL
          AND TRIM(category) <> ''
          AND TRIM(category) NOT IN ('-', 'Pindah Saldo', 'Pindah Kantong')
      `);

      // d) Untuk transaksi pindah jatah kantong lama (id diawali 'kt-'), tandai category sebagai 'Pindah Kantong'
      await safeExec(sql`
        UPDATE transactions
        SET category = 'Pindah Kantong'
        WHERE id LIKE 'kt-%'
          AND kantong IS NOT NULL
          AND TRIM(kantong) <> ''
          AND category = kantong
      `);

      // 4. Tandai schema sudah up-to-date, hanya jika tidak ada DDL yang gagal.
      //    Kalau ada yang gagal, setup akan dicoba lagi pada cold start berikutnya.
      if (ddlFailures === 0) {
        await safeExec(sql`
          INSERT INTO settings (key, value)
          VALUES ('schema_version', ${SCHEMA_VERSION})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
        `);
      }
    })().catch(err => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
