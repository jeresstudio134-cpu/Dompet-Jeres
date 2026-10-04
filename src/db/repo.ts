// src/db/repo.ts
import { eq, desc, asc } from 'drizzle-orm';
import { db, sql, schema, isNeonConfigured } from './index.ts';
import { loadLocalData, saveLocalData } from './store.ts';
import type { Account, Transaction, Debt, DebtPayment, YearlyArchive } from '../types/finance.ts';

let isDbReady = false;
let useNeon = isNeonConfigured;

export async function ensureDatabaseTables(): Promise<void> {
  if (isDbReady) return;

  // Pastikan data lokal selalu terinisialisasi
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
    } catch (err: any) {
      console.warn('⚠️ Neon Postgres tidak dapat dihubungi, beralih ke penyimpanan lokal:', err.message || err);
      useNeon = false;
    }
  } else {
    useNeon = false;
  }

  isDbReady = true;
}

// ============================================
// SETTINGS
// ============================================

export async function getSetting(key: string): Promise<string | null> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    try {
      const rows = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, key))
        .limit(1);
      if (rows.length > 0) return rows[0].value;
      return null;
    } catch (err) {
      console.warn(`Fallback getSetting(${key}) ke local:`, err);
    }
  }

  const local = loadLocalData();
  return local.settings[key] || null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureDatabaseTables();

  // Simpan ke local
  const local = loadLocalData();
  local.settings[key] = value;
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db
        .insert(schema.settings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value, updatedAt: new Date() },
        });
    } catch (err) {
      console.warn(`Gagal simpan setting ${key} ke Neon:`, err);
    }
  }
}

export async function deleteSetting(key: string): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  delete local.settings[key];
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.settings).where(eq(schema.settings.key, key));
    } catch (err) {
      console.warn(`Gagal delete setting ${key} di Neon:`, err);
    }
  }
}

// ============================================
// ACCOUNTS
// ============================================

export async function getAccounts(): Promise<Account[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    try {
      const rows = await db.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
      if (rows.length > 0) {
        return rows.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type as 'cash' | 'bank' | 'ewallet',
          color: a.color || '#0284c7',
          iconName: a.iconName || 'Wallet',
          initialBalance: Number(a.initialBalance) || 0,
        }));
      }
    } catch (err) {
      console.warn('Fallback getAccounts ke local:', err);
    }
  }

  const local = loadLocalData();
  return local.accounts;
}

export async function saveAccount(acc: Account): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  const idx = local.accounts.findIndex(a => a.id === acc.id);
  if (idx >= 0) {
    local.accounts[idx] = { ...acc };
  } else {
    local.accounts.push({ ...acc });
  }
  saveLocalData(local);

  if (useNeon && db) {
    try {
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
    } catch (err) {
      console.warn('Gagal simpan akun ke Neon:', err);
    }
  }
}

export async function deleteAccount(id: string): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  local.accounts = local.accounts.filter(a => a.id !== id);
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.accounts).where(eq(schema.accounts.id, id));
    } catch (err) {
      console.warn('Gagal hapus akun di Neon:', err);
    }
  }
}

// ============================================
// TRANSACTIONS
// ============================================

export async function getTransactions(): Promise<Transaction[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    try {
      const rows = await db.select().from(schema.transactions).orderBy(
        desc(schema.transactions.date),
        desc(schema.transactions.no),
        desc(schema.transactions.id)
      );
      if (rows.length > 0) {
        return rows.map(t => ({
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
          createdAt: t.createdAt ? t.createdAt.toISOString() : undefined,
        }));
      }
    } catch (err) {
      console.warn('Fallback getTransactions ke local:', err);
    }
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

  const local = loadLocalData();
  const idx = local.transactions.findIndex(t => t.id === tx.id);
  if (idx >= 0) {
    local.transactions[idx] = { ...tx };
  } else {
    local.transactions.unshift({ ...tx });
  }
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db
        .insert(schema.transactions)
        .values({
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
        })
        .onConflictDoUpdate({
          target: schema.transactions.id,
          set: {
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
          },
        });
    } catch (err) {
      console.warn('Gagal simpan transaksi ke Neon:', err);
    }
  }
}

export async function saveTransactions(txs: Transaction[]): Promise<void> {
  if (txs.length === 0) return;
  await ensureDatabaseTables();

  const local = loadLocalData();
  const txMap = new Map(local.transactions.map(t => [t.id, t]));
  for (const t of txs) {
    txMap.set(t.id, { ...t });
  }
  local.transactions = Array.from(txMap.values());
  saveLocalData(local);

  if (useNeon && db) {
    try {
      for (const t of txs) {
        await db
          .insert(schema.transactions)
          .values({
            id: t.id,
            no: t.no || null,
            date: t.date,
            description: t.description,
            accountId: t.accountId || null,
            type: t.type,
            category: t.category,
            amount: Number(t.amount) || 0,
            notes: t.notes || null,
            transferTargetAccountId: t.transferTargetAccountId || null,
            linkedTransactionId: t.linkedTransactionId || null,
          })
          .onConflictDoUpdate({
            target: schema.transactions.id,
            set: {
              no: t.no || null,
              date: t.date,
              description: t.description,
              accountId: t.accountId || null,
              type: t.type,
              category: t.category,
              amount: Number(t.amount) || 0,
              notes: t.notes || null,
              transferTargetAccountId: t.transferTargetAccountId || null,
              linkedTransactionId: t.linkedTransactionId || null,
            },
          });
      }
    } catch (err) {
      console.warn('Gagal batch simpan transaksi ke Neon:', err);
    }
  }
}

export async function deleteTransaction(id: string): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  const target = local.transactions.find(t => t.id === id);
  const linkedId = target?.linkedTransactionId;

  local.transactions = local.transactions.filter(t => t.id !== id && (!linkedId || t.id !== linkedId));
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.transactions).where(eq(schema.transactions.id, id));
      if (linkedId) {
        await db.delete(schema.transactions).where(eq(schema.transactions.id, linkedId));
      }
    } catch (err) {
      console.warn('Gagal hapus transaksi di Neon:', err);
    }
  }
}

export async function clearAllTransactions(): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  local.transactions = [];
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.transactions);
    } catch (err) {
      console.warn('Gagal hapus semua transaksi di Neon:', err);
    }
  }
}

// ============================================
// CATEGORIES
// ============================================

export async function getCategories(): Promise<string[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    try {
      const rows = await db
        .select()
        .from(schema.categories)
        .orderBy(asc(schema.categories.createdAt), asc(schema.categories.name));
      if (rows.length > 0) return rows.map(c => c.name);
    } catch (err) {
      console.warn('Fallback getCategories ke local:', err);
    }
  }

  const local = loadLocalData();
  return local.categories.map(c => c.name);
}

export async function addCategory(name: string): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  if (!local.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    local.categories.push({
      name,
      openingBalance: 0,
      createdAt: new Date().toISOString(),
    });
    saveLocalData(local);
  }

  if (useNeon && db) {
    try {
      await db.insert(schema.categories).values({ name }).onConflictDoNothing();
    } catch (err) {
      console.warn('Gagal tambah kategori di Neon:', err);
    }
  }
}

export async function deleteCategory(name: string): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  local.categories = local.categories.filter(c => c.name !== name);
  local.transactions.forEach(t => {
    if (t.category === name) t.category = '';
  });
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.categories).where(eq(schema.categories.name, name));
      await db.update(schema.transactions).set({ category: '' }).where(eq(schema.transactions.category, name));
    } catch (err) {
      console.warn('Gagal hapus kategori di Neon:', err);
    }
  }
}

// ============================================
// UTANG & PIUTANG
// ============================================

export async function getDebts(): Promise<Debt[]> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    try {
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
    } catch (err) {
      console.warn('Fallback getDebts ke local:', err);
    }
  }

  const local = loadLocalData();
  return local.debts.map(d => ({
    ...d,
    payments: (local.debtPayments || []).filter(p => p.debtId === d.id),
  }));
}

export async function saveDebt(d: Debt): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  const idx = local.debts.findIndex(debt => debt.id === d.id);
  if (idx >= 0) {
    local.debts[idx] = { ...d, payments: d.payments || local.debts[idx].payments || [] };
  } else {
    local.debts.unshift({ ...d, payments: d.payments || [] });
  }
  saveLocalData(local);

  if (useNeon && db) {
    try {
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
    } catch (err) {
      console.warn('Gagal simpan debt ke Neon:', err);
    }
  }
}

export async function deleteDebt(id: string): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  local.debts = local.debts.filter(d => d.id !== id);
  local.debtPayments = (local.debtPayments || []).filter(p => p.debtId !== id);
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.debts).where(eq(schema.debts.id, id));
    } catch (err) {
      console.warn('Gagal hapus debt di Neon:', err);
    }
  }
}

export async function saveDebtPayment(p: DebtPayment): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  if (!local.debtPayments) local.debtPayments = [];
  const idx = local.debtPayments.findIndex(pay => pay.id === p.id);
  if (idx >= 0) {
    local.debtPayments[idx] = { ...p };
  } else {
    local.debtPayments.push({ ...p });
  }

  // Sync juga ke debts array
  const debt = local.debts.find(d => d.id === p.debtId);
  if (debt) {
    if (!debt.payments) debt.payments = [];
    const pIdx = debt.payments.findIndex(pay => pay.id === p.id);
    if (pIdx >= 0) debt.payments[pIdx] = { ...p };
    else debt.payments.push({ ...p });
  }

  saveLocalData(local);

  if (useNeon && db) {
    try {
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
    } catch (err) {
      console.warn('Gagal simpan payment ke Neon:', err);
    }
  }
}

export async function deleteDebtPayment(id: string): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  local.debtPayments = (local.debtPayments || []).filter(p => p.id !== id);
  local.debts.forEach(d => {
    if (d.payments) d.payments = d.payments.filter(p => p.id !== id);
  });
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.debtPayments).where(eq(schema.debtPayments.id, id));
    } catch (err) {
      console.warn('Gagal hapus payment di Neon:', err);
    }
  }
}

// ============================================
// YEARLY ARCHIVES & TUTUP BUKU
// ============================================

export async function getYearlyArchives(year?: number): Promise<YearlyArchive[] | YearlyArchive | null> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    try {
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
          createdAt: rows[0].createdAt ? rows[0].createdAt.toISOString() : new Date().toISOString(),
        };
      }

      const rows = await db.select().from(schema.yearlyArchives).orderBy(desc(schema.yearlyArchives.year));
      return rows.map(r => ({
        id: r.id,
        year: r.year,
        transactionCount: r.transactionCount,
        data: r.data as any,
        createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
      }));
    } catch (err) {
      console.warn('Fallback getYearlyArchives ke local:', err);
    }
  }

  const local = loadLocalData();
  if (year) {
    return local.yearlyArchives.find(a => a.year === year) || null;
  }
  return [...local.yearlyArchives].sort((a, b) => b.year - a.year);
}

export async function saveYearlyArchive(archive: YearlyArchive): Promise<void> {
  await ensureDatabaseTables();

  const local = loadLocalData();
  const idx = local.yearlyArchives.findIndex(a => a.year === archive.year);
  if (idx >= 0) {
    local.yearlyArchives[idx] = { ...archive };
  } else {
    local.yearlyArchives.push({ ...archive });
  }
  saveLocalData(local);

  if (useNeon && db) {
    try {
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
    } catch (err) {
      console.warn('Gagal simpan arsip ke Neon:', err);
    }
  }
}

export async function executeCloseBook(
  targetYear: number,
  archivePayload: YearlyArchive,
  accountBalances: { accountId: string; balance: number }[],
  pocketBalances: { category: string; balance: number }[]
): Promise<void> {
  await ensureDatabaseTables();

  // 1. Simpan arsip
  await saveYearlyArchive(archivePayload);

  // 2. Update saldo awal akun
  for (const ab of accountBalances) {
    const accs = await getAccounts();
    const targetAcc = accs.find(a => a.id === ab.accountId);
    if (targetAcc) {
      targetAcc.initialBalance = ab.balance;
      await saveAccount(targetAcc);
    }
  }

  // 3. Update saldo awal kategori
  const local = loadLocalData();
  for (const pb of pocketBalances) {
    const cat = local.categories.find(c => c.name === pb.category);
    if (cat) cat.openingBalance = pb.balance;
  }

  // 4. Hapus transaksi tahun tersebut
  const yearStr = String(targetYear);
  local.transactions = local.transactions.filter(t => !t.date || !t.date.startsWith(yearStr));

  // 5. Arsipkan utang yang sudah lunas
  const debts = await getDebts();
  debts.forEach(d => {
    const total = Number(d.totalAmount) || 0;
    const paid = (d.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (paid >= total && !d.archivedAt) {
      d.archivedAt = new Date().toISOString();
      const localDebt = local.debts.find(ld => ld.id === d.id);
      if (localDebt) localDebt.archivedAt = d.archivedAt;
    }
  });

  saveLocalData(local);

  if (useNeon && db && sql) {
    try {
      // Hapus transaksi di Neon
      await sql`DELETE FROM transactions WHERE EXTRACT(YEAR FROM date) = ${targetYear}`;

      // Arsipkan utang lunas di Neon
      for (const d of debts) {
        if (d.archivedAt) {
          await db
            .update(schema.debts)
            .set({ archivedAt: new Date(d.archivedAt) })
            .where(eq(schema.debts.id, d.id));
        }
      }
    } catch (err) {
      console.warn('Gagal executeCloseBook di Neon:', err);
    }
  }
}

export async function restoreCloseBook(
  targetYear: number,
  txs: Transaction[]
): Promise<number> {
  await ensureDatabaseTables();

  // Kembalikan transaksi
  await saveTransactions(txs);

  // Hapus arsip
  const local = loadLocalData();
  local.yearlyArchives = local.yearlyArchives.filter(a => a.year !== targetYear);
  saveLocalData(local);

  if (useNeon && db) {
    try {
      await db.delete(schema.yearlyArchives).where(eq(schema.yearlyArchives.year, targetYear));
    } catch (err) {
      console.warn('Gagal hapus arsip di Neon:', err);
    }
  }

  return txs.length;
}
