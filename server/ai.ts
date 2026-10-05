import { asc } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';
import { accounts, categories } from '../src/db/schema.js';
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

// Kebiasaan pencatatan (dipakai hanya jika kategorinya memang ada di database)
const CATEGORY_HINTS: { category: string; examples: string }[] = [
  { category: 'Kendaraan', examples: 'bensin, pertalite, pertamax, servis, oli, parkir, tol' },
  { category: 'Pokok', examples: 'listrik, token, wifi, pdam, sembako, beras, kontrakan' },
  { category: 'Bangun Rumah', examples: 'semen, pasir, batu bata, cat, keramik, tukang, material' },
  { category: 'Pribadi', examples: 'makan, bakso, jajan, kopi, rokok, obat' },
  { category: 'Operasional Toko', examples: 'stiker, banner, kertas, tinta, plastik, ongkir' },
  { category: 'Toko', examples: 'pemasukan toko, penjualan, omset' },
  { category: 'Pemasukan Toko', examples: 'pemasukan toko, penjualan, omset' },
];

function buildAiPrompt(
  accountRows: { id: string; name: string; type: string }[],
  categoryNames: string[],
  today: string,
  hasImage: boolean
): string {
  const accountList = accountRows.map(a => `- id "${a.id}" = ${a.name} (${a.type})`).join('\n');
  const categoryList =
    categoryNames.length > 0 ? categoryNames.map(c => `- ${c}`).join('\n') : '- (belum ada kategori)';
  const hints = CATEGORY_HINTS.filter(h => categoryNames.some(c => c.toLowerCase() === h.category.toLowerCase()))
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
    'DAFTAR KANTONG / KATEGORI PENGGUNA:',
    categoryList,
    hints ? `\nKebiasaan pengguna (kata kunci -> kategori):\n${hints}` : '',
    '',
    'ATURAN UTAMA:',
    '1. category WAJIB persis salah satu dari daftar kantong milik pengguna di atas. Jika tidak ada yang cocok, isi "" (kosong). DILARANG membuat kategori baru di luar daftar.',
    '2. Struk belanja = type "keluar". Kategori "Pemasukan Toko" (atau omset/pendapatan) HANYA untuk type "masuk". DILARANG memakai "Pemasukan Toko" pada belanja atau pengeluaran.',
    '3. description hanya nama barang beserta jumlahnya (contoh "1 Sak Semen Singa Merah"), tanpa nama toko. Struk berisi banyak barang: buat SATU transaksi dengan total akhir, description = barang utama atau "Belanja <nama toko>".',
    '4. Satu transaksi per kejadian uang masuk/keluar. Satu baris teks biasanya satu transaksi. Abaikan teks yang bukan transaksi (sapaan, saldo akhir, nomor referensi, promo).',
    '5. amount = bilangan bulat Rupiah tanpa titik/koma. "30rb" atau "30k" = 30000, "1,5jt" = 1500000, "125.000" = 125000, "Rp 2.500.000,00" = 2500000. Untuk notifikasi bank, pakai nominal transaksi, bukan saldo.',
    '6. type: "keluar" untuk belanja, bayar, beli, tagihan, ongkir; "masuk" untuk pemasukan, penjualan, omset, terima, gaji. Jika ragu, pilih "keluar".',
    '7. accountId: cocokkan nama atau alias yang disebut (mis. "tunai" = akun Cash, "spay" = ShopeePay). Jika tidak disebut, pakai akun bertipe cash; jika tidak ada, akun pertama.',
    `8. date: format YYYY-MM-DD. Pakai tanggal pada teks/struk; "kemarin" = sehari sebelum tanggal hari ini. Jika tahun tidak tertulis, pakai tahun ${today.slice(0, 4)}. Jika tanggal tidak ada, pakai tanggal hari ini.`,
    '9. Pemindahan saldo antar akun (mis. "pindah 50rb dari seabank ke cash"): SATU entri dengan accountId = akun asal, transferToAccountId = akun tujuan, type "keluar", category "Pindah Saldo". Untuk transaksi biasa, transferToAccountId = "".',
    hasImage
      ? '10. Jika gambar adalah catatan atau daftar banyak baris bertanggal (mis. screenshot catatan): buat SATU transaksi per baris. Jika struk belanja: buat SATU transaksi "keluar" dengan total akhir yang dibayar.'
      : '',
    '11. Jika tidak ada transaksi yang bisa dibaca, kembalikan array kosong [].',
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

function getModelCandidates(): string[] {
  const primaryModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  const fallbackEnv = process.env.GEMINI_FALLBACK_MODELS?.trim() || 'gemini-2.5-flash-lite';
  const fallbacks = fallbackEnv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return Array.from(new Set([primaryModel, ...fallbacks]));
}

export async function runAiParse(input: AiInput) {
  const apiKey = process.env.GEMINI_API_KEY;
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
  let categoryNames = ['Pribadi', 'Pokok', 'Kendaraan', 'Bangun Rumah', 'Operasional Toko', 'Pemasukan Toko'];

  const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (dbUrl) {
    try {
      const db = getDb();
      const a = await db
        .select({ id: accounts.id, name: accounts.name, type: accounts.type })
        .from(accounts)
        .orderBy(asc(accounts.id));
      const c = await db.select({ name: categories.name }).from(categories).orderBy(asc(categories.name));
      if (a.length > 0) accountRows = a;
      if (c.length > 0) categoryNames = c.map(r => r.name);
    } catch (e) {
      console.warn('Gagal membaca akun/kategori dari DB untuk AI, menggunakan default:', e);
    }
  }

  const accountIds = accountRows.map(a => a.id);
  const categoryNames = categoryRows.map(c => c.name);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  const parts: any[] = [{ text: buildAiPrompt(accountRows, categoryNames, today, Boolean(imageBase64)) }];
  if (text.trim()) parts.push({ text: `TEKS INPUT:\n${text}` });
  if (imageBase64) parts.push({ inlineData: { mimeType, data: imageBase64 } });

  const responseSchema = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING' },
        description: { type: 'STRING' },
        accountId: { type: 'STRING', enum: accountIds },
        type: { type: 'STRING', enum: ['masuk', 'keluar'] },
        category: { type: 'STRING' },
        amount: { type: 'INTEGER' },
        transferToAccountId: { type: 'STRING' },
      },
      required: ['date', 'description', 'accountId', 'type', 'category', 'amount', 'transferToAccountId'],
    },
  };

  const models = getModelCandidates();
  // Jeda retry: 1 dtk, 2 dtk, 4 dtk (+ sedikit acak)
  const retryDelays = [
    1000 + Math.floor(Math.random() * 300),
    2000 + Math.floor(Math.random() * 500),
    4000 + Math.floor(Math.random() * 800),
  ];

  let lastStatus = 0;
  let lastErrorMessage = '';

  modelLoop: for (let mIndex = 0; mIndex < models.length; mIndex++) {
    const currentModel = models[mIndex];

    for (let attempt = 0; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      let gRes: Response | null = null;
      let networkErr: any = null;

      try {
        gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema },
            }),
            signal: controller.signal,
          }
        );
      } catch (err: any) {
        networkErr = err;
      } finally {
        clearTimeout(timer);
      }

      if (networkErr) {
        console.error(`Gemini network error [${currentModel}] attempt ${attempt + 1}:`, networkErr?.message || networkErr);
        lastStatus = 503;
        lastErrorMessage = 'Server AI sedang sibuk. Coba lagi beberapa saat.';

        // Retry maksimal 3 kali untuk error jaringan
        if (attempt < 3) {
          await sleep(retryDelays[attempt]);
          continue;
        }
        // Jika retry model ini habis, pindah ke model berikutnya
        continue modelLoop;
      }

      if (!gRes) {
        lastStatus = 503;
        lastErrorMessage = 'Server AI sedang sibuk. Coba lagi beberapa saat.';
        continue modelLoop;
      }

      if (gRes.ok) {
        const gJson: any = await gRes.json();
        const raw = (gJson?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
        let items: any;
        try {
          items = JSON.parse(raw);
        } catch {
          throw new HttpError(502, 'Jawaban AI tidak bisa dibaca. Coba lagi.');
        }

        // Validasi ulang hasil AI sebelum dikirim ke aplikasi
        const accountIdSet = new Set<string>(accountIds);
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

            // Category WAJIB persis salah satu dari daftar pengguna, jika tidak cocok isi ""
            let cat = toId ? 'Pindah Saldo' : categoryMap.get(String(it?.category || '').trim().toLowerCase()) || '';
            // Struk/pengeluaran tidak boleh memakai "Pemasukan Toko"
            if (type === 'keluar' && cat.toLowerCase() === 'pemasukan toko') {
              cat = '';
            }

            return {
              date: /^\d{4}-\d{2}-\d{2}$/.test(String(it?.date || '')) ? it.date : today,
              description: String(it?.description || '').trim().slice(0, 255) || 'Transaksi',
              accountId,
              type,
              category: cat,
              amount: Math.round(Number(it?.amount) || 0),
              transferToAccountId: toId,
            };
          })
          .filter(t => t.amount > 0);
      }

      // Response tidak OK: ambil status dan teks error asli dari Gemini
      const status = gRes.status;
      const errorText = await gRes.text().catch(() => '');
      console.error(`Gemini API error [${currentModel}] status ${status}:`, errorText);

      lastStatus = status;

      // Error yang TIDAK boleh diretry dan langsung ditolak:
      if (status === 401 || status === 403) {
        throw new HttpError(403, 'API key Gemini tidak valid atau ditolak.');
      }
      if (status === 400) {
        throw new HttpError(400, 'AI gagal memproses (kode 400).');
      }
      if (status === 413) {
        throw new HttpError(413, 'Foto terlalu besar.');
      }

      // Jika 404 (Model tidak ditemukan), jangan retry model yang sama, langsung pindah ke model berikutnya
      if (status === 404) {
        lastErrorMessage = 'Model Gemini tidak ditemukan. Periksa GEMINI_MODEL.';
        continue modelLoop;
      }

      // Status yang boleh diretry: 429, 500, 503, 504
      const isRetryable = [429, 500, 503, 504].includes(status);
      if (status === 503 || status === 429) {
        lastErrorMessage = 'Server AI sedang sibuk. Coba lagi beberapa saat.';
      } else {
        lastErrorMessage = `AI gagal memproses (kode ${status}).`;
      }

      if (isRetryable && attempt < 3) {
        await sleep(retryDelays[attempt]);
        continue;
      }

      // Retry model ini sudah habis, lanjut ke model berikutnya
      continue modelLoop;
    }
  }

  // Semua model dan retry telah dicoba namun tetap gagal
  if (lastStatus === 503 || lastStatus === 429) {
    throw new HttpError(503, 'Server AI sedang sibuk. Coba lagi beberapa saat.');
  }
  if (lastStatus === 404) {
    throw new HttpError(404, 'Model Gemini tidak ditemukan. Periksa GEMINI_MODEL.');
  }
  if (lastStatus === 413) {
    throw new HttpError(413, 'Foto terlalu besar.');
  }
  if (lastStatus > 0) {
    throw new HttpError(lastStatus, lastErrorMessage || `AI gagal memproses (kode ${lastStatus}).`);
  }

  throw new HttpError(503, 'Server AI sedang sibuk. Coba lagi beberapa saat.');
}
