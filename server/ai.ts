import { GoogleGenAI, Type } from '@google/genai';
import { asc } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';
import { accounts, categories, kantongs } from '../src/db/schema.js';
import { INITIAL_KANTONG, INITIAL_CATEGORIES } from '../src/data/initialData.js';
import { HttpError } from './http.js';
import { getSetting, setSetting } from './settings.js';

// Batas pemakaian untuk non-admin: 30 permintaan per jam (seluruh pengguna). Ubah angkanya sesuai kebutuhan.
const AI_LIMIT_PER_HOUR = 30;
const AI_WINDOW_MS = 60 * 60 * 1000;

// Mencatat satu pemakaian. Mengembalikan sisa menit jika batas tercapai, 0 jika boleh lanjut
export async function checkAiRateLimit(): Promise<number> {
  const raw = await getSetting('ai_usage');
  let count = 0;
  let start = Date.now();
  if (raw) {
    const [c, s] = raw.split(':').map(Number);
    if (Date.now() - s < AI_WINDOW_MS) {
      count = c;
      start = s;
    }
  }
  if (count >= AI_LIMIT_PER_HOUR) {
    return Math.max(1, Math.ceil((start + AI_WINDOW_MS - Date.now()) / 60000));
  }
  await setSetting('ai_usage', `${count + 1}:${start}`);
  return 0;
}

// Kebiasaan pencatatan (dipakai hanya jika kantong/kategorinya memang ada di daftar pengguna)
const CATEGORY_HINTS: { category: string; examples: string }[] = [
  { category: 'Kendaraan', examples: 'bensin, pertalite, pertamax, servis, oli, parkir, tol' },
  { category: 'Pokok', examples: 'listrik, token, wifi, pdam, sembako, beras, kontrakan' },
  { category: 'Bangun Rumah', examples: 'semen, pasir, batu bata, cat, keramik, tukang, material' },
  { category: 'Pribadi', examples: 'makan, bakso, jajan, kopi, rokok, obat' },
  { category: 'Operasional Toko', examples: 'stiker, banner, kertas, tinta, plastik, ongkir' },
  { category: 'Toko', examples: 'pemasukan toko, penjualan, omset' },
  { category: 'Pemasukan Toko', examples: 'pemasukan toko, penjualan, omset' },
];

const isExcludedName = (name?: string) => {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  return (
    lower === '' ||
    lower === '-' ||
    lower === 'lainnya' ||
    lower === 'lainya' ||
    lower === 'lain-lain' ||
    lower === 'lain nya' ||
    lower === 'pindah saldo' ||
    lower === 'pindah kantong'
  );
};

function buildAiPrompt(
  accountRows: { id: string; name: string; type: string }[],
  kantongNames: string[],
  categoryNames: string[],
  today: string,
  hasImage: boolean
): string {
  const accountList = accountRows.map(a => `- id "${a.id}" = ${a.name} (${a.type})`).join('\n');
  const kantongList =
    kantongNames.length > 0 ? kantongNames.map(k => `- ${k}`).join('\n') : '- (belum ada kantong)';
  const categoryList =
    categoryNames.length > 0 ? categoryNames.map(c => `- ${c}`).join('\n') : '- (belum ada kategori)';

  const allKnown = [...kantongNames, ...categoryNames];
  const hints = CATEGORY_HINTS.filter(h => allKnown.some(c => c.toLowerCase() === h.category.toLowerCase()))
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
    'DAFTAR KANTONG (Pos Anggaran) PENGGUNA:',
    kantongList,
    '',
    'DAFTAR KATEGORI PENGGUNA:',
    categoryList,
    hints ? `\nKebiasaan pengguna (kata kunci -> kantong/kategori):\n${hints}` : '',
    '',
    'ATURAN UTAMA:',
    '1. kantong WAJIB persis salah satu dari DAFTAR KANTONG (Pos Anggaran) di atas. Jika tidak ada yang cocok, isi "" (kosong).',
    '2. category WAJIB persis salah satu dari DAFTAR KATEGORI di atas. Jika tidak ada yang cocok, isi "" (kosong).',
    '3. Struk belanja = type "keluar". Kantong/Kategori "Pemasukan Toko" (atau omset/pendapatan) HANYA untuk type "masuk". DILARANG memakai "Pemasukan Toko" pada belanja atau pengeluaran.',
    '4. description (Nama / Judul): jika struk berisi banyak barang, tulis "Belanja <nama toko>" (contoh "Belanja Karis Jaya Shop") atau nama belanja utama. Jika hanya 1 barang, tulis nama barang beserta jumlahnya (contoh "1 Sak Semen Singa Merah").',
    '5. notes (Catatan): WAJIB isi otomatis HANYA dengan rincian setiap nama item belanja beserta rincian qty x harga satuan dan subtotal per item (contoh: "1. Indomie Goreng (1 lusin x 36.000 = Rp 36.000), 2. Fruit Tea Apple (1 500 ml x 7.000 = Rp 7.000), 3. Belfood Sosis Bakar (1 x 27.000 = Rp 27.000)"). DILARANG mengisi nomor nota (seperti No.0-3), nomor referensi, alamat toko, nama kasir, atau teks lain selain rincian item & harganya. Jika input hanya 1 item singkat tanpa rincian beberapa barang, boleh tulis rincian item & harganya atau "".',
    '6. Satu transaksi per kejadian uang masuk/keluar. Satu baris teks biasanya satu transaksi. Abaikan teks yang bukan transaksi (sapaan, saldo akhir, nomor referensi, promo).',
    '7. amount (Nominal Rp) = bilangan bulat Rupiah tanpa titik/koma. "30rb" atau "30k" = 30000, "1,5jt" = 1500000, "125.000" = 125000, "Rp 2.500.000,00" = 2500000. Untuk notifikasi bank, pakai nominal transaksi, bukan saldo.',
    '8. type: "keluar" untuk belanja, bayar, beli, tagihan, ongkir; "masuk" untuk pemasukan, penjualan, omset, terima, gaji. Jika ragu, pilih "keluar".',
    '9. accountId: cocokkan nama atau alias yang disebut (mis. "tunai" = akun Cash, "spay" = ShopeePay). Jika tidak disebut, pakai akun bertipe cash; jika tidak ada, akun pertama.',
    `10. date: format YYYY-MM-DD. Pakai tanggal pada teks/struk; "kemarin" = sehari sebelum tanggal hari ini. Jika tahun tidak tertulis, pakai tahun ${today.slice(0, 4)}. Jika tanggal tidak ada, pakai tanggal hari ini.`,
    '11. Pemindahan saldo antar akun (mis. "pindah 50rb dari seabank ke cash"): SATU entri dengan accountId = akun asal, transferToAccountId = akun tujuan, type "keluar", category "Pindah Saldo", kantong "". Untuk transaksi biasa, transferToAccountId = "".',
    hasImage
      ? '12. Jika gambar adalah catatan atau daftar banyak baris bertanggal (mis. screenshot catatan): buat SATU transaksi per baris. Jika struk belanja: buat SATU transaksi "keluar" dengan total akhir yang dibayar.'
      : '',
    '13. Jika tidak ada transaksi yang bisa dibaca, kembalikan array kosong [].',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface AiInput {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRetiredModel = (modelName: string) =>
  !modelName ||
  modelName.includes('1.5') ||
  modelName.includes('2.0') ||
  modelName === 'gemini-2.5-flash' ||
  modelName === 'gemini-2.5-flash-lite' ||
  modelName === 'gemini-pro';

function getModelCandidates(): string[] {
  const customPrimary = process.env.GEMINI_MODEL?.trim() || '';
  const customFallbacks = (process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const defaults = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  const all = [
    ...(!isRetiredModel(customPrimary) ? [customPrimary] : []),
    ...defaults,
    ...customFallbacks.filter(m => !isRetiredModel(m)),
  ];
  return Array.from(new Set(all));
}

export async function runAiParse(input: AiInput) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new HttpError(500, 'GEMINI_API_KEY belum diisi di server.');

  const text = String(input.text || '').slice(0, 8000);
  const imageBase64 = String(input.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
  const mimeType = String(input.mimeType || 'image/jpeg');

  if (!text.trim() && !imageBase64) throw new HttpError(400, 'Teks atau foto wajib diisi.');
  if (imageBase64.length > 4000000) throw new HttpError(413, 'Foto terlalu besar.');
  if (imageBase64 && !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new HttpError(400, 'Format foto harus JPG, PNG, atau WEBP.');
  }

  let accountRows = [
    { id: 'cash', name: 'Cash', type: 'cash' },
    { id: 'dana', name: 'Dana', type: 'ewallet' },
    { id: 'seabank', name: 'Seabank', type: 'bank' },
    { id: 'shoopepay', name: 'Shoopepay', type: 'ewallet' },
  ];
  let kantongNames = INITIAL_KANTONG.filter(k => !isExcludedName(k));
  let categoryNames = INITIAL_CATEGORIES.filter(c => !isExcludedName(c));

  const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (dbUrl) {
    try {
      const db = getDb();
      const [a, k, c] = await Promise.all([
        db.select({ id: accounts.id, name: accounts.name, type: accounts.type }).from(accounts).orderBy(asc(accounts.id)),
        db.select({ name: kantongs.name }).from(kantongs).orderBy(asc(kantongs.name)).catch(() => []),
        db.select({ name: categories.name }).from(categories).orderBy(asc(categories.name)).catch(() => []),
      ]);
      if (a.length > 0) accountRows = a;

      const dbKantongs = k.map(r => r.name?.trim()).filter(n => !isExcludedName(n));
      const dbCategories = c.map(r => r.name?.trim()).filter(n => !isExcludedName(n));

      if (dbKantongs.length > 0) {
        kantongNames = Array.from(new Set(dbKantongs));
      } else if (dbCategories.length > 0) {
        kantongNames = Array.from(new Set(dbCategories));
      }

      if (dbCategories.length > 0) {
        categoryNames = Array.from(new Set([...dbCategories, ...INITIAL_CATEGORIES.filter(x => !isExcludedName(x))]));
      }
    } catch (e) {
      console.warn('Gagal membaca akun/kantong dari DB untuk AI, menggunakan default:', e);
    }
  }

  const accountIds = accountRows.map(a => a.id);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  const parts: any[] = [{ text: buildAiPrompt(accountRows, kantongNames, categoryNames, today, Boolean(imageBase64)) }];
  if (text.trim()) parts.push({ text: `TEKS INPUT:\n${text}` });
  if (imageBase64) parts.push({ inlineData: { mimeType, data: imageBase64 } });

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING },
        description: { type: Type.STRING },
        accountId: { type: Type.STRING, enum: accountIds },
        type: { type: Type.STRING, enum: ['masuk', 'keluar'] },
        kantong: { type: Type.STRING },
        category: { type: Type.STRING },
        amount: { type: Type.INTEGER },
        notes: { type: Type.STRING },
        transferToAccountId: { type: Type.STRING },
      },
      required: ['date', 'description', 'accountId', 'type', 'kantong', 'category', 'amount', 'notes', 'transferToAccountId'],
    },
  };

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const models = getModelCandidates();
  const retryDelays = [
    900 + Math.floor(Math.random() * 250),
    1800 + Math.floor(Math.random() * 400),
  ];

  let lastStatus = 0;
  let lastErrorMessage = '';
  let rawOutput = '';

  modelLoop: for (let mIndex = 0; mIndex < models.length; mIndex++) {
    const currentModel = models[mIndex];

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        const aiRes = await ai.models.generateContent({
          model: currentModel,
          contents: { parts },
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema,
          },
        });

        const textVal =
          aiRes?.text ||
          (aiRes?.candidates?.[0]?.content?.parts || [])
            .map((p: any) => p.text || '')
            .join('');

        if (textVal) {
          rawOutput = textVal;
          break modelLoop;
        }
      } catch (err: any) {
        const status = Number(err?.status || err?.httpStatusCode || 0) ||
          (String(err?.message || '').includes('404') || String(err?.message || '').includes('NOT_FOUND') ? 404 :
           String(err?.message || '').includes('429') ? 429 :
           String(err?.message || '').includes('503') ? 503 :
           String(err?.message || '').includes('403') || String(err?.message || '').includes('401') ? 403 : 500);

        lastStatus = status;

        if (status === 401 || status === 403) {
          throw new HttpError(403, 'API key Gemini tidak valid atau ditolak.');
        }
        if (status === 400) {
          throw new HttpError(400, 'AI gagal memproses permintaan (kode 400).');
        }
        if (status === 413) {
          throw new HttpError(413, 'Foto terlalu besar.');
        }

        if (status === 404) {
          lastErrorMessage = 'Model Gemini tidak ditemukan.';
          continue modelLoop;
        }

        const isRetryable = [429, 500, 503, 504].includes(status);
        if (status === 503 || status === 429) {
          lastErrorMessage = 'Server AI sedang sibuk. Coba lagi beberapa saat.';
        } else {
          lastErrorMessage = `AI gagal memproses (kode ${status}).`;
        }

        if (isRetryable && attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]);
          continue;
        }

        continue modelLoop;
      }
    }
  }

  if (rawOutput) {
    let items: any;
    try {
      items = JSON.parse(rawOutput);
    } catch {
      const fenceMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch) {
        try {
          items = JSON.parse(fenceMatch[1]);
        } catch {
          throw new HttpError(502, 'Jawaban AI tidak bisa dibaca. Coba lagi.');
        }
      } else {
        throw new HttpError(502, 'Jawaban AI tidak bisa dibaca. Coba lagi.');
      }
    }

    const accountIdSet = new Set<string>(accountIds);
    const kantongMap = new Map<string, string>(
      kantongNames.map(k => [k.trim().toLowerCase(), k.trim()] as [string, string])
    );
    const categoryMap = new Map<string, string>(
      categoryNames.map(c => [c.trim().toLowerCase(), c.trim()] as [string, string])
    );

    return (Array.isArray(items) ? items : [])
      .slice(0, 50)
      .map((it: any) => {
        const accountId = accountIdSet.has(it?.accountId) ? it.accountId : accountIds[0];
        const toId =
          accountIdSet.has(it?.transferToAccountId) && it.transferToAccountId !== accountId
            ? it.transferToAccountId
            : '';
        const rawType = String(it?.type || '').toLowerCase();
        const type: 'masuk' | 'keluar' = toId ? 'keluar' : rawType === 'masuk' ? 'masuk' : 'keluar';

        const rawKt = String(it?.kantong || '').trim().toLowerCase();
        const rawCat = String(it?.category || '').trim().toLowerCase();

        let kt = toId
          ? ''
          : kantongMap.get(rawKt) || kantongMap.get(rawCat) || '';

        let cat = toId
          ? 'Pindah Saldo'
          : categoryMap.get(rawCat) || categoryMap.get(rawKt) || '';

        if (type === 'keluar') {
          if (kt.toLowerCase() === 'pemasukan toko') kt = '';
          if (cat.toLowerCase() === 'pemasukan toko') cat = '';
        }

        const notes = String(it?.notes || '').trim().slice(0, 1500);

        return {
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(it?.date || '')) ? it.date : today,
          description: String(it?.description || '').trim().slice(0, 255) || 'Transaksi',
          accountId,
          type,
          kantong: kt,
          category: cat,
          amount: Math.round(Number(it?.amount) || 0),
          notes,
          transferToAccountId: toId,
        };
      })
      .filter(t => t.amount > 0);
  }

  if (lastStatus === 503 || lastStatus === 429) {
    throw new HttpError(503, 'Server AI sedang sibuk. Coba lagi beberapa saat.');
  }
  if (lastStatus === 404) {
    throw new HttpError(404, 'Model Gemini tidak ditemukan. Periksa konfigurasi model.');
  }
  if (lastStatus === 413) {
    throw new HttpError(413, 'Foto terlalu besar.');
  }
  if (lastStatus > 0) {
    throw new HttpError(lastStatus, lastErrorMessage || `AI gagal memproses (kode ${lastStatus}).`);
  }

  throw new HttpError(503, 'Server AI sedang sibuk. Coba lagi beberapa saat.');
}
