import { Router } from 'express';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../src/db/index.js';
import { accounts, categories, transactions } from '../../src/db/schema.js';
import { checkAiRateLimit, runAiParse } from '../ai.js';
import {
  assertAdmin,
  clearLoginFail,
  getLoginLock,
  getPinLength,
  registerLoginFail,
  savePin,
  signToken,
  verifyPin,
} from '../auth.js';
import { asyncHandler, HttpError } from '../http.js';
import { getSetting, setSetting } from '../settings.js';

const router = Router();

const PUBLIC_SETTINGS = ['store_name']; // hanya key ini yang boleh ditulis lewat entity "setting"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const queryString = (v: unknown): string | undefined =>
  Array.isArray(v) ? String(v[0]) : typeof v === 'string' ? v : undefined;

// ---------- Pemetaan data ----------
const toTx = (r: typeof transactions.$inferSelect) => ({
  id: r.id,
  no: r.no ?? undefined,
  date: r.date,
  description: r.description,
  accountId: r.accountId ?? '',
  type: r.type,
  category: r.category,
  amount: Number(r.amount) || 0,
  notes: r.notes ?? undefined,
  transferTargetAccountId: r.transferTargetAccountId ?? undefined,
  linkedTransactionId: r.linkedTransactionId ?? undefined,
  createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
});

const toAccount = (r: typeof accounts.$inferSelect) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  color: r.color || '#0284c7',
  iconName: r.iconName || 'Wallet',
  initialBalance: Number(r.initialBalance) || 0,
});

// Validasi + normalisasi satu transaksi dari body
function toRow(tx: any): typeof transactions.$inferInsert {
  const description = String(tx?.description ?? '').trim();
  const date = String(tx?.date ?? '');
  if (!tx?.id || !description || !DATE_RE.test(date) || !tx?.type) {
    throw new HttpError(400, 'Missing required fields: id, description, date, type.');
  }
  return {
    id: String(tx.id).slice(0, 64),
    no: tx.no ?? null,
    date,
    description: description.slice(0, 255),
    accountId: tx.accountId || 'cash',
    type: tx.type === 'masuk' ? 'masuk' : 'keluar',
    category: typeof tx.category === 'string' ? tx.category.slice(0, 50) : 'Toko',
    amount: Math.round(Number(tx.amount)) || 0,
    notes: tx.notes ?? null,
    transferTargetAccountId: tx.transferTargetAccountId ?? null,
    linkedTransactionId: tx.linkedTransactionId ?? null,
    createdAt: tx.createdAt ? new Date(tx.createdAt) : new Date(),
  };
}

// Upsert banyak transaksi sekaligus (satu perintah SQL per 200 baris)
async function upsertTransactions(rows: (typeof transactions.$inferInsert)[]) {
  const db = getDb();
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(transactions)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: transactions.id,
        set: {
          no: sql`excluded.no`,
          date: sql`excluded.date`,
          description: sql`excluded.description`,
          accountId: sql`excluded.account_id`,
          type: sql`excluded.type`,
          category: sql`excluded.category`,
          amount: sql`excluded.amount`,
          notes: sql`excluded.notes`,
          transferTargetAccountId: sql`excluded.transfer_target_account_id`,
          linkedTransactionId: sql`excluded.linked_transaction_id`,
        },
      });
  }
}

async function upsertAccount(acc: any) {
  if (!acc?.id || !acc?.name || !acc?.type) {
    throw new HttpError(400, 'Missing required fields: id, name, type.');
  }
  const row = {
    id: String(acc.id).slice(0, 50),
    name: String(acc.name).slice(0, 100),
    type: String(acc.type).slice(0, 20),
    color: acc.color || '#0284c7',
    iconName: acc.iconName || 'Wallet',
    initialBalance: Math.round(Number(acc.initialBalance)) || 0,
  };
  await getDb()
    .insert(accounts)
    .values(row)
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        name: row.name,
        type: row.type,
        color: row.color,
        iconName: row.iconName,
        initialBalance: row.initialBalance,
      },
    });
}

// ---------- GET: semua data sekaligus ----------
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const [txRows, accRows, catRows, storeName] = await Promise.all([
      db
        .select()
        .from(transactions)
        .orderBy(desc(transactions.date), sql`${transactions.no} DESC NULLS LAST`, desc(transactions.id)),
      db.select().from(accounts).orderBy(asc(accounts.id)),
      db.select({ name: categories.name }).from(categories).orderBy(asc(categories.createdAt), asc(categories.name)),
      getSetting('store_name'),
    ]);

    res.json({
      success: true,
      categories: catRows.map(c => c.name),
      storeName,
      transactions: txRows.map(toTx),
      accounts: accRows.map(toAccount),
    });
  })
);

// ---------- POST / PUT: semua jenis penyimpanan ----------
const writeHandler = asyncHandler(async (req, res) => {
  const body = req.body ?? {};
  const db = getDb();

  // Pencatatan otomatis dengan Gemini (terbuka untuk semua; non-admin dibatasi)
  if (body.entity === 'ai_parse') {
    if (!req.isAdmin) {
      const waitMinutes = await checkAiRateLimit();
      if (waitMinutes > 0) {
        throw new HttpError(429, `Pemakaian AI sedang dibatasi. Coba lagi ${waitMinutes} menit lagi.`);
      }
    }
    const items = await runAiParse({ text: body.text, imageBase64: body.imageBase64, mimeType: body.mimeType });
    return res.json({ success: true, transactions: items });
  }

  // Login / ganti PIN admin
  if (body.entity === 'auth') {
    if (body.action === 'pin_info') {
      return res.json({ success: true, length: await getPinLength() });
    }

    if (body.action === 'login') {
      const lockMinutes = await getLoginLock();
      if (lockMinutes > 0) {
        throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi ${lockMinutes} menit lagi.`);
      }
      if (!(await verifyPin(String(body.pin ?? '')))) {
        await registerLoginFail();
        throw new HttpError(403, 'PIN salah! Silakan periksa kembali PIN Anda.');
      }
      await clearLoginFail();
      return res.json({ success: true, token: signToken() });
    }

    if (body.action === 'change_pin') {
      assertAdmin(req);
      if (!(await verifyPin(String(body.currentPin ?? '')))) {
        throw new HttpError(403, 'PIN saat ini tidak cocok.');
      }
      if (!/^\d{4,8}$/.test(String(body.newPin ?? ''))) {
        throw new HttpError(400, 'PIN baru harus 4-8 digit angka.');
      }
      await savePin(String(body.newPin));
      return res.json({ success: true });
    }

    throw new HttpError(400, 'Aksi tidak dikenal.');
  }

  // Pengaturan (hanya admin, hanya key yang diizinkan)
  if (body.entity === 'setting' && body.key) {
    assertAdmin(req);
    if (!PUBLIC_SETTINGS.includes(body.key)) throw new HttpError(400, 'Pengaturan tidak diizinkan.');
    await setSetting(String(body.key), String(body.value ?? ''));
    return res.json({ success: true, key: body.key });
  }

  // Tambah 1 kategori (kasir boleh)
  if (body.entity === 'category' && body.name) {
    const name = String(body.name).trim().slice(0, 50);
    if (!name) throw new HttpError(400, 'Nama kategori kosong.');
    await db.insert(categories).values({ name }).onConflictDoNothing();
    return res.json({ success: true, name });
  }

  // Simpan 1 akun (hanya admin)
  if (body.entity === 'account' && body.account) {
    assertAdmin(req);
    await upsertAccount(body.account);
    return res.json({ success: true, id: body.account.id });
  }

  // Batch transaksi (dan akun)
  if (body.batch && Array.isArray(body.transactions)) {
    if (Array.isArray(body.accounts)) assertAdmin(req);

    const rows = body.transactions.map(toRow);
    if (rows.length === 0) return res.json({ success: true, count: 0 });

    if (!req.isAdmin) {
      // Kasir hanya boleh menambah transaksi baru, bukan menimpa yang lama
      const existing = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(inArray(transactions.id, rows.map(r => r.id)))
        .limit(1);
      if (existing.length > 0) assertAdmin(req);
    }

    if (Array.isArray(body.accounts)) {
      for (const acc of body.accounts) await upsertAccount(acc);
    }
    await upsertTransactions(rows);
    return res.json({ success: true, count: rows.length });
  }

  // Satu transaksi (tambah / edit)
  const row = toRow({ ...body, id: body.id || `tx-${Date.now()}` });
  if (!req.isAdmin) {
    const existing = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, row.id))
      .limit(1);
    if (existing.length > 0) assertAdmin(req); // kasir tidak boleh mengedit
  }
  await upsertTransactions([row]);
  return res.json({ success: true, id: row.id });
});

router.post('/', writeHandler);
router.put('/', writeHandler);

// ---------- DELETE: semua hapus hanya untuk admin ----------
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const db = getDb();
    const entity = queryString(req.query.entity);
    const id = queryString(req.query.id);

    if (entity === 'category') {
      const name = queryString(req.query.name);
      if (!name) throw new HttpError(400, 'Missing category name.');
      await db.batch([
        db.update(transactions).set({ category: '' }).where(eq(transactions.category, name)),
        db.delete(categories).where(eq(categories.name, name)),
      ]);
      return res.json({ success: true, deletedName: name });
    }

    if (entity === 'account') {
      if (!id) throw new HttpError(400, 'Missing account id.');
      await db.delete(accounts).where(eq(accounts.id, id));
      return res.json({ success: true, deletedId: id });
    }

    if (!id) throw new HttpError(400, 'Missing transaction id.');
    await db.delete(transactions).where(eq(transactions.id, id));
    return res.json({ success: true, deletedId: id });
  })
);

export default router;