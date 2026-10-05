import { apiAiParse, AiParsedItem } from './api.ts';
import { ParsedTransactionResult } from './autoParser.ts';

const MAX_SIDE = 1600;

// Kecilkan foto: sisi terpanjang maksimal 1600 px, JPEG kualitas 0.7 lewat canvas, targetkan di bawah 1 MB
export const compressImage = (
  file: File
): Promise<{ base64: string; mimeType: string; preview: string }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > MAX_SIDE || height > MAX_SIDE) {
        if (width > height) {
          height = Math.round((height * MAX_SIDE) / width);
          width = MAX_SIDE;
        } else {
          width = Math.round((width * MAX_SIDE) / height);
          height = MAX_SIDE;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Browser tidak mendukung pemrosesan foto.'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // JPEG kualitas 0.7 lewat canvas, targetkan di bawah 1 MB
      let quality = 0.7;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);

      const TARGET_BYTES = 1024 * 1024;
      const getByteSize = (dataUri: string) => Math.round((dataUri.length - 23) * 0.75);

      if (getByteSize(dataUrl) > TARGET_BYTES) {
        quality = 0.55;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      if (getByteSize(dataUrl) > TARGET_BYTES) {
        const smallerCanvas = document.createElement('canvas');
        smallerCanvas.width = Math.round(width * 0.75);
        smallerCanvas.height = Math.round(height * 0.75);
        const sCtx = smallerCanvas.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
          dataUrl = smallerCanvas.toDataURL('image/jpeg', 0.6);
        }
      }

      URL.revokeObjectURL(url);
      const base64 = dataUrl.split(',')[1] || '';
      resolve({ base64, mimeType: 'image/jpeg', preview: dataUrl });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('File bukan foto yang valid (format HEIC dari iPhone belum didukung).'));
    };

    img.src = url;
  });

const toResults = (items: AiParsedItem[]): ParsedTransactionResult[] =>
  items.map(it => ({
    date: it.date,
    description: it.description,
    accountId: it.accountId,
    type: it.type === 'masuk' ? 'masuk' : 'keluar',
    kantong: it.kantong || '',
    category: it.category || '',
    amount: it.amount,
    notes: it.notes || '',
    transferTargetAccountId: it.transferToAccountId || undefined,
    confidence: 0.95,
    rawText: '',
  }));

// Teks bebas / paste banyak baris -> daftar transaksi
export const parseTextWithGemini = async (text: string): Promise<ParsedTransactionResult[]> =>
  toResults(await apiAiParse({ text }));

// Foto struk -> daftar transaksi (struk default type "keluar")
export const parseReceiptWithGemini = async (
  base64: string,
  mimeType: string = 'image/jpeg'
): Promise<ParsedTransactionResult[]> => {
  const items = await apiAiParse({ imageBase64: base64, mimeType });
  return items.map(it => ({
    date: it.date,
    description: it.description,
    accountId: it.accountId,
    type: it.type === 'masuk' ? 'masuk' : 'keluar', // Struk default type keluar
    kantong: it.kantong || '',
    category: it.category || '',
    amount: it.amount,
    notes: it.notes || '',
    transferTargetAccountId: it.transferToAccountId || undefined,
    confidence: 0.95,
    rawText: '',
  }));
};
