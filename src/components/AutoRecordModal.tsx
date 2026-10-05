import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Camera, Check, AlertCircle, Trash2, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Account, Transaction } from '../types/finance.ts';
import { parseMultiLineText, ParsedTransactionResult } from '../lib/autoParser.ts';
import { parseReceiptWithGemini, parseTextWithGemini, compressImage } from '../lib/aiParser.ts';
import { formatRupiah } from '../utils/formatters.ts';

interface AutoRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTransactions: (transactions: Omit<Transaction, 'id'>[]) => Promise<boolean> | void;
  accounts: Account[];
  categories: string[];
  onAddCategory?: (name: string) => Promise<any> | void;
}

type Item = ParsedTransactionResult & { key: string };

const inputCls =
  'w-full bg-slate-900 text-white text-xs rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export const AutoRecordModal: React.FC<AutoRecordModalProps> = ({
  isOpen,
  onClose,
  onAddTransactions,
  accounts,
  categories,
}) => {
  const [activeTab, setActiveTab] = useState<'text' | 'receipt'>('text');
  const [textInput, setTextInput] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [lastReceiptFile, setLastReceiptFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);

  // Tempel (Ctrl+V) foto struk dari clipboard, hanya aktif di tab foto
  useEffect(() => {
    if (!isOpen || activeTab !== 'receipt') return;

    const onPaste = (e: ClipboardEvent) => {
      if (isLoading) return;
      const clipItems = e.clipboardData?.items;
      if (!clipItems) return;
      for (const item of Array.from(clipItems)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            return;
          }
        }
      }
    };

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isOpen, activeTab, isLoading]);

  if (!isOpen) return null;

  const withKeys = (list: ParsedTransactionResult[]): Item[] =>
    list.map(it => ({ ...it, key: `i${keyRef.current++}` }));

  const resetAll = () => {
    setTextInput('');
    setItems([]);
    setReceiptImage(null);
    setLastReceiptFile(null);
    setError(null);
    setNotice(null);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const switchTab = (tab: 'text' | 'receipt') => {
    setActiveTab(tab);
    setItems([]);
    setError(null);
    setNotice(null);
  };

  const updateItem = (key: string, patch: Partial<ParsedTransactionResult>) => {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)));
  };

  const removeItem = (key: string) => {
    setItems(prev => prev.filter(i => i.key !== key));
  };

  // Validasi sebelum simpan: nominal > 0, tanggal valid, kantong dipilih
  const isItemValid = (it: Item) => {
    const isTransfer = Boolean(it.transferTargetAccountId);
    const hasCategory = isTransfer || Boolean(it.category && it.category.trim());
    return (
      it.amount > 0 &&
      it.description.trim().length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(it.date) &&
      accounts.some(a => a.id === it.accountId) &&
      hasCategory
    );
  };

  const allValid = items.length > 0 && items.every(isItemValid);

  // Analisis teks dengan AI; jika gagal, pakai pembaca lokal dengan kantong kosong
  const handleAnalyze = async () => {
    if (!textInput.trim() || isLoading) return;
    setIsLoading(true);
    setError(null);
    setNotice(null);
    setItems([]);
    try {
      const res = await parseTextWithGemini(textInput);
      if (res.length === 0) {
        setNotice('AI tidak menemukan transaksi pada teks ini. Coba tulis dengan nominal yang jelas.');
      }
      setItems(withKeys(res));
    } catch (err: any) {
      console.warn('AI parse error, mencoba fallback lokal:', err);
      const local = parseMultiLineText(textInput);
      if (local.length > 0) {
        // Hasil pembaca lokal (fallback) TIDAK boleh mengisi kantong otomatis.
        // Kantong kosong dengan placeholder "Pilih kantong", dan tombol Simpan nonaktif sampai kantong dipilih.
        const localItems = local.map(it => ({
          ...it,
          category: '', // wajib kosong agar pengguna memilih kantong sendiri
        }));
        setItems(withKeys(localItems));
        setNotice(
          'Hasil diekstrak dengan pembaca cerdas lokal. Silakan pilih kantong untuk masing-masing transaksi sebelum disimpan.'
        );
      } else {
        setError(err?.message || 'Server AI sedang sibuk. Coba lagi beberapa saat.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Scan foto struk dengan AI
  const processFile = async (file: File) => {
    setLastReceiptFile(file);
    setError(null);
    setNotice(null);
    setItems([]);
    setIsLoading(true);
    try {
      // 1. Sebelum dikirim, kompres foto (max 1600px, JPEG 0.7, target < 1MB)
      const img = await compressImage(file);
      setReceiptImage(img.preview);
      const res = await parseReceiptWithGemini(img.base64, img.mimeType);
      if (res.length === 0) {
        setNotice('Tidak ada transaksi yang terbaca dari foto. Coba foto yang lebih terang dan tegak lurus.');
      }
      setItems(withKeys(res));
    } catch (err: any) {
      console.error('Scan receipt failed:', err);
      // Foto tidak bisa diproses oleh pembaca lokal. Jika AI gagal untuk foto:
      setError('Foto butuh AI. Coba lagi atau ketik manual.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processFile(file);
  };

  // Tombol "Coba lagi" pada pesan error
  const handleRetry = () => {
    if (isLoading) return;
    if (activeTab === 'text') {
      handleAnalyze();
    } else if (activeTab === 'receipt') {
      if (lastReceiptFile) {
        processFile(lastReceiptFile);
      } else {
        fileInputRef.current?.click();
      }
    }
  };

  // Simpan semua baris pratinjau (setelah validasi)
  const handleSave = async () => {
    if (!allValid || isSaving) return;

    const toSave: Omit<Transaction, 'id'>[] = [];
    for (const it of items) {
      if (it.amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) continue;
      const target = it.transferTargetAccountId;
      const isTransfer = Boolean(target) && target !== it.accountId && accounts.some(a => a.id === target);

      if (isTransfer && target) {
        const fromName = accounts.find(a => a.id === it.accountId)?.name || it.accountId;
        const toName = accounts.find(a => a.id === target)?.name || target;
        toSave.push(
          {
            date: it.date,
            description: `Pindah ke ${toName}`,
            accountId: it.accountId,
            type: 'keluar',
            category: 'Pindah Saldo',
            amount: it.amount,
            transferTargetAccountId: target,
          },
          {
            date: it.date,
            description: `Pindah dari ${fromName}`,
            accountId: target,
            type: 'masuk',
            category: 'Pindah Saldo',
            amount: it.amount,
          }
        );
      } else {
        // Validasi kantong dipilih
        if (!it.category || !it.category.trim()) continue;
        toSave.push({
          date: it.date,
          description: it.description.trim() || 'Transaksi',
          accountId: it.accountId,
          type: it.type,
          category: it.category.trim(),
          amount: it.amount,
        });
      }
    }

    if (toSave.length === 0) return;

    setIsSaving(true);
    try {
      const ok = await onAddTransactions(toSave);
      if (ok === false) return;
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.8 } });
      handleClose();
    } catch (err: any) {
      console.error('Failed saving transactions:', err);
      setError(err?.message || 'Gagal menyimpan transaksi ke database.');
    } finally {
      setIsSaving(false);
    }
  };

  const totalMasuk = items.filter(i => i.type === 'masuk').reduce((sum, i) => sum + i.amount, 0);
  const totalKeluar = items.filter(i => i.type === 'keluar').reduce((sum, i) => sum + i.amount, 0);

  // Dropdown kantong HANYA berisi kantong yang ada milik pengguna
  const availableCategories = categories.filter(c => Boolean(c && c !== 'Pindah Saldo'));

  const renderItems = () => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-300">
          <span className="font-bold text-emerald-400">Ditemukan {items.length} transaksi</span>
          <span>
            Masuk {formatRupiah(totalMasuk)} • Keluar {formatRupiah(totalKeluar)}
          </span>
        </div>

        <div className="max-h-[42vh] overflow-y-auto space-y-2 pr-1">
          {items.map(it => {
            const valid = isItemValid(it);
            const isTransfer = Boolean(it.transferTargetAccountId);

            return (
              <div
                key={it.key}
                className={`rounded-xl border p-2.5 space-y-2 transition ${
                  valid ? 'bg-slate-800/70 border-slate-700/60' : 'bg-rose-950/30 border-rose-500/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={it.description}
                    onChange={e => updateItem(it.key, { description: e.target.value })}
                    placeholder="Keterangan (contoh: 1 Sak Semen)"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(it.key)}
                    title="Hapus baris ini"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={it.date}
                    onChange={e => updateItem(it.key, { date: e.target.value })}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={it.amount ? it.amount.toLocaleString('id-ID') : ''}
                    onChange={e =>
                      updateItem(it.key, { amount: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })
                    }
                    placeholder="Nominal"
                    className={`${inputCls} font-mono font-bold`}
                  />

                  <select
                    value={it.accountId}
                    onChange={e => updateItem(it.key, { accountId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">— pilih akun —</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {isTransfer ? `Dari: ${a.name}` : a.name}
                      </option>
                    ))}
                  </select>

                  {isTransfer ? (
                    <select
                      value={it.transferTargetAccountId}
                      onChange={e => updateItem(it.key, { transferTargetAccountId: e.target.value })}
                      className={inputCls}
                    >
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>
                          Ke: {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={it.category}
                      onChange={e => updateItem(it.key, { category: e.target.value })}
                      className={`${inputCls} ${!it.category ? 'border-amber-400/80 text-amber-200' : ''}`}
                    >
                      <option value="">Pilih kantong</option>
                      {availableCategories.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {isTransfer ? (
                  <div className="text-[11px] text-sky-300">💡 Pindah saldo antar akun</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateItem(it.key, { type: 'masuk' })}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        it.type === 'masuk'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      Masuk
                    </button>
                    <button
                      type="button"
                      onClick={() => updateItem(it.key, { type: 'keluar' })}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        it.type === 'keluar'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      Keluar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!allValid && (
          <p className="text-[11px] text-amber-300">
            Lengkapi nominal (&gt; 0), tanggal, dan pilih kantong untuk semua transaksi sebelum menyimpan.
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={!allValid || isSaving}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 text-white font-bold text-sm shadow-md transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" />
          <span>{isSaving ? 'Menyimpan...' : `Simpan ${items.length} Transaksi`}</span>
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Pencatatan Keuangan Otomatis</h2>
              <p className="text-xs text-slate-400">
                AI membaca nominal, kategori, akun, dan tanggal dari teks atau foto struk
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 pt-2">
          <button
            onClick={() => switchTab('text')}
            className={`pb-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition ${
              activeTab === 'text'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Teks / Paste Banyak Baris
          </button>
          <button
            onClick={() => switchTab('receipt')}
            className={`pb-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition ${
              activeTab === 'receipt'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📷 Foto Nota / Struk (AI)
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* TAB: TEKS */}
          {activeTab === 'text' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-300">
                Ketik santai atau paste banyak baris dari Excel, WhatsApp, atau Catatan (satu transaksi per baris):
              </label>
              <textarea
                rows={5}
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder={`Contoh:\nbeli bensin 30rb seabank\nbakso 15rb cash\npemasukan toko 250rb ke dana\npindah 50rb dari seabank ke cash`}
                className="w-full bg-slate-800/90 text-white placeholder-slate-500 text-xs sm:text-sm font-mono rounded-xl p-3 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={!textInput.trim() || isLoading}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>{isLoading ? 'Menganalisis...' : 'Analisis dengan AI'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB: FOTO STRUK */}
          {activeTab === 'receipt' && (
            <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 rounded-2xl p-6 text-center transition bg-slate-950/40">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />

              {receiptImage ? (
                <div className="space-y-3">
                  <img
                    src={receiptImage}
                    alt="Struk Belanja"
                    className="max-h-48 mx-auto rounded-xl shadow-lg border border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-emerald-400 underline hover:text-emerald-300 cursor-pointer"
                  >
                    Pilih Foto Struk Lain
                  </button>
                </div>
              ) : (
                <div onClick={() => fileInputRef.current?.click()} className="cursor-pointer space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div className="font-semibold text-white text-sm">Upload atau Ambil Foto Struk / Nota</div>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    AI akan membaca total belanja, tanggal, dan nama barang utama dari struk.
                  </p>
                </div>
              )}
            </div>
          )}

          {isLoading && activeTab === 'receipt' && (
            <div className="py-3 text-center space-y-2">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-emerald-400 font-semibold animate-pulse">
                AI sedang menganalisis foto struk...
              </p>
            </div>
          )}

          {notice && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {/* Pesan Error dengan Tombol Coba Lagi */}
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 flex items-center justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-lg bg-rose-900/70 hover:bg-rose-800 text-rose-100 border border-rose-600/60 text-xs font-semibold shrink-0 cursor-pointer transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Coba lagi</span>
              </button>
            </div>
          )}

          {renderItems()}
        </div>
      </div>
    </div>
  );
};
