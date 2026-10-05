-- ============================================
-- SCHEMA DATABASE NEON POSTGRES (8 TABEL)
-- ============================================

-- 1. Tabel Akun Dompet / Rekening
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'cash' | 'bank' | 'ewallet'
  color VARCHAR(20) DEFAULT '#0284c7',
  icon_name VARCHAR(50) DEFAULT 'Wallet',
  initial_balance BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabel Transaksi Kas
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(64) PRIMARY KEY,
  no INTEGER,
  date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  account_id VARCHAR(50) REFERENCES accounts(id),
  type VARCHAR(10) NOT NULL, -- 'masuk' | 'keluar'
  category VARCHAR(50) NOT NULL,
  kantong VARCHAR(50),
  amount BIGINT NOT NULL,
  notes TEXT,
  transfer_target_account_id VARCHAR(50),
  linked_transaction_id VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabel Pengaturan Sistem (Nama Toko, Nama Pemilik, PIN Admin, AI Rate Limit)
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabel Kategori
CREATE TABLE IF NOT EXISTS categories (
  name VARCHAR(50) PRIMARY KEY,
  opening_balance BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabel Kantong (Pos Anggaran)
CREATE TABLE IF NOT EXISTS kantongs (
  name VARCHAR(50) PRIMARY KEY,
  opening_balance BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tabel Utang & Piutang
CREATE TABLE IF NOT EXISTS debts (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(20) NOT NULL, -- 'utang' | 'piutang'
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
);

-- 7. Tabel Riwayat Pembayaran / Angsuran Utang
CREATE TABLE IF NOT EXISTS debt_payments (
  id VARCHAR(64) PRIMARY KEY,
  debt_id VARCHAR(64) NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount BIGINT NOT NULL,
  account_id VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tabel Arsip Tahunan (Tutup Buku)
CREATE TABLE IF NOT EXISTS yearly_archives (
  id VARCHAR(64) PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  transaction_count INTEGER NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index untuk mempercepat filter dan pencarian
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id);

-- ============================================
-- MIGRASI OTOMATIS DARI SKEMA LAMA (category -> kantong)
-- ============================================
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS kantong VARCHAR(50);

INSERT INTO kantongs (name, opening_balance, created_at)
SELECT TRIM(name), COALESCE(opening_balance, 0), COALESCE(created_at, CURRENT_TIMESTAMP)
FROM categories
WHERE name IS NOT NULL
  AND TRIM(name) <> ''
  AND TRIM(name) NOT IN ('-', 'Pindah Saldo', 'Pindah Kantong', 'Lainnya', 'Lain-lain', 'lainya', 'lain nya')
ON CONFLICT (name) DO NOTHING;

INSERT INTO kantongs (name)
SELECT DISTINCT TRIM(category)
FROM transactions
WHERE (kantong IS NULL OR TRIM(kantong) = '' OR kantong = '-')
  AND category IS NOT NULL
  AND TRIM(category) <> ''
  AND TRIM(category) NOT IN ('-', 'Pindah Saldo', 'Pindah Kantong', 'Lainnya', 'Lain-lain', 'lainya', 'lain nya')
ON CONFLICT (name) DO NOTHING;

UPDATE transactions
SET kantong = TRIM(category)
WHERE (kantong IS NULL OR TRIM(kantong) = '' OR kantong = '-')
  AND category IS NOT NULL
  AND TRIM(category) <> ''
  AND TRIM(category) NOT IN ('-', 'Pindah Saldo', 'Pindah Kantong');

UPDATE transactions
SET category = 'Pindah Kantong'
WHERE id LIKE 'kt-%'
  AND kantong IS NOT NULL
  AND TRIM(kantong) <> ''
  AND category = kantong;
