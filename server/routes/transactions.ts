import { Router } from 'express';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../src/db/index.js';
import { accounts, categories, kantongs, transactions } from '../../src/db/schema.js';
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
import { ensureSchema } from '../ensureSchema.js';
import { asyncHandler, HttpError } from '../http.js';
import { getSetting, setSetting } from '../settings.js';

const router = Router();

const PUBLIC_SETTINGS = ['store_name', 'owner_name']; // hanya key ini yang boleh ditulis lewat entity "setting"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const queryString = (v: unknown): string | undefined =>
  Array.isArray(v) ? String(v[0]) : typeof v === 'string' ? v : undefined;

// ---------- Pemetaan data ----------
const toDateString = (d: any): string => {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

const toIsoString = (d: any): string | undefined => {
  if (!d) return undefined;
  if (d instanceof Date) return d.toISOString();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? String(d) : parsed.toISOString();
};

const isSpecialNonKantong = (v?: string | null) => {
  if (!v) return true;
  const s = v.trim();
  const lower = s.toLowerCase();
  return (
    s === '' ||
    s === '-' ||
    s === 'Pindah Saldo' ||
    s === 'Pindah Kantong' ||
    lower === 'lainnya' ||
    lower === 'lainya' ||
    lower === 'lain-lain' ||
    lower === 'lain nya'
  );
};

const toTx = (r: any) => {
  const rawCategory = typeof r.category === 'string' ? r.category.trim() : '';
  const rawKantong = typeof r.kantong === 'string' ? r.kantong.trim() : '';
  const resolvedKantong =
    rawKantong && rawKantong !== '-'
      ? rawKantong
      : !isSpecialNonKantong(rawCategory)
      ? rawCategory
      : undefined;

  return {
    id: r.id,
    no: r.no ?? undefined,
    date: toDateString(r.date),
    description: r.description ?? '',
    accountId: r.accountId ?? r.account_id ?? '',
    type: (r.type === 'masuk' ? 'masuk' : 'keluar') as 'masuk' | 'keluar',
    category: rawCategory,
    kantong: resolvedKantong,
    amount: Number(r.amount) || 0,
    notes: r.notes ?? undefined,
    catatan: r.notes ?? undefined,
    transferTargetAccountId: r.transferTargetAccountId ?? r.transfer_target_account_id ?? undefined,
    linkedTransactionId: r.linkedTransactionId ?? r.linked_transaction_id ?? undefined,
    createdAt: toIsoString(r.createdAt ?? r.created_at),
  };
};

const toAccount = (r: any) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  color: r.color || '#0284c7',
  iconName: r.iconName ?? r.icon_name ?? 'Wallet',
  initialBalance: Number(r.initialBalance ?? r.initial_balance) || 0,
});

// Validasi + normalisasi satu transaksi dari body
function toRow(tx: any): typeof transactions.$inferInsert {
  const description = String(tx?.description ?? '').trim();
  const date = String(tx?.date ?? '');
  if (!tx?.id || !description || !DATE_RE.test(date) || !tx?.type) {
    throw new HttpError(400, 'Missing required fields: id, description, date, type.');
  }
  const rawNotes = tx?.catatan !== undefined ? tx.catatan : tx?.notes;
  const notes = typeof rawNotes === 'string' && rawNotes.trim().length > 0 ? rawNotes.trim() : null;

  const rawCategory = typeof tx.category === 'string' ? tx.category.trim().slice(0, 50) : '';
  const rawKantong = typeof tx.kantong === 'string' ? tx.kantong.trim().slice(0, 50) : '';
  const category = rawCategory || rawKantong || '';
  const kantong =
    rawKantong && rawKantong !== '-'
      ? rawKantong
      : !isSpecialNonKantong(rawCategory)
      ? rawCategory
      : null;

  return {
    id: String(tx.id).slice(0, 64),
    no: tx.no ?? null,
    date,
    description: description.slice(0, 255),
    accountId: tx.accountId || 'cash',
    type: tx.type === 'masuk' ? 'masuk' : 'keluar',
    category,
    kantong,
    amount: Math.round(Number(tx.amount)) || 0,
    notes,
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
          kantong: sql`excluded.kantong`,
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
    res.set('Cache-Control', 'no-store, max-age=0');
    const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
    if (!url) {
      return res.json({
        success: false,
        databaseConnected: false,
        error: 'DATABASE_URL belum diisi. Menggunakan mode penyimpanan lokal.',
      });
    }
    await ensureSchema();
    const db = getDb();

    const loadAllFromDb = () =>
      Promise.all([
        db
          .select()
          .from(transactions)
          .orderBy(desc(transactions.date), sql`${transactions.no} DESC NULLS LAST`, desc(transactions.id)),
        db.select().from(accounts).orderBy(asc(accounts.id)),
        db.select({ name: categories.name }).from(categories).orderBy(asc(categories.createdAt), asc(categories.name)),
        db.select({ name: kantongs.name }).from(kantongs).orderBy(asc(kantongs.createdAt), asc(kantongs.name)),
        getSetting('store_name'),
        getSetting('owner_name'),
      ]);

    let txRows: any[] = [];
    let accRows: any[] = [];
    let catRows: { name: string }[] = [];
    let kantongRows: { name: string }[] = [];
    let storeName: string | null = null;
    let ownerName: string | null = null;

    try {
      [txRows, accRows, catRows, kantongRows, storeName, ownerName] = await loadAllFromDb();
    } catch (err) {
      console.warn('Query GET /api/transactions gagal, memperbaiki skema otomatis lalu mencoba fallback:', err);
      await ensureSchema(true);
      try {
        [txRows, accRows, catRows, kantongRows, storeName, ownerName] = await loadAllFromDb();
      } catch (fallbackErr) {
        console.warn('Menggunakan SELECT * fallback untuk kompatibilitas tabel Neon:', fallbackErr);
        const [rawTx, rawAcc, rawCat, rawKt, sName, oName] = await Promise.all([
          db.execute(sql`SELECT * FROM transactions ORDER BY date DESC, id DESC`).catch(() => ({ rows: [] })),
          db.execute(sql`SELECT * FROM accounts ORDER BY id ASC`).catch(() => ({ rows: [] })),
          db.execute(sql`SELECT name FROM categories ORDER BY name ASC`).catch(() => ({ rows: [] })),
          db.execute(sql`SELECT name FROM kantongs ORDER BY name ASC`).catch(() => ({ rows: [] })),
          getSetting('store_name'),
          getSetting('owner_name'),
        ]);
        txRows = (rawTx as any).rows ?? (Array.isArray(rawTx) ? rawTx : []);
        accRows = (rawAcc as any).rows ?? (Array.isArray(rawAcc) ? rawAcc : []);
        catRows = (rawCat as any).rows ?? (Array.isArray(rawCat) ? rawCat : []);
        kantongRows = (rawKt as any).rows ?? (Array.isArray(rawKt) ? rawKt : []);
        storeName = sName;
        ownerName = oName;
      }
    }

    const mappedTx = txRows.map(toTx);
    const categoryNames = catRows.map((c: any) => String(c.name || '').trim()).filter(Boolean);
    let kantongNames = kantongRows.map((k: any) => String(k.name || '').trim()).filter(Boolean);

    // Jika tabel kantongs masih kosong tetapi ada data dari skema lama (di categories / transactions),
    // gunakan daftar tersebut agar kantong lama langsung muncul tanpa tertimpa data dummy.
    if (kantongNames.length === 0) {
      const legacySet = new Set<string>();
      categoryNames.forEach(c => {
        if (!isSpecialNonKantong(c)) legacySet.add(c);
      });
      mappedTx.forEach(t => {
        if (t.kantong && !isSpecialNonKantong(t.kantong)) legacySet.add(t.kantong);
      });
      kantongNames = Array.from(legacySet);
    }

    res.json({
      success: true,
      categories: categoryNames,
      kantongs: kantongNames,
      storeName,
      ownerName,
      transactions: mappedTx,
      accounts: accRows.map(toAccount),
    });
  })
);

// ---------- POST / PUT: semua jenis penyimpanan ----------
const writeHandler = asyncHandler(async (req, res) => {
  const body = req.body ?? {};

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

  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    return res.json({
      success: false,
      databaseConnected: false,
      error: 'DATABASE_URL belum diisi. Menggunakan mode penyimpanan lokal.',
    });
  }

  await ensureSchema();
  const db = getDb();

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

  // Tambah 1 kantong (kasir boleh)
  if (body.entity === 'kantong' && body.name) {
    const name = String(body.name).trim().slice(0, 50);
    if (!name) throw new HttpError(400, 'Nama kantong kosong.');
    await db.insert(kantongs).values({ name }).onConflictDoNothing();
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
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
    if (!url) {
      return res.json({
        success: false,
        databaseConnected: false,
        error: 'DATABASE_URL belum diisi. Menggunakan mode penyimpanan lokal.',
      });
    }
    await ensureSchema();
    const id = req.params.id;
    const body = req.body ?? {};
    const row = toRow({ ...body, id });
    await upsertTransactions([row]);
    return res.json({ success: true, id: row.id, transaction: toTx(row as any) });
  })
);

// ---------- DELETE: semua hapus hanya untuk admin ----------
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
    if (!url) {
      return res.json({
        success: false,
        databaseConnected: false,
        error: 'DATABASE_URL belum diisi. Menggunakan mode penyimpanan lokal.',
      });
    }
    await ensureSchema();
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

    if (entity === 'kantong') {
      const name = queryString(req.query.name);
      if (!name) throw new HttpError(400, 'Missing kantong name.');
      await db.batch([
        db.update(transactions).set({ kantong: null }).where(eq(transactions.kantong, name)),
        db.delete(kantongs).where(eq(kantongs.name, name)),
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