import { eq, desc, asc, sql as dsql } from 'drizzle-orm';
import { db, sql, schema, isNeonConfigured } from './index.ts';
import { loadLocalData, saveLocalData } from './store.ts';
import type {
  Account,
  Transaction,
  Debt,
  DebtPayment,
  YearlyArchive,
} from '../types/finance.ts';

let isDbReady = false;
let useNeon = isNeonConfigured;

function logError(message: string, err: unknown) {
  console.error(message, err);
}

export async function ensureDatabaseTables(): Promise<void> {
  if (isDbReady) return;

  // Inisialisasi penyimpanan lokal untuk mode tanpa Neon.
  loadLocalData();

  if (useNeon && sql) {
    try {
      await Promise.all([
        sql`
          CREATE TABLE IF NOT EXISTS accounts (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            type VARCHAR(20) NOT NULL,
            color VARCHAR(20) DEFAULT '#0284c7',
            icon_name VARCHAR(50) DEFAULT 'Wallet',
            initial_balance BIGINT DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `,
        sql`
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
          );
        `,
        sql`
          CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `,
        sql`
          CREATE TABLE IF NOT EXISTS categories (
            name VARCHAR(50) PRIMARY KEY,
            opening_balance BIGINT DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `,
        sql`
          CREATE TABLE IF NOT EXISTS debts (
            id VARCHAR(64) PRIMARY KEY,
            type VARCHAR(10) NOT NULL,
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
        `,
        sql`
          CREATE TABLE IF NOT EXISTS debt_payments (
            id VARCHAR(64) PRIMARY KEY,
            debt_id VARCHAR(64) NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            amount BIGINT NOT NULL,
            account_id VARCHAR(50),
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `,
        sql`
          CREATE TABLE IF NOT EXISTS yearly_archives (
            id VARCHAR(64) PRIMARY KEY,
            year INTEGER NOT NULL UNIQUE,
            transaction_count INTEGER NOT NULL,
            data JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `,
      ]);

      console.log('✅ Neon Postgres tables verified.');
    } catch (err) {
      logError('❌ Gagal menyiapkan tabel Neon:', err);
      // Jangan diam-diam beralih ke lokal jika Neon sudah dikonfigurasi.
      throw err;
    }
  } else {
    useNeon = false;
    console.log('ℹ️ Neon tidak dikonfigurasi; memakai penyimpanan lokal.');
  }

  isDbReady = true;
}

// ============================================
// SETTINGS
// ============================================

export async function getSetting(key: string): Promise<string | null> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    const rows = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1);

    return rows[0]?.value ?? null;
  }

  const local = loadLocalData();
  return local.settings[key] || null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db
      .insert(schema.settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value, updatedAt: new Date() },
      });
    return;
  }

  const local = loadLocalData();
  local.settings[key] = value;
  saveLocalData(local);
}

export async function deleteSetting(key: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db.delete(schema.settings).where(eq(schema.settings.key, key));
    return;
  }

  const local = loadLocalData();
  delete local.settings[key];
  saveLocalData(local);
}

// ============================================
// ACCOUNTS
// ============================================

export async function getAccounts(): Promise<Account[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    const rows = await db
      .select()
      .from(schema.accounts)
      .orderBy(asc(schema.accounts.id));

    return rows.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type as 'cash' | 'bank' | 'ewallet',
      color: a.color || '#0284c7',
      iconName: a.iconName || 'Wallet',
      initialBalance: Number(a.initialBalance) || 0,
    }));
  }

  return loadLocalData().accounts;
}

export async function saveAccount(acc: Account): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db
      .insert(schema.accounts)
      .values({
        id: acc.id,
        name: acc.name,
        type: acc.type,
        color: acc.color || '#0284c7',
        iconName: acc.iconName || 'Wallet',
        initialBalance: Number(acc.initialBalance) || 0,
      })
      .onConflictDoUpdate({
        target: schema.accounts.id,
        set: {
          name: acc.name,
          type: acc.type,
          color: acc.color || '#0284c7',
          iconName: acc.iconName || 'Wallet',
          initialBalance: Number(acc.initialBalance) || 0,
        },
      });
    return;
  }

  const local = loadLocalData();
  const idx = local.accounts.findIndex(a => a.id === acc.id);

  if (idx >= 0) local.accounts[idx] = { ...acc };
  else local.accounts.push({ ...acc });

  saveLocalData(local);
}

export async function deleteAccount(id: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db.delete(schema.accounts).where(eq(schema.accounts.id, id));
    return;
  }

  const local = loadLocalData();
  local.accounts = local.accounts.filter(a => a.id !== id);
  saveLocalData(local);
}

// ============================================
// TRANSACTIONS
// ============================================

function mapTransaction(t: any): Transaction {
  return {
    id: t.id,
    no: t.no || undefined,
    date: t.date,
    description: t.description,
    accountId: t.accountId || '',
    type: t.type as 'masuk' | 'keluar',
    category: t.category,
    amount: Number(t.amount) || 0,
    notes: t.notes || undefined,
    transferTargetAccountId: t.transferTargetAccountId || undefined,
    linkedTransactionId: t.linkedTransactionId || undefined,
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : undefined,
  };
}

function transactionValues(tx: Transaction) {
  return {
    id: tx.id,
    no: tx.no || null,
    date: tx.date,
    description: tx.description,
    accountId: tx.accountId || null,
    type: tx.type,
    category: tx.category,
    amount: Number(tx.amount) || 0,
    notes: tx.notes || null,
    transferTargetAccountId: tx.transferTargetAccountId || null,
    linkedTransactionId: tx.linkedTransactionId || null,
  };
}

export async function getTransactions(): Promise<Transaction[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
        const rows = await db
      .select()
      .from(schema.transactions)
      .orderBy(
        desc(schema.transactions.date),
        dsql`${schema.transactions.no} DESC NULLS LAST`,
        desc(schema.transactions.id),
      );

    // Tabel Neon kosong berarti hasilnya memang kosong.
    return rows.map(mapTransaction);
  }

  const local = loadLocalData();
  return [...local.transactions].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if ((b.no ?? 0) !== (a.no ?? 0)) return (b.no ?? 0) - (a.no ?? 0);
    return b.id.localeCompare(a.id);
  });
}

export async function saveTransaction(tx: Transaction): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db
      .insert(schema.transactions)
      .values(transactionValues(tx))
      .onConflictDoUpdate({
        target: schema.transactions.id,
        set: transactionValues(tx),
      });
    return;
  }

  const local = loadLocalData();
  const idx = local.transactions.findIndex(t => t.id === tx.id);

  if (idx >= 0) local.transactions[idx] = { ...tx };
  else local.transactions.unshift({ ...tx });

  saveLocalData(local);
}

export async function saveTransactions(txs: Transaction[]): Promise<void> {
  await ensureDatabaseTables();
  if (txs.length === 0) return;

  if (useNeon && db) {
    for (const tx of txs) {
      await db
        .insert(schema.transactions)
        .values(transactionValues(tx))
        .onConflictDoUpdate({
          target: schema.transactions.id,
          set: transactionValues(tx),
        });
    }
    return;
  }

  const local = loadLocalData();
  const txMap = new Map(local.transactions.map(t => [t.id, t]));

  for (const tx of txs) txMap.set(tx.id, { ...tx });

  local.transactions = Array.from(txMap.values());
  saveLocalData(local);
}

export async function deleteTransaction(id: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id))
      .limit(1);

    const linkedId = rows[0]?.linkedTransactionId;

    await db.delete(schema.transactions).where(eq(schema.transactions.id, id));

    if (linkedId) {
      await db
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, linkedId));
    }
    return;
  }

  const local = loadLocalData();
  const target = local.transactions.find(t => t.id === id);
  const linkedId = target?.linkedTransactionId;

  local.transactions = local.transactions.filter(
    t => t.id !== id && (!linkedId || t.id !== linkedId),
  );
  saveLocalData(local);
}

export async function clearAllTransactions(): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db.delete(schema.transactions);
    return;
  }

  const local = loadLocalData();
  local.transactions = [];
  saveLocalData(local);
}

// ============================================
// CATEGORIES
// ============================================

export async function getCategories(): Promise<string[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    const rows = await db
      .select()
      .from(schema.categories)
      .orderBy(asc(schema.categories.createdAt), asc(schema.categories.name));

    return rows.map(c => c.name);
  }

  return loadLocalData().categories.map(c => c.name);
}

export async function addCategory(name: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db.insert(schema.categories).values({ name }).onConflictDoNothing();
    return;
  }

  const local = loadLocalData();

  if (!local.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    local.categories.push({
      name,
      openingBalance: 0,
      createdAt: new Date().toISOString(),
    });
    saveLocalData(local);
  }
}

export async function deleteCategory(name: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db.delete(schema.categories).where(eq(schema.categories.name, name));
    await db
      .update(schema.transactions)
      .set({ category: '' })
      .where(eq(schema.transactions.category, name));
    return;
  }

  const local = loadLocalData();
  local.categories = local.categories.filter(c => c.name !== name);
  local.transactions.forEach(t => {
    if (t.category === name) t.category = '';
  });
  saveLocalData(local);
}

// ============================================
// UTANG & PIUTANG
// ============================================

export async function getDebts(): Promise<Debt[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    const [debtRows, payRows] = await Promise.all([
      db.select().from(schema.debts).orderBy(desc(schema.debts.createdAt)),
      db.select().from(schema.debtPayments).orderBy(desc(schema.debtPayments.date)),
    ]);

    return debtRows.map(d => ({
      id: d.id,
      type: d.type as 'utang' | 'piutang',
      name: d.name,
      counterparty: d.counterparty || '',
      totalAmount: Number(d.totalAmount) || 0,
      startDate: d.startDate,
      dueDate: d.dueDate || undefined,
      installmentAmount: d.installmentAmount ? Number(d.installmentAmount) : undefined,
      installmentPeriod: d.installmentPeriod || undefined,
      notes: d.notes || undefined,
      createdAt: d.createdAt ? d.createdAt.toISOString() : new Date().toISOString(),
      archivedAt: d.archivedAt ? d.archivedAt.toISOString() : undefined,
      payments: payRows
        .filter(p => p.debtId === d.id)
        .map(p => ({
          id: p.id,
          debtId: p.debtId,
          date: p.date,
          amount: Number(p.amount) || 0,
          accountId: p.accountId || undefined,
          notes: p.notes || undefined,
        })),
    }));
  }

  const local = loadLocalData();
  return local.debts.map(d => ({
    ...d,
    payments: (local.debtPayments || []).filter(p => p.debtId === d.id),
  }));
}

export async function saveDebt(d: Debt): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db
      .insert(schema.debts)
      .values({
        id: d.id,
        type: d.type,
        name: d.name,
        counterparty: d.counterparty || null,
        totalAmount: Number(d.totalAmount) || 0,
        startDate: d.startDate,
        dueDate: d.dueDate || null,
        installmentAmount: d.installmentAmount ? Number(d.installmentAmount) : null,
        installmentPeriod: d.installmentPeriod || null,
        notes: d.notes || null,
        createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
      })
      .onConflictDoUpdate({
        target: schema.debts.id,
        set: {
          type: d.type,
          name: d.name,
          counterparty: d.counterparty || null,
          totalAmount: Number(d.totalAmount) || 0,
          startDate: d.startDate,
          dueDate: d.dueDate || null,
          installmentAmount: d.installmentAmount ? Number(d.installmentAmount) : null,
          installmentPeriod: d.installmentPeriod || null,
          notes: d.notes || null,
        },
      });
    return;
  }

  const local = loadLocalData();
  const idx = local.debts.findIndex(debt => debt.id === d.id);

  if (idx >= 0) {
    local.debts[idx] = {
      ...d,
      payments: d.payments || local.debts[idx].payments || [],
    };
  } else {
    local.debts.unshift({ ...d, payments: d.payments || [] });
  }

  saveLocalData(local);
}

export async function deleteDebt(id: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db.delete(schema.debts).where(eq(schema.debts.id, id));
    return;
  }

  const local = loadLocalData();
  local.debts = local.debts.filter(d => d.id !== id);
  local.debtPayments = (local.debtPayments || []).filter(p => p.debtId !== id);
  saveLocalData(local);
}

export async function saveDebtPayment(p: DebtPayment): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db
      .insert(schema.debtPayments)
      .values({
        id: p.id,
        debtId: p.debtId,
        date: p.date,
        amount: Number(p.amount) || 0,
        accountId: p.accountId || null,
        notes: p.notes || null,
      })
      .onConflictDoUpdate({
        target: schema.debtPayments.id,
        set: {
          date: p.date,
          amount: Number(p.amount) || 0,
          accountId: p.accountId || null,
          notes: p.notes || null,
        },
      });
    return;
  }

  const local = loadLocalData();
  if (!local.debtPayments) local.debtPayments = [];

  const idx = local.debtPayments.findIndex(pay => pay.id === p.id);
  if (idx >= 0) local.debtPayments[idx] = { ...p };
  else local.debtPayments.push({ ...p });

  const debt = local.debts.find(d => d.id === p.debtId);
  if (debt) {
    if (!debt.payments) debt.payments = [];
    const pIdx = debt.payments.findIndex(pay => pay.id === p.id);
    if (pIdx >= 0) debt.payments[pIdx] = { ...p };
    else debt.payments.push({ ...p });
  }

  saveLocalData(local);
}

export async function deleteDebtPayment(id: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db.delete(schema.debtPayments).where(eq(schema.debtPayments.id, id));
    return;
  }

  const local = loadLocalData();
  local.debtPayments = (local.debtPayments || []).filter(p => p.id !== id);
  local.debts.forEach(d => {
    if (d.payments) d.payments = d.payments.filter(p => p.id !== id);
  });
  saveLocalData(local);
}

// ============================================
// YEARLY ARCHIVES & TUTUP BUKU
// ============================================

export async function getYearlyArchives(
  year?: number,
): Promise<YearlyArchive[] | YearlyArchive | null> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    if (year) {
      const rows = await db
        .select()
        .from(schema.yearlyArchives)
        .where(eq(schema.yearlyArchives.year, year))
        .limit(1);

      if (rows.length === 0) return null;

      return {
        id: rows[0].id,
        year: rows[0].year,
        transactionCount: rows[0].transactionCount,
        data: rows[0].data as any,
        createdAt: rows[0].createdAt
          ? rows[0].createdAt.toISOString()
          : new Date().toISOString(),
      };
    }

    const rows = await db
      .select()
      .from(schema.yearlyArchives)
      .orderBy(desc(schema.yearlyArchives.year));

    return rows.map(r => ({
      id: r.id,
      year: r.year,
      transactionCount: r.transactionCount,
      data: r.data as any,
      createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
    }));
  }

  const local = loadLocalData();

  if (year) {
    return local.yearlyArchives.find(a => a.year === year) || null;
  }

  return [...local.yearlyArchives].sort((a, b) => b.year - a.year);
}

export async function saveYearlyArchive(archive: YearlyArchive): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db
      .insert(schema.yearlyArchives)
      .values({
        id: archive.id,
        year: archive.year,
        transactionCount: archive.transactionCount,
        data: archive.data,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.yearlyArchives.year,
        set: {
          transactionCount: archive.transactionCount,
          data: archive.data,
          createdAt: new Date(),
        },
      });
    return;
  }

  const local = loadLocalData();
  const idx = local.yearlyArchives.findIndex(a => a.year === archive.year);

  if (idx >= 0) local.yearlyArchives[idx] = { ...archive };
  else local.yearlyArchives.push({ ...archive });

  saveLocalData(local);
}

export async function executeCloseBook(
  targetYear: number,
  archivePayload: YearlyArchive,
  accountBalances: { accountId: string; balance: number }[],
  pocketBalances: { category: string; balance: number }[],
): Promise<void> {
  await ensureDatabaseTables();

  // Simpan arsip sebelum mengubah data.
  await saveYearlyArchive(archivePayload);

  // Perbarui saldo awal rekening.
  const accounts = await getAccounts();

  for (const balance of accountBalances) {
    const account = accounts.find(a => a.id === balance.accountId);

    if (account) {
      await saveAccount({
        ...account,
        initialBalance: Number(balance.balance) || 0,
      });
    }
  }

  // Tandai utang/piutang yang sudah lunas sebagai arsip.
  const debts = await getDebts();
  const now = new Date();

  for (const debt of debts) {
    const total = Number(debt.totalAmount) || 0;
    const paid = (debt.payments || []).reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0,
    );

    if (paid >= total && !debt.archivedAt) {
      if (useNeon && db) {
        await db
          .update(schema.debts)
          .set({ archivedAt: now })
          .where(eq(schema.debts.id, debt.id));
      } else {
        const local = loadLocalData();
        const localDebt = local.debts.find(d => d.id === debt.id);

        if (localDebt) {
          localDebt.archivedAt = now.toISOString();
          saveLocalData(local);
        }
      }
    }
  }

  // Perbarui saldo awal kategori/kantong.
  if (useNeon && db) {
    for (const balance of pocketBalances) {
      await db
        .update(schema.categories)
        .set({ openingBalance: Number(balance.balance) || 0 })
        .where(eq(schema.categories.name, balance.category));
    }

    // Hapus transaksi yang tanggalnya termasuk tahun tutup buku.
    await sql`
      DELETE FROM transactions
      WHERE EXTRACT(YEAR FROM date) = ${targetYear}
    `;

    return;
  }

  const local = loadLocalData();

  for (const balance of pocketBalances) {
    const category = local.categories.find(
      c => c.name === balance.category,
    );

    if (category) {
      category.openingBalance = Number(balance.balance) || 0;
    }
  }

  const yearPrefix = `${targetYear}-`;
  local.transactions = local.transactions.filter(
    transaction => !transaction.date?.startsWith(yearPrefix),
  );

  saveLocalData(local);
}

export async function restoreCloseBook(
  targetYear: number,
  txs: Transaction[],
): Promise<number> {
  await ensureDatabaseTables();

  await saveTransactions(txs);

  if (useNeon && db) {
    await db
      .delete(schema.yearlyArchives)
      .where(eq(schema.yearlyArchives.year, targetYear));
    return txs.length;
  }

  const local = loadLocalData();
  local.yearlyArchives = local.yearlyArchives.filter(a => a.year !== targetYear);
  saveLocalData(local);

  return txs.length;
}