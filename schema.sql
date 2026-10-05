-- Neon PostgreSQL Database Schema for Dompet Pintar / Dompet Toko
-- Run this in the Neon SQL Editor (https://console.neon.tech)

-- 1. Accounts Table (Dompet / Rekening: Cash, Dana, Seabank, ShopeePay)
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL,
  color VARCHAR(20) DEFAULT '#0284c7',
  icon_name VARCHAR(50) DEFAULT 'Wallet',
  initial_balance BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(64) PRIMARY KEY,
  no INTEGER,
  date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  account_id VARCHAR(50) REFERENCES accounts(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL,
  category VARCHAR(50) NOT NULL,
  kantong VARCHAR(50),
  amount BIGINT NOT NULL,
  notes TEXT,
  transfer_target_account_id VARCHAR(50),
  linked_transaction_id VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Categories & Kantongs & Settings Tables
CREATE TABLE IF NOT EXISTS categories (
  name VARCHAR(50) PRIMARY KEY,
  opening_balance BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kantongs (
  name VARCHAR(50) PRIMARY KEY,
  opening_balance BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Ensure all columns exist on older tables
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS no INTEGER,
  ADD COLUMN IF NOT EXISTS account_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT '',
  ADD COLUMN IF NOT EXISTS kantong VARCHAR(50),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS transfer_target_account_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS linked_transaction_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE kantongs
  ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 5. Optimization Indexes for Monthly & Account Queries
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);

-- 6. Initial Seed for Accounts matching DOMPET TOKO
INSERT INTO accounts (id, name, type, color, icon_name, initial_balance) VALUES
  ('cash', 'Cash', 'cash', '#10b981', 'Banknote', 0),
  ('dana', 'Dana', 'ewallet', '#0284c7', 'Smartphone', 0),
  ('seabank', 'Seabank', 'bank', '#ea580c', 'Building2', 0),
  ('shoopepay', 'ShopeePay', 'ewallet', '#f97316', 'CreditCard', 0)
ON CONFLICT (id) DO NOTHING;
