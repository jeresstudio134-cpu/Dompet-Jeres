// src/db/schema.ts
import { pgTable, varchar, integer, text, timestamp, bigint, jsonb, date } from 'drizzle-orm/pg-core';

// 1. Akun Dompet / Rekening
export const accounts = pgTable('accounts', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // 'cash' | 'bank' | 'ewallet'
  color: varchar('color', { length: 20 }).default('#0284c7'),
  iconName: varchar('icon_name', { length: 50 }).default('Wallet'),
  initialBalance: bigint('initial_balance', { mode: 'number' }).default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 2. Transaksi Kas
export const transactions = pgTable('transactions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  no: integer('no'),
  date: date('date', { mode: 'string' }).notNull(), // YYYY-MM-DD
  description: varchar('description', { length: 255 }).notNull(),
  accountId: varchar('account_id', { length: 50 }).references(() => accounts.id),
  type: varchar('type', { length: 10 }).notNull(), // 'masuk' | 'keluar'
  category: varchar('category', { length: 50 }).notNull(),
  kantong: varchar('kantong', { length: 50 }),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  notes: text('notes'),
  transferTargetAccountId: varchar('transfer_target_account_id', { length: 50 }),
  linkedTransactionId: varchar('linked_transaction_id', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 3. Pengaturan Sistem
export const settings = pgTable('settings', {
  key: varchar('key', { length: 50 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// 4. Kategori
export const categories = pgTable('categories', {
  name: varchar('name', { length: 50 }).primaryKey(),
  openingBalance: bigint('opening_balance', { mode: 'number' }).default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 4b. Kantong (Pos Anggaran)
export const kantongs = pgTable('kantongs', {
  name: varchar('name', { length: 50 }).primaryKey(),
  openingBalance: bigint('opening_balance', { mode: 'number' }).default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 5. Utang & Piutang
export const debts = pgTable('debts', {
  id: varchar('id', { length: 64 }).primaryKey(),
  type: varchar('type', { length: 10 }).notNull(), // 'utang' | 'piutang'
  name: varchar('name', { length: 100 }).notNull(),
  counterparty: varchar('counterparty', { length: 100 }),
  totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
  startDate: text('start_date').notNull(), // YYYY-MM-DD
  dueDate: text('due_date'), // YYYY-MM-DD
  installmentAmount: bigint('installment_amount', { mode: 'number' }),
  installmentPeriod: integer('installment_period'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

// 6. Riwayat Pembayaran / Angsuran Utang
export const debtPayments = pgTable('debt_payments', {
  id: varchar('id', { length: 64 }).primaryKey(),
  debtId: varchar('debt_id', { length: 64 })
    .notNull()
    .references(() => debts.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  amount: bigint('amount', { mode: 'number' }).notNull(),
  accountId: varchar('account_id', { length: 50 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 7. Arsip Tahunan (Tutup Buku)
export const yearlyArchives = pgTable('yearly_archives', {
  id: varchar('id', { length: 64 }).primaryKey(),
  year: integer('year').notNull().unique(),
  transactionCount: integer('transaction_count').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
