import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Sparkles, X, Camera, Check, AlertCircle, Trash2, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Account, Transaction } from '../types/finance.ts';
import { parseMultiLineText, ParsedTransactionResult } from '../lib/autoParser.ts';
import { parseReceiptWithGemini, parseTextWithGemini, compressImage } from '../lib/aiParser.ts';
import { formatRupiah } from '../utils/formatters.ts';
import { INITIAL_KANTONG, INITIAL_CATEGORIES } from '../data/initialData.ts';

interface AutoRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTransactions: (transactions: Omit<Transaction, 'id'>[]) => Promise<boolean> | void;
  accounts: Account[];
  categories: string[];
  kantongList?: string[];
  transactions?: Transaction[];
  onAddCategory?: (name: string) => Promise<any> | void;
  onAddKantong?: (name: string) => Promise<any> | void;
}

type Item = ParsedTransactionResult & { key: string };

const inputCls =
  'w-full bg-slate-900 text-white text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition';

const labelCls = 'block text-xs font-medium text-slate-300 mb-1';

const isExcludedCategory = (name?: string) => {
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

export const AutoRecordModal: React.FC<AutoRecordModalProps> = ({
  isOpen,
  onClose,
  onAddTransactions,
  accounts,
  categories,
  kantongList,
  transactions = [],
  onAddCategory,
  onAddKantong,
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

  // Inline tambah kantong / kategori baru per baris
  const [addingKantongForKey, setAddingKantongForKey] = useState<string | null>(null);
  const [newKantongInput, setNewKantongInput] = useState('');
  const [addingCategoryForKey, setAddingCategoryForKey] = useState<string | null>(null);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);

  // Daftar Kantong (Pos Anggaran) yang sama dengan form Catat utama
  const allKantong = useMemo(() => {
    const set = new Set<string>();
    (kantongList && kantongList.length > 0 ? kantongList : INITIAL_KANTONG).forEach(k => {
      if (!isExcludedCategory(k)) set.add(k.trim());
    });
    transactions.forEach(t => {
      const kt = t.kantong && t.kantong.trim() && t.kantong !== '-' ? t.kantong.trim() : '';
      if (kt && !isExcludedCategory(kt)) set.add(kt);
    });
    return Array.from(set);
  }, [kantongList, transactions]);

  // Daftar Kategori yang sama dengan form Catat utama
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    (categories && categories.length > 0 ? categories : INITIAL_CATEGORIES).forEach(c => {
      if (!isExcludedCategory(c)) set.add(c.trim());
    });
    transactions.forEach(t => {
      if (t.category && !isExcludedCategory(t.category)) {
        set.add(t.category.trim());
      }
    });
    return Array.from(set);
  }, [categories, transactions]);

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

  const normalizeItemSelections = (it: ParsedTransactionResult): ParsedTransactionResult => {
    const rawKt = (it.kantong || '').trim();
    const rawCat = (it.category || '').trim();

    const matchedKt =
      allKantong.find(k => k.toLowerCase() === rawKt.toLowerCase()) ||
      allKantong.find(k => k.toLowerCase() === rawCat.toLowerCase()) ||
      '';

    const matchedCat =
      allCategories.find(c => c.toLowerCase() === rawCat.toLowerCase()) ||
      allCategories.find(c => c.toLowerCase() === rawKt.toLowerCase()) ||
      '';

    return {
      ...it,
      kantong: matchedKt,
      category: matchedCat,
      notes: (it.notes || '').trim(),
    };
  };

  const withKeys = (list: ParsedTransactionResult[]): Item[] =>
    list.map(it => ({ ...normalizeItemSelections(it), key: `i${keyRef.current++}` }));

  const resetAll = () => {
    setTextInput('');
    setItems([]);
    setReceiptImage(null);
    setLastReceiptFile(null);
    setError(null);
    setNotice(null);
    setAddingKantongForKey(null);
    setNewKantongInput('');
    setAddingCategoryForKey(null);
    setNewCategoryInput('');
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

  // Validasi sebelum simpan: tanggal, akun, nama/judul, nominal > 0, dan minimal kantong atau kategori dipilih
  const isItemValid = (it: Item) => {
    const isTransfer = Boolean(it.transferTargetAccountId);
    const hasKantongOrCategory =
      isTransfer || Boolean((it.kantong && it.kantong.trim()) || (it.category && it.category.trim()));
    return (
      it.amount > 0 &&
      it.description.trim().length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(it.date) &&
      accounts.some(a => a.id === it.accountId) &&
      hasKantongOrCategory
    );
  };

  const allValid = items.length > 0 && items.every(isItemValid);

  const handleSaveNewKantong = (itemKey: string) => {
    const trimmed = newKantongInput.trim();
    if (!trimmed || isExcludedCategory(trimmed)) return;
    if (onAddKantong) {
      onAddKantong(trimmed);
    }
    updateItem(itemKey, { kantong: trimmed });
    setNewKantongInput('');
    setAddingKantongForKey(null);
  };

  const handleSaveNewCategory = (itemKey: string) => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed || isExcludedCategory(trimmed)) return;
    if (onAddCategory) {
      onAddCategory(trimmed);
    }
    updateItem(itemKey, { category: trimmed });
    setNewCategoryInput('');
    setAddingCategoryForKey(null);
  };

  // Analisis teks dengan AI; jika gagal, pakai pembaca lokal
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
        const localItems = local.map(it => ({
          ...it,
          kantong: '',
          category: '',
          notes: '',
        }));
        setItems(withKeys(localItems));
        setNotice(
          'Hasil diekstrak dengan pembaca cerdas lokal. Silakan pilih Kantong dan Kategori untuk masing-masing transaksi sebelum disimpan.'
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
      const img = await compressImage(file);
      setReceiptImage(img.preview);
      const res = await parseReceiptWithGemini(img.base64, img.mimeType);
      if (res.length === 0) {
        setNotice('Tidak ada transaksi yang terbaca dari foto. Coba foto yang lebih terang dan tegak lurus.');
      }
      setItems(withKeys(res));
    } catch (err: any) {
      console.error('Scan receipt failed:', err);
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

  // Simpan semua baris pratinjau (sama persis dengan logika simpan di form utama)
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
        const chosenKantong = (it.kantong || '').trim() || (it.category || '').trim();
        const chosenCategory = (it.category || '').trim() || (it.kantong || '').trim();
        if (!chosenKantong && !chosenCategory) continue;

        const trimmedCatatan = (it.notes || '').trim();

        toSave.push({
          date: it.date,
          description: it.description.trim() || 'Transaksi',
          accountId: it.accountId,
          type: it.type,
          category: chosenCategory,
          kantong: chosenKantong || undefined,
          amount: it.amount,
          notes: trimmedCatatan || undefined,
          catatan: trimmedCatatan || undefined,
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

        <div className="max-h-[48vh] overflow-y-auto space-y-3 pr-1">
          {items.map((it, index) => {
            const valid = isItemValid(it);
            const isTransfer = Boolean(it.transferTargetAccountId);

            return (
              <div
                key={it.key}
                className={`rounded-2xl border p-3.5 space-y-3 transition ${
                  valid ? 'bg-slate-800/70 border-slate-700/70' : 'bg-rose-950/25 border-rose-500/50'
                }`}
              >
                {/* Header baris transaksi + Tombol Hapus */}
                <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
                  <span className="text-xs font-bold text-emerald-400">
                    {isTransfer ? `Transaksi #${index + 1} (Pindah Saldo)` : `Transaksi #${index + 1}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(it.key)}
                    title="Hapus transaksi ini"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer flex items-center gap-1 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="text-[11px]">Hapus</span>
                  </button>
                </div>

                {/* Baris 1: Nama / Judul & Nominal (Rp) */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Nama / Judul</label>
                    <input
                      type="text"
                      value={it.description}
                      onChange={e => updateItem(it.key, { description: e.target.value })}
                      placeholder="mis. Pemasukan Toko"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Nominal (Rp)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={it.amount ? it.amount.toLocaleString('id-ID') : ''}
                      onChange={e =>
                        updateItem(it.key, { amount: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })
                      }
                      placeholder="0"
                      className={`${inputCls} font-mono font-bold`}
                    />
                  </div>
                </div>

                {/* Baris 2: Jenis & Akun (atau Dari Akun & Ke Akun jika pindah saldo) */}
                {isTransfer ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Dari Akun</label>
                      <select
                        value={it.accountId}
                        onChange={e => updateItem(it.key, { accountId: e.target.value })}
                        className={`${inputCls} cursor-pointer`}
                      >
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Ke Akun</label>
                      <select
                        value={it.transferTargetAccountId}
                        onChange={e => updateItem(it.key, { transferTargetAccountId: e.target.value })}
                        className={`${inputCls} cursor-pointer`}
                      >
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Jenis</label>
                      <select
                        value={it.type}
                        onChange={e => updateItem(it.key, { type: e.target.value as 'masuk' | 'keluar' })}
                        className={`${inputCls} cursor-pointer font-semibold ${
                          it.type === 'masuk' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        <option value="keluar" className="text-white">Keluar</option>
                        <option value="masuk" className="text-white">Masuk</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Akun</label>
                      <select
                        value={it.accountId}
                        onChange={e => updateItem(it.key, { accountId: e.target.value })}
                        className={`${inputCls} cursor-pointer`}
                      >
                        <option value="">— Pilih Akun —</option>
                        {accounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Baris 3: Kantong (Pos Anggaran) & Kategori */}
                {!isTransfer && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>
                        Kantong <span className="text-slate-400 font-normal">(Pos Anggaran)</span>
                      </label>
                      <select
                        value={it.kantong || ''}
                        onChange={e => {
                          if (e.target.value === '__NEW_KANTONG__') {
                            setAddingKantongForKey(it.key);
                            setNewKantongInput('');
                          } else {
                            updateItem(it.key, { kantong: e.target.value });
                          }
                        }}
                        className={`${inputCls} cursor-pointer ${
                          !it.kantong && !it.category ? 'border-amber-400/80' : ''
                        }`}
                      >
                        <option value="">— Pilih Kantong —</option>
                        {allKantong.map(kt => (
                          <option key={kt} value={kt}>
                            {kt}
                          </option>
                        ))}
                        <option disabled>──────────</option>
                        <option value="__NEW_KANTONG__">+ Tambah Kantong Baru</option>
                      </select>

                      {addingKantongForKey === it.key && (
                        <div className="mt-2 bg-slate-900/90 p-2 rounded-lg border border-slate-700 space-y-1.5">
                          <div className="text-[11px] font-bold text-slate-300">+ Kantong Baru:</div>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={newKantongInput}
                              onChange={e => setNewKantongInput(e.target.value)}
                              placeholder="Nama kantong..."
                              className="flex-1 min-w-0 bg-slate-800 text-white text-xs rounded-md px-2 py-1 border border-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveNewKantong(it.key);
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveNewKantong(it.key)}
                              disabled={!newKantongInput.trim()}
                              className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-40 cursor-pointer"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAddingKantongForKey(null);
                                setNewKantongInput('');
                              }}
                              className="px-1.5 py-1 rounded-md text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={labelCls}>Kategori</label>
                      <select
                        value={it.category || ''}
                        onChange={e => {
                          if (e.target.value === '__NEW_CATEGORY__') {
                            setAddingCategoryForKey(it.key);
                            setNewCategoryInput('');
                          } else {
                            updateItem(it.key, { category: e.target.value });
                          }
                        }}
                        className={`${inputCls} cursor-pointer ${
                          !it.kantong && !it.category ? 'border-amber-400/80' : ''
                        }`}
                      >
                        <option value="">— Pilih Kategori —</option>
                        {allCategories.map(cat => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                        <option disabled>──────────</option>
                        <option value="__NEW_CATEGORY__">+ Tambah Kategori Baru</option>
                      </select>

                      {addingCategoryForKey === it.key && (
                        <div className="mt-2 bg-slate-900/90 p-2 rounded-lg border border-slate-700 space-y-1.5">
                          <div className="text-[11px] font-bold text-slate-300">+ Kategori Baru:</div>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={newCategoryInput}
                              onChange={e => setNewCategoryInput(e.target.value)}
                              placeholder="Nama kategori..."
                              className="flex-1 min-w-0 bg-slate-800 text-white text-xs rounded-md px-2 py-1 border border-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveNewCategory(it.key);
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveNewCategory(it.key)}
                              disabled={!newCategoryInput.trim()}
                              className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-40 cursor-pointer"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAddingCategoryForKey(null);
                                setNewCategoryInput('');
                              }}
                              className="px-1.5 py-1 rounded-md text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Baris 4: Tanggal & Catatan (opsional) */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Tanggal</label>
                    <input
                      type="date"
                      value={it.date}
                      onChange={e => updateItem(it.key, { date: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Catatan <span className="text-slate-400 font-normal">(opsional)</span>
                    </label>
                    <input
                      type="text"
                      value={it.notes || ''}
                      onChange={e => updateItem(it.key, { notes: e.target.value })}
                      placeholder="Rincian item, harga & total per item"
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!allValid && (
          <p className="text-[11px] text-amber-300">
            Lengkapi Nama / Judul, Nominal (&gt; 0), Tanggal, serta pilih Kantong atau Kategori sebelum menyimpan.
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
                AI membaca nama/judul, nominal, kantong, kategori, akun, tanggal, dan catatan dari teks atau foto struk
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
                rows={4}
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
