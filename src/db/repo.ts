import { eq, or, inArray, desc, asc, sql as dsql } from 'drizzle-orm';
import { db, sql, schema, isNeonConfigured } from './index.ts';
import { loadLocalData, saveLocalData } from './store.ts';
import { ensureSchema } from '../../server/ensureSchema.ts';
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

// Setup schema Neon didelegasikan ke server/ensureSchema.ts (satu sumber kebenaran).
// ensureSchema() sudah di-cache per instance dan melewati setup penuh bila versi schema up-to-date.
export async function ensureDatabaseTables(): Promise<void> {
  if (isDbReady) return;

  if (useNeon && sql) {
    try {
      await ensureSchema();
    } catch (err) {
      logError('❌ Gagal menyiapkan tabel Neon:', err);
      // Jangan diam-diam beralih ke lokal jika Neon sudah dikonfigurasi.
      throw err;
    }
  } else {
    useNeon = false;
    // Inisialisasi penyimpanan lokal hanya untuk mode tanpa Neon.
    loadLocalData();
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

// Simpan banyak transaksi sekaligus: 1 query per 200 baris (bukan 1 query per transaksi).
export async function saveTransactions(txs: Transaction[]): Promise<void> {
  await ensureDatabaseTables();
  if (txs.length === 0) return;

  if (useNeon && db) {
    // Hilangkan id ganda (yang terakhir menang), karena satu INSERT ... ON CONFLICT
    // tidak boleh memuat baris dengan id yang sama dua kali.
    const unique = Array.from(new Map(txs.map(t => [t.id, t])).values());
    const CHUNK_SIZE = 200;

    for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
      const chunk = unique.slice(i, i + CHUNK_SIZE);

      await db
        .insert(schema.transactions)
        .values(chunk.map(transactionValues))
        .onConflictDoUpdate({
          target: schema.transactions.id,
          set: {
            no: dsql`excluded.no`,
            date: dsql`excluded.date`,
            description: dsql`excluded.description`,
            accountId: dsql`excluded.account_id`,
            type: dsql`excluded.type`,
            category: dsql`excluded.category`,
            amount: dsql`excluded.amount`,
            notes: dsql`excluded.notes`,
            transferTargetAccountId: dsql`excluded.transfer_target_account_id`,
            linkedTransactionId: dsql`excluded.linked_transaction_id`,
          },
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

// Hapus transaksi beserta pasangannya (linked) dalam 1 query.
export async function deleteTransaction(id: string): Promise<void> {
  await ensureDatabaseTables();

  if (useNeon && db) {
    await db
      .delete(schema.transactions)
      .where(
        or(
          eq(schema.transactions.id, id),
          eq(
            schema.transactions.id,
            dsql`(SELECT linked_transaction_id FROM transactions WHERE id = ${id})`,
          ),
        ),
      );
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
    await Promise.all([
      db.delete(schema.categories).where(eq(schema.categories.name, name)),
      db
        .update(schema.transactions)
        .set({ category: '' })
        .where(eq(schema.transactions.category, name)),
    ]);
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

    // Kelompokkan pembayaran per utang sekali saja (tidak memfilter ulang untuk tiap utang).
    const paymentsByDebt = new Map<string, DebtPayment[]>();
    for (const p of payRows) {
      const list = paymentsByDebt.get(p.debtId) ?? [];
      list.push({
        id: p.id,
        debtId: p.debtId,
        date: p.date,
        amount: Number(p.amount) || 0,
        accountId: p.accountId || undefined,
        notes: p.notes || undefined,
      });
      paymentsByDebt.set(p.debtId, list);
    }

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
      payments: paymentsByDebt.get(d.id) ?? [],
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

  const [accounts, debts] = await Promise.all([getAccounts(), getDebts()]);
  const now = new Date();

  // Utang/piutang yang sudah lunas dan belum diarsipkan.
  const settledDebtIds = debts
    .filter(debt => {
      const total = Number(debt.totalAmount) || 0;
      const paid = (debt.payments || []).reduce(
        (sum, payment) => sum + (Number(payment.amount) || 0),
        0,
      );
      return paid >= total && !debt.archivedAt;
    })
    .map(debt => debt.id);

  if (useNeon && db) {
    // Perbarui saldo rekening, arsipkan utang lunas, dan perbarui saldo awal kategori secara paralel.
    await Promise.all([
      ...accountBalances.map(balance => {
        const account = accounts.find(a => a.id === balance.accountId);
        return account
          ? saveAccount({ ...account, initialBalance: Number(balance.balance) || 0 })
          : Promise.resolve();
      }),
      settledDebtIds.length > 0
        ? db
            .update(schema.debts)
            .set({ archivedAt: now })
            .where(inArray(schema.debts.id, settledDebtIds))
        : Promise.resolve(),
      ...pocketBalances.map(balance =>
        db
          .update(schema.categories)
          .set({ openingBalance: Number(balance.balance) || 0 })
          .where(eq(schema.categories.name, balance.category)),
      ),
    ]);

    // Hapus transaksi tahun tutup buku (pakai rentang tanggal agar index tanggal terpakai).
    // Dijalankan terakhir, setelah semua saldo tersimpan.
    await sql`
      DELETE FROM transactions
      WHERE date >= ${`${targetYear}-01-01`}
        AND date < ${`${targetYear + 1}-01-01`}
    `;

    return;
  }

  // Mode lokal
  for (const balance of accountBalances) {
    const account = accounts.find(a => a.id === balance.accountId);
    if (account) {
      await saveAccount({
        ...account,
        initialBalance: Number(balance.balance) || 0,
      });
    }
  }

  const local = loadLocalData();
  const settled = new Set(settledDebtIds);

  for (const debt of local.debts) {
    if (settled.has(debt.id)) debt.archivedAt = now.toISOString();
  }

  for (const balance of pocketBalances) {
    const category = local.categories.find(c => c.name === balance.category);
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
