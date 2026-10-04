// server.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GoogleGenAI } from '@google/genai';
import * as repo from './src/db/repo.ts';
import { schema } from './src/db/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ============================================
// KONSTANTA & KEAMANAN ADMIN (PIN & TOKEN)
// ============================================

const DEFAULT_PIN = '1234';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000; // 5 menit
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const getSecret = () =>
  process.env.AUTH_SECRET || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || 'dompet-jeres-secret-key';

function signToken(): string {
  const expiry = String(Date.now() + TOKEN_TTL_MS);
  const sig = createHmac('sha256', getSecret()).update(expiry).digest('hex');
  return `${expiry}.${sig}`;
}

function verifyToken(token?: string): boolean {
  if (!token) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  const expected = createHmac('sha256', getSecret()).update(expiry).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expiry) > Date.now();
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString('hex');
}

async function verifyPin(pin: string): Promise<boolean> {
  const row = await repo.getSetting('admin_pin');
  if (!row) return pin === DEFAULT_PIN;
  const [salt, hash] = String(row).split(':');
  if (!salt || !hash) return pin === DEFAULT_PIN;
  const a = Buffer.from(hashPin(pin, salt));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function savePin(pin: string) {
  const salt = randomBytes(16).toString('hex');
  const value = `${salt}:${hashPin(pin, salt)}`;
  await repo.setSetting('admin_pin', value);
  await repo.setSetting('admin_pin_len', String(pin.length));
}

async function getLoginLock(): Promise<number> {
  const row = await repo.getSetting('login_fail');
  if (!row) return 0;
  const [count, ts] = String(row).split(':').map(Number);
  if (count >= MAX_FAILS) {
    const remaining = ts + LOCK_MS - Date.now();
    if (remaining > 0) return Math.ceil(remaining / 60000);
  }
  return 0;
}

async function registerLoginFail() {
  const row = await repo.getSetting('login_fail');
  let count = 0;
  if (row) {
    const [c, ts] = String(row).split(':').map(Number);
    count = Date.now() - ts > LOCK_MS ? 0 : c;
  }
  const value = `${count + 1}:${Date.now()}`;
  await repo.setSetting('login_fail', value);
}

async function clearLoginFail() {
  await repo.deleteSetting('login_fail');
}

// Inisialisasi basis data saat server start
repo.ensureDatabaseTables();

// ============================================
// GEMINI AI PROMPTS
// ============================================

const CATEGORY_HINTS = [
  { category: 'Kendaraan', examples: 'bensin, pertalite, pertamax, servis, oli, parkir, tol' },
  { category: 'Pokok', examples: 'listrik, token, wifi, pdam, sembako, beras, kontrakan' },
  { category: 'Bangun Rumah', examples: 'semen, pasir, batu bata, cat, keramik, tukang, material' },
  { category: 'Pribadi', examples: 'makan, bakso, jajan, kopi, rokok, obat' },
  { category: 'Operasional Toko', examples: 'stiker, banner, kertas, tinta, plastik, ongkir' },
  { category: 'Toko', examples: 'pemasukan toko, penjualan, omset' },
  { category: 'Pemasukan Toko', examples: 'pemasukan toko, penjualan, omset' },
];

function buildAiPrompt(accounts: any[], categories: string[], today: string, hasImage: boolean): string {
  const accountList = accounts.map(a => `- id "${a.id}" = ${a.name} (${a.type})`).join('\n');
  const categoryList = categories.length > 0 ? categories.map(c => `- ${c}`).join('\n') : '- (belum ada kategori)';
  const hints = CATEGORY_HINTS.filter(h => categories.some(c => c.toLowerCase() === h.category.toLowerCase()))
    .map(h => `- ${h.category}: ${h.examples}`)
    .join('\n');

  return [
    `Kamu adalah asisten pembukuan toko kecil di Indonesia. Ubah ${hasImage ? 'foto struk/nota/catatan dan/atau teks' : 'teks'} yang diberikan menjadi daftar transaksi keuangan.`,
    '',
    `Tanggal hari ini: ${today} (zona waktu WIB).`,
    '',
    'DAFTAR AKUN (accountId HARUS salah satu id ini):',
    accountList,
    '',
    'DAFTAR KATEGORI (prioritaskan dari daftar ini jika sesuai; jika transaksi memiliki konteks spesifik seperti "Angsur Tanah", "Cicilan", "Sewa", "Gaji", dll., kamu BOLEH membuat kategori baru yang singkat dan jelas 1-3 kata):',
    categoryList,
    hints ? `\nKebiasaan pengguna (kata kunci -> kategori):\n${hints}` : '',
    '',
    'ATURAN:',
    '1. Satu transaksi per kejadian uang masuk/keluar. Satu baris teks biasanya satu transaksi.',
    '2. amount = bilangan bulat Rupiah tanpa titik/koma. "30rb"=30000, "1,5jt"=1500000, "125.000"=125000.',
    '3. type: "keluar" untuk belanja, bayar, beli, tagihan; "masuk" untuk pemasukan, penjualan, terima.',
    '4. accountId: cocokkan nama akun yang disebut. Jika tidak disebut, pakai akun cash.',
    '5. date: format YYYY-MM-DD. Pakai tanggal pada teks; jika tidak ada, pakai tanggal hari ini.',
    '6. description: singkat dan jelas, huruf awal kapital.',
    '7. Pemindahan saldo (mis. "pindah 50rb dari seabank ke cash"): accountId = akun asal, transferToAccountId = akun tujuan, type "keluar", category "Pindah Saldo".',
    hasImage
      ? '8. Jika struk belanja: buat SATU transaksi dengan total akhir. Jika catatan/screenshot chat: buat SATU transaksi per baris.'
      : '',
    '9. Jika tidak ada transaksi yang bisa dibaca, kembalikan array kosong [].',
  ].join('\n');
}

function extractJSON(raw: string): any | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {}
  }
  const arr = trimmed.match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      return JSON.parse(arr[0]);
    } catch {}
  }
  return null;
}

// ============================================
// ENDPOINTS: WARMUP & HEALTH
// ============================================

app.get('/api/warmup', (req: Request, res: Response) => {
  return res.status(200).json({ status: 'warm', timestamp: new Date().toISOString() });
});

// ============================================
// ENDPOINTS: TRANSAKSI & CORE KEUANGAN
// ============================================

// A. GET /api/transactions
app.get('/api/transactions', async (req: Request, res: Response) => {
  try {
    const [accounts, transactions, categories, storeName] = await Promise.all([
      repo.getAccounts(),
      repo.getTransactions(),
      repo.getCategories(),
      repo.getSetting('store_name'),
    ]);

    return res.status(200).json({
      success: true,
      accounts,
      transactions,
      categories,
      storeName: storeName || 'JERES STUDIO',
    });
  } catch (err: any) {
    console.error('GET /api/transactions error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
});

// B. POST /api/transactions
app.post('/api/transactions', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-admin-token'] as string | undefined;
    const isAdmin = verifyToken(token);
    const body = req.body || {};

    // 1. Entity: AI Parse Transaksi
    if (body.entity === 'ai_parse') {
      if (!isAdmin) {
        return res.status(401).json({ success: false, error: 'Akses ditolak. Token admin diperlukan.' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ success: false, error: 'GEMINI_API_KEY belum diset.' });
      }

      const { text, imageBase64, mimeType } = body;
      const [accounts, categories] = await Promise.all([
        repo.getAccounts(),
        repo.getCategories(),
      ]);

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const promptText = buildAiPrompt(accounts, categories, today, Boolean(imageBase64));

      const parts: any[] = [];
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: mimeType || 'image/jpeg',
            data: String(imageBase64).replace(/^data:[^;]+;base64,/, ''),
          },
        });
      }
      parts.push({ text: promptText });
      if (text && text.trim()) {
        parts.push({ text: `TEKS:\n"""\n${text.trim()}\n"""` });
      }

      const ai = new GoogleGenAI({ apiKey });
      const aiRes = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts },
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const raw = aiRes.text || '';
      const parsed = extractJSON(raw);
      let list = Array.isArray(parsed) ? parsed : parsed?.transactions || [];

      return res.status(200).json({
        success: true,
        transactions: list,
      });
    }

    // 2. Entity: Auth Admin
    if (body.entity === 'auth') {
      const { action, pin, currentPin, newPin } = body;

      if (action === 'login') {
        const lockMins = await getLoginLock();
        if (lockMins > 0) {
          return res.status(429).json({
            success: false,
            error: `Terlalu banyak percobaan salah. Coba lagi dalam ${lockMins} menit.`,
          });
        }

        const valid = await verifyPin(String(pin || ''));
        if (!valid) {
          await registerLoginFail();
          return res.status(401).json({ success: false, error: 'PIN Admin salah.' });
        }

        await clearLoginFail();
        return res.status(200).json({ success: true, token: signToken() });
      }

      if (action === 'change_pin') {
        if (!isAdmin) {
          return res.status(401).json({ success: false, error: 'Sesi admin berakhir. Masukkan PIN lama.' });
        }
        const valid = await verifyPin(String(currentPin || ''));
        if (!valid) {
          return res.status(400).json({ success: false, error: 'PIN lama tidak sesuai.' });
        }
        await savePin(String(newPin || ''));
        return res.status(200).json({ success: true });
      }

      if (action === 'pin_info') {
        const lenStr = await repo.getSetting('admin_pin_len');
        const len = lenStr ? parseInt(lenStr, 10) : 4;
        return res.status(200).json({ success: true, length: len || 4 });
      }
    }

    // 3. Entity: Setting
    if (body.entity === 'setting') {
      if (!isAdmin) {
        return res.status(401).json({ success: false, error: 'Akses ditolak.' });
      }
      await repo.setSetting(body.key, String(body.value));
      return res.status(200).json({ success: true });
    }

    // 4. Entity: Category
    if (body.entity === 'category') {
      if (!isAdmin) {
        return res.status(401).json({ success: false, error: 'Akses ditolak.' });
      }
      const catName = String(body.name || '').trim();
      if (!catName) {
        return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });
      }
      await repo.addCategory(catName);
      return res.status(200).json({ success: true });
    }

    // 5. Entity: Account
    if (body.entity === 'account') {
      if (!isAdmin) {
        return res.status(401).json({ success: false, error: 'Akses ditolak.' });
      }
      const acc = body.account;
      await repo.saveAccount({
        id: acc.id,
        name: acc.name,
        type: acc.type,
        color: acc.color || '#0284c7',
        iconName: acc.iconName || 'Wallet',
        initialBalance: Number(acc.initialBalance) || 0,
      });
      return res.status(200).json({ success: true });
    }

    // 6. Entity: Batch Transactions & Accounts
    if (body.batch === true && Array.isArray(body.transactions)) {
      if (!isAdmin) {
        return res.status(401).json({ success: false, error: 'Akses ditolak.' });
      }
      await repo.saveTransactions(body.transactions);
      return res.status(200).json({ success: true });
    }

    // 7. Single Transaction Save / Update
    const tx = body;
    if (!tx.id || !tx.description || !tx.amount) {
      return res.status(400).json({ success: false, error: 'Data transaksi tidak lengkap.' });
    }

    await repo.saveTransaction({
      id: tx.id,
      no: tx.no || null,
      date: tx.date,
      description: tx.description,
      accountId: tx.accountId || '',
      type: tx.type,
      category: tx.category,
      amount: Number(tx.amount) || 0,
      notes: tx.notes || null,
      transferTargetAccountId: tx.transferTargetAccountId || null,
      linkedTransactionId: tx.linkedTransactionId || null,
    });

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('POST /api/transactions error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
});

// C. DELETE /api/transactions
app.delete('/api/transactions', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-admin-token'] as string | undefined;
    if (!verifyToken(token)) {
      return res.status(401).json({ success: false, error: 'Akses ditolak. Token admin diperlukan.' });
    }

    const { id, entity, name, clearAll } = req.query as {
      id?: string;
      entity?: string;
      name?: string;
      clearAll?: string;
    };

    if (clearAll === 'true') {
      await repo.clearAllTransactions();
      return res.status(200).json({ success: true });
    }

    if (entity === 'account' && id) {
      await repo.deleteAccount(id);
      return res.status(200).json({ success: true });
    }

    if (entity === 'category' && name) {
      await repo.deleteCategory(name);
      return res.status(200).json({ success: true });
    }

    if (id) {
      await repo.deleteTransaction(id);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'Parameter tidak lengkap.' });
  } catch (err: any) {
    console.error('DELETE /api/transactions error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
});

// ============================================
// ENDPOINTS: UTANG & PIUTANG
// ============================================

// D. GET /api/debts
app.get('/api/debts', async (req: Request, res: Response) => {
  try {
    const debts = await repo.getDebts();
    return res.status(200).json({ success: true, debts });
  } catch (err: any) {
    console.error('GET /api/debts error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
});

// E. POST /api/debts
app.post('/api/debts', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-admin-token'] as string | undefined;
    if (!verifyToken(token)) {
      return res.status(401).json({ success: false, error: 'Akses ditolak. Token admin diperlukan.' });
    }

    const { action, payload } = req.body || {};

    if (action === 'saveDebt') {
      await repo.saveDebt(payload);
      return res.status(200).json({ success: true });
    }

    if (action === 'deleteDebt') {
      await repo.deleteDebt(payload.id);
      return res.status(200).json({ success: true });
    }

    if (action === 'savePayment') {
      await repo.saveDebtPayment(payload);
      return res.status(200).json({ success: true });
    }

    if (action === 'deletePayment') {
      await repo.deleteDebtPayment(payload.id);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'Aksi tidak dikenal.' });
  } catch (err: any) {
    console.error('POST /api/debts error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
});

// F. POST /api/ai-parse-debt
app.post('/api/ai-parse-debt', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY belum diset.' });
    }

    const { text, imageBase64, mimeType } = req.body || {};
    if (!text && !imageBase64) {
      return res.status(400).json({ success: false, error: 'Teks atau gambar wajib dikirim.' });
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const promptText = `Tugas: ekstrak data utang/piutang dari teks/nota menjadi JSON.
Tanggal hari ini: ${today}.
Format JSON:
{"debts":[{
  "type":"utang"|"piutang",
  "name":"string",
  "counterparty":"string",
  "totalAmount":number,
  "startDate":"YYYY-MM-DD",
  "dueDate":"YYYY-MM-DD"|null,
  "installmentAmount":number|null,
  "installmentPeriod":number|null,
  "notes":"string"|null,
  "payments":[{"date":"YYYY-MM-DD","amount":number,"notes":"string"}]
}]}
Aturan: "utang"=saya pinjam ke orang lain, "piutang"=orang pinjam ke saya. Balas HANYA JSON.`;

    const parts: any[] = [];
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: String(imageBase64).replace(/^data:[^;]+;base64,/, ''),
        },
      });
    }
    parts.push({ text: promptText });
    if (text && text.trim()) {
      parts.push({ text: `TEKS:\n"""\n${text.trim()}\n"""` });
    }

    const ai = new GoogleGenAI({ apiKey });
    const aiRes = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const raw = aiRes.text || '';
    const parsed = extractJSON(raw);
    const debts = (parsed?.debts || (Array.isArray(parsed) ? parsed : [])).map((d: any) => ({
      type: d.type === 'piutang' ? 'piutang' : 'utang',
      name: String(d.name || '').trim(),
      counterparty: String(d.counterparty || '').trim(),
      totalAmount: Math.abs(Number(d.totalAmount) || 0),
      startDate: d.startDate || today,
      dueDate: d.dueDate || undefined,
      installmentAmount: d.installmentAmount ? Math.abs(Number(d.installmentAmount)) : undefined,
      installmentPeriod: d.installmentPeriod ? Number(d.installmentPeriod) : undefined,
      notes: d.notes || undefined,
      payments: (d.payments || []).map((p: any) => ({
        date: p.date || today,
        amount: Math.abs(Number(p.amount) || 0),
        notes: p.notes || undefined,
      })),
    }));

    return res.status(200).json({ success: true, debts });
  } catch (err: any) {
    console.error('POST /api/ai-parse-debt error:', err);
    return res.status(500).json({ success: false, error: err.message || 'AI Parse error' });
  }
});

// ============================================
// ENDPOINTS: BUKU TAHUNAN & TUTUP BUKU
// ============================================

app.get('/api/yearly', async (req: Request, res: Response) => {
  try {
    const yearQuery = req.query.year;

    if (yearQuery) {
      const archive = await repo.getYearlyArchives(Number(yearQuery));
      if (!archive || Array.isArray(archive)) {
        return res.status(404).json({ success: false, error: 'Arsip tahun tidak ditemukan.' });
      }
      return res.status(200).json({
        success: true,
        archive,
      });
    }

    const archives = (await repo.getYearlyArchives()) as any[];
    return res.status(200).json({
      success: true,
      archives: (archives || []).map(r => ({
        id: r.id,
        year: r.year,
        transactionCount: r.transactionCount,
        createdAt: r.createdAt,
      })),
    });
  } catch (err: any) {
    console.error('GET /api/yearly error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
});

app.post('/api/yearly', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-admin-token'] as string | undefined;
    const isAdmin = verifyToken(token);
    const { action, year, confirmText } = req.body || {};
    const targetYear = Number(year);

    if (!targetYear || isNaN(targetYear)) {
      return res.status(400).json({ success: false, error: 'Tahun tidak valid.' });
    }

    // 1. Preview Tutup Buku
    if (action === 'previewCloseBook') {
      const yearStr = String(targetYear);
      const [txRows, accRows, catNames, debtRows] = await Promise.all([
        repo.getTransactions(),
        repo.getAccounts(),
        repo.getCategories(),
        repo.getDebts(),
      ]);

      const txThisYear = txRows.filter(t => t.date && t.date.startsWith(yearStr));

      const accMap: Record<string, number> = {};
      accRows.forEach(a => {
        accMap[a.id] = Number(a.initialBalance) || 0;
      });

      const catMap: Record<string, number> = {};
      catNames.forEach(c => {
        catMap[c] = 0;
      });

      txThisYear.forEach(t => {
        const amt = Number(t.amount) || 0;
        const isCat = t.id.startsWith('kt-');
        const isAcc = t.category === 'Pindah Saldo';

        if (!isCat && t.accountId && accMap[t.accountId] !== undefined) {
          if (t.type === 'masuk') accMap[t.accountId] += amt;
          else accMap[t.accountId] -= amt;
        }

        if (!isAcc && t.category) {
          if (catMap[t.category] === undefined) catMap[t.category] = 0;
          if (t.type === 'masuk') catMap[t.category] += amt;
          else catMap[t.category] -= amt;
        }
      });

      const unpaidDebts: { id: string; name: string; remaining: number }[] = [];
      debtRows.forEach(d => {
        const total = Number(d.totalAmount) || 0;
        const paid = (d.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const remaining = total - paid;
        if (remaining > 0 && !d.archivedAt) {
          unpaidDebts.push({ id: d.id, name: d.name, remaining });
        }
      });

      return res.status(200).json({
        success: true,
        preview: {
          transactionCount: txThisYear.length,
          accountBalances: accRows.map(a => ({ accountId: a.id, name: a.name, balance: accMap[a.id] ?? 0 })),
          pocketBalances: Object.entries(catMap).map(([category, balance]) => ({ category, balance })),
          unpaidDebts,
        },
      });
    }

    if (!isAdmin) {
      return res.status(401).json({ success: false, error: 'Akses ditolak. Token admin diperlukan.' });
    }

    // 2. Eksekusi Tutup Buku
    if (action === 'executeCloseBook') {
      const expectedConfirm = `TUTUP BUKU ${targetYear}`;
      if (confirmText !== expectedConfirm) {
        return res.status(400).json({
          success: false,
          error: `Teks konfirmasi salah. Harap ketik "${expectedConfirm}" secara persis.`,
        });
      }

      const yearStr = String(targetYear);
      const [txRows, accRows, catNames, debtRows] = await Promise.all([
        repo.getTransactions(),
        repo.getAccounts(),
        repo.getCategories(),
        repo.getDebts(),
      ]);

      const txThisYear = txRows.filter(t => t.date && t.date.startsWith(yearStr));

      const accMap: Record<string, number> = {};
      accRows.forEach(a => {
        accMap[a.id] = Number(a.initialBalance) || 0;
      });

      const catMap: Record<string, number> = {};
      catNames.forEach(c => {
        catMap[c] = 0;
      });

      let totalMasuk = 0;
      let totalKeluar = 0;

      txThisYear.forEach(t => {
        const amt = Number(t.amount) || 0;
        const isCat = t.id.startsWith('kt-');
        const isAcc = t.category === 'Pindah Saldo';

        if (!isCat && t.accountId && accMap[t.accountId] !== undefined) {
          if (t.type === 'masuk') accMap[t.accountId] += amt;
          else accMap[t.accountId] -= amt;
        }

        if (!isAcc && t.category) {
          if (catMap[t.category] === undefined) catMap[t.category] = 0;
          if (t.type === 'masuk') catMap[t.category] += amt;
          else catMap[t.category] -= amt;
        }

        if (!isCat && !isAcc) {
          if (t.type === 'masuk') totalMasuk += amt;
          else totalKeluar += amt;
        }
      });

      const archivePayload = {
        id: `archive-${targetYear}-${Date.now()}`,
        year: targetYear,
        transactionCount: txThisYear.length,
        createdAt: new Date().toISOString(),
        data: {
          transactions: txThisYear,
          accounts: accRows,
          categories: catNames,
          debts: debtRows,
          summary: {
            totalMasuk,
            totalKeluar,
            sisa: totalMasuk - totalKeluar,
          },
        },
      };

      const accountBalances = accRows.map(a => ({ accountId: a.id, balance: accMap[a.id] ?? 0 }));
      const pocketBalances = Object.entries(catMap).map(([category, balance]) => ({ category, balance }));

      await repo.executeCloseBook(targetYear, archivePayload, accountBalances, pocketBalances);

      return res.status(200).json({
        success: true,
        archive: archivePayload,
      });
    }

    // 3. Restore Tutup Buku
    if (action === 'restoreCloseBook') {
      const archive = await repo.getYearlyArchives(targetYear);
      if (!archive || Array.isArray(archive)) {
        return res.status(404).json({ success: false, error: 'Data arsip tahun ini tidak ditemukan.' });
      }

      const txs = archive.data?.transactions || [];
      const restoredCount = await repo.restoreCloseBook(targetYear, txs);

      return res.status(200).json({ success: true, restoredCount });
    }

    return res.status(400).json({ success: false, error: 'Aksi tidak dikenal.' });
  } catch (err: any) {
    console.error('POST /api/yearly error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
});

// ============================================
// FRONTEND STATIC / VITE INTEGRATION
// ============================================

async function setupFrontend() {
  if (process.env.NODE_ENV !== 'production') {
    // Mode Development: jalankan Vite middleware
    try {
      const { createServer } = await import('vite');
      const vite = await createServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('⚡ Vite dev server middleware mounted');
    } catch (e) {
      console.warn('Vite dev middleware not loaded:', e);
    }
  } else {
    // Mode Production: layani file statis dari folder dist
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

setupFrontend();

// Jalankan HTTP Server bila dijalankan langsung
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Server Dompet Jeres aktif di port ${PORT}`);
  });
}

export default app;
