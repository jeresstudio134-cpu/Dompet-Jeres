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
  onAddCategory,
}) => {
  const [activeTab, setActiveTab] = useState<'text' | 'receipt'>('text');
  const [textInput, setTextInput] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newCatTargetKey, setNewCatTargetKey] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
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

  const handleAddNewCategory = async (targetKey: string, rawName: string) => {
    const trimmed = rawName.trim().slice(0, 50);
    if (!trimmed) {
      setNewCatTargetKey(null);
      return;
    }
    setExtraCategories(prev => Array.from(new Set([...prev, trimmed])));
    updateItem(targetKey, { category: trimmed });
    if (onAddCategory) {
      try {
        await onAddCategory(trimmed);
      } catch (err) {
        console.warn('Add category error:', err);
      }
    }
    setNewCatTargetKey(null);
    setNewCatName('');
  };

  const isItemValid = (it: Item) =>
    it.amount > 0 &&
    it.description.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(it.date) &&
    accounts.some(a => a.id === it.accountId);

  const allValid = items.length > 0 && items.every(isItemValid);

  // Analisis teks dengan AI; jika gagal, pakai pembaca lokal
  const handleAnalyze = async () => {
    if (!textInput.trim()) return;
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
    } catch (_err: any) {
      const local = parseMultiLineText(textInput);
      if (local.length > 0) {
        setItems(withKeys(local));
        setNotice(
          'Hasil di bawah diekstrak dengan pembaca cerdas lokal. Periksa kembali tanggal, nominal, dan kategori sebelum disimpan.'
        );
      } else {
        setError('Gagal membaca transaksi. Pastikan ada nominal pada teks yang dimasukkan.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Scan foto struk dengan AI
  const processFile = async (file: File) => {
    setError(null);
    setNotice(null);
    setItems([]);
    setIsLoading(true);
    try {
      const img = await compressImage(file);
      setReceiptImage(img.preview);
      const res = await parseReceiptWithGemini(img.base64, img.mimeType);
      if (res.length === 0) {
        setNotice('Tidak ada transaksi yang terbaca dari foto. Coba foto yang lebih terang dan tegak lurus.');
      }
      setItems(withKeys(res));
    } catch (err: any) {
      console.error('Scan failed:', err);
      setError(err.message || 'Gagal memindai struk. Coba foto yang lebih terang atau ketik di tab teks.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processFile(file);
  };

  // Simpan semua baris pratinjau
  const handleSave = async () => {
    if (!allValid) return;

    const toSave: Omit<Transaction, 'id'>[] = [];
    for (const it of items) {
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
        toSave.push({
          date: it.date,
          description: it.description.trim(),
          accountId: it.accountId,
          type: it.type,
          category: it.category || (it.type === 'masuk' ? 'Toko' : 'Pribadi'),
          amount: it.amount,
        });
      }
    }

    setIsSaving(true);
    try {
      // 1. Simpan semua kategori baru secara otomatis ke database & daftar kategori
      const newCategoriesToPersist = Array.from(
        new Set(
          toSave
            .map(t => t.category?.trim())
            .filter((c): c is string => Boolean(c && c !== 'Pindah Saldo' && !categories.includes(c)))
        )
      );
      if (newCategoriesToPersist.length > 0 && onAddCategory) {
        for (const cat of newCategoriesToPersist) {
          try {
            await onAddCategory(cat);
          } catch (e) {
            console.warn('Auto add category error:', e);
          }
        }
      }

      const ok = await onAddTransactions(toSave);
      if (ok === false) return; // gagal simpan: pratinjau dibiarkan agar bisa dicoba lagi
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.8 } });
      handleClose();
    } finally {
      setIsSaving(false);
    }
  };

  const nonTransfer = items.filter(i => !i.transferTargetAccountId);
  const totalMasuk = nonTransfer.filter(i => i.type === 'masuk').reduce((s, i) => s + i.amount, 0);
  const totalKeluar = nonTransfer.filter(i => i.type === 'keluar').reduce((s, i) => s + i.amount, 0);

  const renderItems = () => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-3">
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
            const catOptions = Array.from(
              new Set([...categories, ...extraCategories, it.category].filter(Boolean))
            );

            return (
              <div
                key={it.key}
                className={`rounded-xl border p-2.5 space-y-2 ${
                  valid ? 'bg-slate-800/70 border-slate-700/60' : 'bg-rose-950/30 border-rose-500/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={it.description}
                    onChange={e => updateItem(it.key, { description: e.target.value })}
                    placeholder="Keterangan"
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
                      onChange={e => {
                        if (e.target.value === '__ADD_NEW__') {
                          setNewCatTargetKey(it.key);
                          setNewCatName('');
                        } else {
                          updateItem(it.key, { category: e.target.value });
                        }
                      }}
                      className={inputCls}
                    >
                      <option value="">— Pilih Kantong —</option>
                      {catOptions.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__ADD_NEW__" className="text-emerald-400 font-bold bg-slate-800">
                        ➕ Tambah Kantong Baru...
                      </option>
                    </select>
                  )}
                </div>

                {newCatTargetKey === it.key && (
                  <div className="flex items-center gap-1.5 p-1.5 bg-slate-900 rounded-lg border border-emerald-500/60 animate-in fade-in">
                    <input
                      type="text"
                      autoFocus
                      value={newCatName}
                      placeholder="Nama kantong baru..."
                      onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddNewCategory(it.key, newCatName);
                        } else if (e.key === 'Escape') {
                          setNewCatTargetKey(null);
                        }
                      }}
                      className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 px-2 py-1 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddNewCategory(it.key, newCatName)}
                      disabled={!newCatName.trim()}
                      className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold disabled:opacity-40 transition cursor-pointer"
                    >
                      Simpan
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewCatTargetKey(null)}
                      className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

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
          <p className="text-[11px] text-rose-300">
            Lengkapi baris bertanda merah (nominal, keterangan, tanggal, dan akun) sebelum menyimpan.
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={!allValid || isSaving}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 text-white font-bold text-sm shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
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
                    AI akan membaca total, toko, tanggal, dan barang utama dari struk.
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

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {renderItems()}
        </div>
      </div>
    </div>
  );
};