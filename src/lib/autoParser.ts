import { TransactionType } from '../types/finance.ts';
import { getCurrentDateIndo } from '../utils/formatters.ts';

export interface ParsedTransactionResult {
  date: string;
  description: string;
  accountId: string;
  type: TransactionType;
  kantong?: string;
  category: string;
  amount: number;
  notes?: string;
  transferTargetAccountId?: string;
  confidence: number;
  rawText: string;
}

// Category keyword mappings for auto-tagging
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Pemasukan Toko': [
    'pemasukan', 'penjualan', 'toko', 'omset', 'omzet', 'orderan', 'pelanggan',
    'gaji', 'untung', 'pendapatan', 'transfer masuk', 'terima transfer', 'laba'
  ],
  'Kendaraan': [
    'bensin', 'pertalite', 'pertamax', 'solar', 'tambal ban', 'cuci motor',
    'servis', 'service', 'oli', 'parkir', 'tol', 'gojek', 'grab', 'motor', 'helm', 'busi'
  ],
  'Bangun Rumah': [
    'semen', 'batu bata', 'pasir', 'cat tembok', 'bor', 'paku', 'keramik',
    'genteng', 'tukang', 'material', 'triplek', 'kayu', 'palet', 'besi', 'renovasi'
  ],
  'Pokok': [
    'pokok', 'listrik', 'token', 'wifi', 'indihome', 'pdam', 'air', 'sembako',
    'beras', 'minyak', 'telur', 'shopeepaylater', 'shopeelater', 'bri', 'panci',
    'dapur', 'belanja bulanan', 'kontrakan', 'sewa', 'sekolah', 'spp', 'buku', 'lks'
  ],
  'Pribadi': [
    'infaq', 'infak', 'nabung', 'tabungan', 'sedekah', 'amal', 'bakso', 'bubur',
    'mie ayam', 'donat', 'susu', 'jajan', 'makan', 'kopi', 'cafe', 'rokok',
    'obat', 'sunatan', 'buwuh', 'masjid', 'dipinjam', 'nonton', 'baju', 'kaos',
    'shampoo', 'sabun', 'skincare', 'pulsa', 'kuota'
  ],
  'Operasional Toko': [
    'stiker', 'banner', 'ongkir', 'lanyard', 'dtf', 'vinyl', 'kertas',
    'packaging', 'opp', 'plastik', 'solasi', 'lakban', 'resi', 'macbook',
    'charger', 'frame', 'atk', 'tinta', 'printer', 'spanduk', 'dus'
  ],
  'Pindah Saldo': ['pindah', 'transfer antar', 'tf', 'top up', 'tarik tunai', 'setor'],
};

// Account detection keywords
export const ACCOUNT_KEYWORDS: Record<string, string[]> = {
  cash: ['cash', 'tunai', 'uang tunai', 'dompet', 'kas'],
  dana: ['dana', 'e-dana', 'edana'],
  seabank: ['seabank', 'sea bank', 'rek seabank'],
  shoopepay: ['shopee', 'shopeepay', 'shoppe', 'spay', 'shope pay'],
};

// Indonesian Month Dictionary
const MONTH_MAP: Record<string, string> = {
  jan: '01', januari: '01',
  feb: '02', februari: '02', peb: '02', pebruari: '02',
  mar: '03', maret: '03',
  apr: '04', april: '04',
  mei: '05', may: '05',
  jun: '06', juni: '06',
  jul: '07', juli: '07',
  agu: '08', agustus: '08', ags: '08', agt: '08',
  sep: '09', sept: '09', september: '09',
  okt: '10', oktober: '10', oct: '10',
  nov: '11', november: '11', nop: '11', nopember: '11',
  des: '12', desember: '12', dec: '12',
};

export const parseAmountFromText = (text: string): number => {
  const lower = text.toLowerCase();

  // 1. "1.5jt", "2 jt", "2,5juta"
  const jtMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:jt|juta)\b/);
  if (jtMatch) {
    const num = parseFloat(jtMatch[1].replace(',', '.'));
    return Math.round(num * 1_000_000);
  }

  // 2. "100k", "50rb", "25k", "150 ribu"
  const rbMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:rb|k|ribu)\b/);
  if (rbMatch) {
    const num = parseFloat(rbMatch[1].replace(',', '.'));
    return Math.round(num * 1_000);
  }

  // 3. "Rp 150.000", "Rp. 50.000", "125.000"
  const rpMatch = lower.match(/(?:rp\.?|idr)?\s*([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]+)?)/);
  if (rpMatch) {
    const clean = rpMatch[1].split(',')[0].replace(/\./g, '');
    return parseInt(clean, 10);
  }

  // 4. Plain numbers >= 1000 e.g. "50000"
  const plainMatch = text.match(/\b([1-9][0-9]{3,8})\b/);
  if (plainMatch) {
    return parseInt(plainMatch[1], 10);
  }

  return 0;
};

export const detectAccount = (text: string, defaultAccount = 'cash'): string => {
  const lower = text.toLowerCase();
  for (const [accountId, keywords] of Object.entries(ACCOUNT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return accountId;
    }
  }
  return defaultAccount;
};

export const detectCategory = (text: string, type: TransactionType, fallbackCategory?: string): string => {
  const lower = text.toLowerCase();

  if (type === 'masuk') {
    if (lower.includes('pindah') || lower.includes('tf') || lower.includes('transfer')) {
      return 'Pindah Saldo';
    }
    return fallbackCategory || 'Pemasukan Toko';
  }

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }

  return fallbackCategory || 'Pribadi';
};

export const detectTransactionType = (text: string): TransactionType => {
  const lower = text.toLowerCase();
  const incomeKeywords = [
    'masuk', 'pemasukan', 'penjualan', 'omzet', 'omset', 'dapat', 'terima',
    'gaji', 'untung', 'setor', 'laba', 'diterima', 'transfer masuk'
  ];
  const expenseKeywords = [
    'keluar', 'pengeluaran', 'beli', 'bayar', 'jajan', 'makan', 'bensin',
    'biaya', 'ongkir', 'amal', 'tagihan', 'belanja', 'infaq', 'infak', 'nabung', 'oli'
  ];

  let incomeScore = 0;
  let expenseScore = 0;

  incomeKeywords.forEach(kw => { if (lower.includes(kw)) incomeScore += 1; });
  expenseKeywords.forEach(kw => { if (lower.includes(kw)) expenseScore += 1; });

  if (incomeScore > expenseScore) return 'masuk';
  return 'keluar';
};

/**
 * Deteksi tanggal super fleksibel:
 * Mendukung "23 sept", "24 sept", "26 sept 2026", "24/09", "24-09-2026", "tgl 24", "kemarin", dll.
 * Sekaligus membersihkan token tanggal dari teks agar tidak masuk ke deskripsi.
 */
export const extractDateAndClean = (text: string): { date: string; cleanText: string } => {
  const today = getCurrentDateIndo();
  const currentYear = today.slice(0, 4);
  const currentMonth = today.slice(5, 7);
  let clean = text;

  // 1. Relatif: 'kemarin'
  if (/\bkemarin\b/i.test(clean)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().split('T')[0];
    clean = clean.replace(/\bkemarin\b/gi, ' ');
    return { date: dateStr, cleanText: clean };
  }

  // 2. Relatif: 'hari ini'
  if (/\bhari\s+ini\b/i.test(clean)) {
    clean = clean.replace(/\bhari\s+ini\b/gi, ' ');
    return { date: today, cleanText: clean };
  }

  // 3. Format nama bulan: "23 sept", "24 sept 2026", "24 september", "24 sep 26"
  const monthNameRegex = /\b([0-2]?[1-9]|3[01])\s*(?:-|\/|\s+)\s*(jan(?:uari)?|feb(?:ruari)?|peb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|may|jun(?:i)?|jul(?:i)?|ag(?:u|s|t|ustus)?|sep(?:t|tember)?|okt(?:ober)?|oct|nov(?:ember)?|nop(?:ember)?|des(?:ember)?|dec)(?:\s*(?:[-/,\s]\s*|\s+)(\d{4}|\d{2}))?\b/i;
  const monthMatch = clean.match(monthNameRegex);
  if (monthMatch) {
    const day = monthMatch[1].padStart(2, '0');
    const monthKey = monthMatch[2].toLowerCase();
    const monthNum = MONTH_MAP[monthKey] || currentMonth;
    let year = currentYear;
    if (monthMatch[3]) {
      year = monthMatch[3].length === 2 ? `20${monthMatch[3]}` : monthMatch[3];
    }
    clean = clean.replace(monthMatch[0], ' ');
    return { date: `${year}-${monthNum}-${day}`, cleanText: clean };
  }

  // 4. Format ISO: "2026-09-24" atau "2026/09/24"
  const isoRegex = /\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/;
  const isoMatch = clean.match(isoRegex);
  if (isoMatch) {
    clean = clean.replace(isoMatch[0], ' ');
    return { date: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, cleanText: clean };
  }

  // 5. Format numerik: "24-09-2026", "24/09/2026", "24/09", "26/9"
  const numDateRegex = /\b([0-2]?[1-9]|3[01])[/.-](0?[1-9]|1[0-2])(?:[/.-](\d{4}|\d{2}))?\b/;
  const numMatch = clean.match(numDateRegex);
  if (numMatch) {
    const day = numMatch[1].padStart(2, '0');
    const month = numMatch[2].padStart(2, '0');
    let year = currentYear;
    if (numMatch[3]) {
      year = numMatch[3].length === 2 ? `20${numMatch[3]}` : numMatch[3];
    }
    clean = clean.replace(numMatch[0], ' ');
    return { date: `${year}-${month}-${day}`, cleanText: clean };
  }

  // 6. Format "tgl 24" atau "tanggal 26"
  const tglRegex = /\b(?:tgl|tanggal)\s+([0-2]?[1-9]|3[01])\b/i;
  const tglMatch = clean.match(tglRegex);
  if (tglMatch) {
    const day = tglMatch[1].padStart(2, '0');
    clean = clean.replace(tglMatch[0], ' ');
    return { date: `${currentYear}-${currentMonth}-${day}`, cleanText: clean };
  }

  return { date: today, cleanText: clean };
};

export const detectDate = (text: string): string => {
  return extractDateAndClean(text).date;
};

// Helper kapitalisasi kalimat
const formatTitleCase = (str: string): string => {
  return str
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Parse satu baris kalimat santai / SMS / catatan.
 * Mendukung defaultCategory & defaultAccount dari baris instruksi sebelumnya (mis. "kategori pokok semua").
 */
export const parseSmartSentence = (
  rawText: string,
  defaultCategory?: string,
  defaultAccount?: string
): ParsedTransactionResult => {
  const trimmed = rawText.trim();

  // 1. Ekstrak tanggal & bersihkan token tanggal dari teks
  const { date, cleanText } = extractDateAndClean(trimmed);

  // 2. Ekstrak nominal
  const amount = parseAmountFromText(cleanText);

  // 3. Tentukan jenis transaksi
  const type = detectTransactionType(trimmed);

  // 4. Tentukan akun (cash / dana / seabank / dll.)
  const accountId = detectAccount(trimmed, defaultAccount || 'cash');

  // 5. Cek apakah ada kurung: "(pokok+oli)", "(infaq sekolah)", "(nabung)", "(pokok)"
  let extractedInside = '';
  let extractedOutside = cleanText;

  const parenMatch = cleanText.match(/[(\[{]([^)\]}]+)[)\]}]/);
  if (parenMatch) {
    extractedInside = parenMatch[1].trim();
    // Hapus bagian dalam kurung dari outside
    extractedOutside = cleanText.replace(parenMatch[0], ' ').trim();
  }

  // Bersihkan teks luar kurung dari nominal & kata pemicu
  let cleanOutside = extractedOutside
    .replace(/(?:rp\.?|idr)?\s*[\d.,]+\s*(?:jt|juta|rb|k|ribu)?/gi, ' ')
    .replace(/\b(kemarin|hari ini|besok|pake|pakai|lewat|via|ke|dari|akun|kategori|catat|masuk|keluar|beli|bayar|tgl|tanggal)\b/gi, ' ')
    .replace(/\b(cash|tunai|dana|seabank|shopee|shopeepay|spay)\b/gi, ' ')
    .replace(/[^\w\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Bersihkan teks dalam kurung
  let cleanInside = extractedInside
    .replace(/\+/g, ' + ')
    .replace(/[^\w\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 6. Bentuk Keterangan (Description)
  let description = '';
  if (cleanInside && cleanOutside) {
    // Ada di dalam kurung dan ada catatan di luar kurung (mis. "(pokok+oli) beli di bengkel")
    description = `${formatTitleCase(cleanInside)} - ${formatTitleCase(cleanOutside)}`;
  } else if (cleanInside) {
    // Hanya ada dalam kurung (mis. "(infaq sekolah)" -> "Infaq Sekolah")
    description = formatTitleCase(cleanInside);
  } else if (cleanOutside) {
    // Tidak ada kurung, hanya keterangan biasa (mis. "beli bensin motor vario" -> "Bensin Motor Vario")
    description = formatTitleCase(cleanOutside);
  }

  // 7. Tentukan Kategori:
  // JIKA pengguna sudah secara eksplisit menetapkan defaultCategory (mis. "kategori pokok semua"),
  // MAKA kategori HARUS selalu defaultCategory tersebut, TIDAK BOLEH ditimpa oleh kata kunci lain!
  let category = defaultCategory || '';

  if (!category) {
    // Cari dari kata kunci hanya jika TIDAK ada instruksi defaultCategory dari pengguna
    const searchForCat = `${cleanInside} ${cleanOutside} ${trimmed}`.toLowerCase();
    for (const [catName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some(kw => searchForCat.includes(kw))) {
        category = catName;
        break;
      }
    }
  }

  // Jika tetap kosong, gunakan deteksi umum
  if (!category) {
    category = detectCategory(trimmed, type, defaultCategory);
  }

  // Jika deskripsi masih kosong, gunakan nama kategori atau fallback ramah
  if (!description || description.length < 2) {
    const l = trimmed.toLowerCase();
    if (l.includes('bensin')) description = 'Bensin';
    else if (l.includes('bakso')) description = 'Bakso';
    else if (l.includes('wifi')) description = 'Bulanan Wifi';
    else if (l.includes('listrik')) description = 'Listrik';
    else if (l.includes('semen')) description = 'Semen';
    else if (l.includes('infaq') || l.includes('infak')) description = 'Infaq';
    else if (l.includes('nabung')) description = 'Nabung';
    else if (l.includes('oli')) description = 'Oli Motor';
    else if (type === 'masuk') description = 'Pemasukan Toko';
    else description = category || 'Pengeluaran';
  }

  // 8. Cek pemindahan saldo ("pindah dari seabank ke cash")
  let transferTargetAccountId: string | undefined = undefined;
  const lower = trimmed.toLowerCase();
  if (lower.includes('pindah') || lower.includes('transfer')) {
    if (lower.includes('ke cash')) transferTargetAccountId = 'cash';
    else if (lower.includes('ke dana')) transferTargetAccountId = 'dana';
    else if (lower.includes('ke seabank')) transferTargetAccountId = 'seabank';
    else if (lower.includes('ke shopee') || lower.includes('ke spay')) transferTargetAccountId = 'shoopepay';
  }

  return {
    date,
    description,
    accountId,
    type,
    category,
    amount,
    transferTargetAccountId,
    confidence: amount > 0 ? 0.95 : 0.4,
    rawText,
  };
};

/**
 * Cek apakah sebuah baris merupakan baris instruksi global pengguna:
 * Contoh: "kategori pokok semua", "semua kategori pokok", "akun cash semua", "pengeluaran bulan september:"
 */
const detectDirectives = (line: string): { category?: string; account?: string; isHeader: boolean } => {
  const lower = line.toLowerCase().trim();

  // 1. Cek instruksi kategori (mis. "buat kategori pokok semua", "kategori pokok semua", "semua kategori pokok", "pokok semua", "semua pokok")
  const catMatch = lower.match(/(?:(?:buat|atur|jadikan)\s+)?(?:kategori\s+([a-z\s]+?)\s+semua|semua\s+kategori\s+([a-z\s]+?)|kategori\s*[:=]\s*([a-z\s]+)|([a-z]+)\s+semua|semua(?:nya)?\s+([a-z]+))/i);
  if (catMatch) {
    const rawCat = (catMatch[1] || catMatch[2] || catMatch[3] || catMatch[4] || catMatch[5] || '').trim();
    if (rawCat && !['akun', 'rekening', 'uang', 'transaksi'].includes(rawCat)) {
      // Cocokkan ke nama kategori standar
      for (const [catName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (catName.toLowerCase() === rawCat || keywords.some(k => k === rawCat)) {
          return { category: catName, isHeader: true };
        }
      }
      // Jika tidak di daftar kata kunci, format kapital
      return { category: formatTitleCase(rawCat), isHeader: true };
    }
  }

  // 2. Cek instruksi akun (mis. "akun dana semua", "semua akun cash")
  const accMatch = lower.match(/(?:akun\s+([a-z\s]+?)\s+semua|semua\s+akun\s+([a-z\s]+?)|akun\s*[:=]\s*([a-z\s]+))/i);
  if (accMatch) {
    const rawAcc = (accMatch[1] || accMatch[2] || accMatch[3] || '').trim();
    const detected = detectAccount(rawAcc, '');
    if (detected) {
      return { account: detected, isHeader: true };
    }
  }

  // 3. Baris judul / catatan tanpa nominal (mis. "catatan belanja:", "daftar pengeluaran:", "---")
  if (parseAmountFromText(line) === 0) {
    if (lower.endsWith(':') || lower.startsWith('#') || lower.startsWith('//') || lower.startsWith('--')) {
      return { isHeader: true };
    }
  }

  return { isHeader: false };
};

/**
 * Parsing banyak baris sekaligus dengan pemahaman konteks antar-baris.
 */
export const parseMultiLineText = (multiText: string): ParsedTransactionResult[] => {
  const lines = multiText.split('\n').map(l => l.trim()).filter(Boolean);
  const results: ParsedTransactionResult[] = [];

  let currentDefaultCategory: string | undefined = undefined;
  let currentDefaultAccount: string | undefined = undefined;

  for (const line of lines) {
    // 1. Periksa apakah baris ini adalah instruksi / judul (mis. "kategori pokok semua")
    const directive = detectDirectives(line);
    if (directive.category) {
      currentDefaultCategory = directive.category;
    }
    if (directive.account) {
      currentDefaultAccount = directive.account;
    }
    // Jika baris adalah header / instruksi tanpa nominal, jangan dijadikan transaksi!
    if (directive.isHeader && parseAmountFromText(line) === 0) {
      continue;
    }

    // 2. Format tabular (Excel / CSV copy-paste dengan Tab atau Titik Koma)
    if (line.includes('\t') || (line.includes(';') && line.split(';').length >= 4)) {
      const parts = line.split(line.includes('\t') ? '\t' : ';').map(p => p.trim());
      let date = getCurrentDateIndo();
      let desc = 'Transaksi';
      let acc = currentDefaultAccount || 'cash';
      let type: TransactionType = 'keluar';
      let cat = currentDefaultCategory || 'Pribadi';
      let amount = 0;

      for (const p of parts) {
        const amt = parseAmountFromText(p);
        if (amt > 0 && amount === 0) {
          amount = amt;
          continue;
        }
        const detectedD = detectDate(p);
        if (detectedD !== getCurrentDateIndo()) {
          date = detectedD;
          continue;
        }
        const lower = p.toLowerCase();
        if (lower === 'masuk' || lower === 'keluar') {
          type = lower as TransactionType;
          continue;
        }
        const detectedAcc = detectAccount(p, '');
        if (detectedAcc) {
          acc = detectedAcc;
          continue;
        }
        if (Object.keys(CATEGORY_KEYWORDS).includes(p)) {
          cat = p;
          continue;
        }
        if (p.length > 2 && !/^\d+$/.test(p)) {
          desc = p;
        }
      }

      if (amount > 0) {
        results.push({
          date,
          description: desc,
          accountId: acc,
          type,
          category: cat,
          amount,
          confidence: 0.95,
          rawText: line,
        });
        continue;
      }
    }

    // 3. Smart sentence parser dengan default category & account dari konteks
    const parsed = parseSmartSentence(line, currentDefaultCategory, currentDefaultAccount);
    if (parsed.amount > 0) {
      results.push(parsed);
    }
  }

  return results;
};
