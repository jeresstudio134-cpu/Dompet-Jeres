import { asc } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';
import { accounts, categories } from '../src/db/schema.js';
import { HttpError } from './http.js';
import { getSetting, setSetting } from './settings.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

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
  const categoryList = categoryNames.length > 0 ? categoryNames.map(c => `- ${c}`).join('\n') : '- (belum ada kategori)';
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
    'DAFTAR KATEGORI (tulis persis seperti di daftar; jika tidak ada yang cocok, isi string kosong ""):',
    categoryList,
    hints ? `\nKebiasaan pengguna (kata kunci -> kategori):\n${hints}` : '',
    '',
    'ATURAN:',
    '1. Satu transaksi per kejadian uang masuk/keluar. Satu baris teks biasanya satu transaksi. Abaikan teks yang bukan transaksi (sapaan, saldo akhir, nomor referensi, promo).',
    '2. amount = bilangan bulat Rupiah tanpa titik/koma. "30rb" atau "30k" = 30000, "1,5jt" = 1500000, "125.000" = 125000, "Rp 2.500.000,00" = 2500000. Untuk notifikasi bank, pakai nominal transaksi, bukan saldo.',
    '3. type: "keluar" untuk belanja, bayar, beli, tagihan, ongkir; "masuk" untuk pemasukan, penjualan, omset, terima, gaji. Jika ragu, pilih "keluar".',
    '4. accountId: cocokkan nama atau alias yang disebut (mis. "tunai" = akun Cash, "spay" = ShopeePay). Jika tidak disebut, pakai akun bertipe cash; jika tidak ada, akun pertama.',
    `5. date: format YYYY-MM-DD. Pakai tanggal pada teks/struk; "kemarin" = sehari sebelum tanggal hari ini. Jika tahun tidak tertulis, pakai tahun ${today.slice(0, 4)}. Jika tanggal tidak ada, pakai tanggal hari ini.`,
    '6. description: singkat dan jelas, huruf awal kapital, tanpa nominal dan tanpa nama akun (mis. "Bensin", "Bulanan Wifi").',
    '7. Pemindahan saldo antar akun (mis. "pindah 50rb dari seabank ke cash"): SATU entri dengan accountId = akun asal, transferToAccountId = akun tujuan, type "keluar", category "Pindah Saldo". Untuk transaksi biasa, transferToAccountId = "".',
    hasImage
      ? '8. Jika gambar adalah struk/nota belanja: buat SATU transaksi "keluar" dengan total akhir yang dibayar (setelah diskon/pajak); description berisi nama toko dan 1-3 barang utama. Jika gambar adalah catatan atau daftar (mis. tangkapan layar chat/catatan berisi banyak baris bertanggal): buat SATU transaksi per baris, jangan digabung. Teks dalam kurung adalah keterangan atau kategori (mis. "(pokok)" = kategori Pokok).'
      : '',
    '9. Jika tidak ada transaksi yang bisa dibaca, kembalikan array kosong [].',
  ].join('\n');
}

export interface AiInput {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
}

export async function runAiParse(input: AiInput) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(500, 'GEMINI_API_KEY belum diisi di server.');

  const text = String(input.text || '').slice(0, 8000);
  const imageBase64 = String(input.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
  const mimeType = String(input.mimeType || 'image/jpeg');

  if (!text.trim() && !imageBase64) throw new HttpError(400, 'Teks atau foto wajib diisi.');
  if (imageBase64.length > 4000000) throw new HttpError(413, 'Foto terlalu besar. Gunakan foto yang lebih kecil.');
  if (imageBase64 && !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new HttpError(400, 'Format foto harus JPG, PNG, atau WEBP.');
  }

  const db = getDb();
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type })
    .from(accounts)
    .orderBy(asc(accounts.id));
  const categoryRows = await db.select({ name: categories.name }).from(categories).orderBy(asc(categories.name));
  if (accountRows.length === 0) throw new HttpError(400, 'Belum ada akun di database.');

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  let gRes: Response;
  try {
    gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema },
      }),
      signal: controller.signal,
    });
  } catch {
    throw new HttpError(504, 'AI terlalu lama merespons. Coba lagi.');
  } finally {
    clearTimeout(timer);
  }

  if (!gRes.ok) {
    console.error('Gemini error:', gRes.status, await gRes.text());
    if (gRes.status === 429) throw new HttpError(502, 'Kuota Gemini sedang habis. Coba lagi beberapa saat lagi.');
    if (gRes.status === 404) {
      throw new HttpError(502, `Model Gemini "${GEMINI_MODEL}" tidak tersedia. Ganti nilai GEMINI_MODEL dengan model terbaru.`);
    }
    throw new HttpError(502, `Gemini menolak permintaan (${gRes.status}). Periksa GEMINI_API_KEY dan GEMINI_MODEL.`);
  }

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
  const categoryMap = new Map<string, string>(categoryNames.map(c => [c.toLowerCase(), c] as [string, string]));

  return (Array.isArray(items) ? items : [])
    .slice(0, 50)
    .map((it: any) => {
      const accountId = accountIdSet.has(it?.accountId) ? it.accountId : accountIds[0];
      const toId =
        accountIdSet.has(it?.transferToAccountId) && it.transferToAccountId !== accountId ? it.transferToAccountId : '';
      return {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(it?.date || '')) ? it.date : today,
        description: String(it?.description || '').trim().slice(0, 255) || 'Transaksi',
        accountId,
        type: toId ? 'keluar' : it?.type === 'masuk' ? 'masuk' : 'keluar',
        category: toId ? 'Pindah Saldo' : categoryMap.get(String(it?.category || '').toLowerCase()) || '',
        amount: Math.round(Number(it?.amount) || 0),
        transferToAccountId: toId,
      };
    })
    .filter(t => t.amount > 0);
}