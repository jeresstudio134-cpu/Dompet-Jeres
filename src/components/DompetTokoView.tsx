import React, { useState } from 'react';
import { 
  Calendar, 
  Filter as FilterIcon, 
  RotateCcw, 
  Sparkles, 
  Database, 
  Download, 
  Trash2, 
  Search, 
  Lock,
  ShieldCheck,
  Edit2,
  X,
  ArrowUpDown,
  ChevronDown,
  Settings,
  Check
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Transaction, Account, TransactionType, FilterState, MonthlyStats, NeonConfig } from '../types/finance.ts';
import { formatRupiah, getCurrentDateIndo, formatTanggalIndo, parseRupiahInput } from '../utils/formatters.ts';

// Pindah kategori disimpan sebagai dua baris berawalan "kt-":
// keluar dari kategori asal dan masuk ke kategori tujuan, di akun yang sama (saldo akun tidak berubah)
const isCatTransfer = (t: Transaction) => t.id.startsWith('kt-');

interface DompetTokoViewProps {
  accounts: Account[];
  transactions: Transaction[];
  stats: MonthlyStats;
  neonConfig: NeonConfig;
  onAddTransaction: (tx: Omit<Transaction, 'id'>) => Promise<boolean> | void;
  onTransfer: (fromAcc: string, toAcc: string, amount: number, date: string, notes: string) => Promise<boolean> | void;
  onTransferCategory: (
    fromCat: string,
    toCat: string,
    accountId: string,
    amount: number,
    date: string,
    notes: string
  ) => Promise<boolean>;
  onUndoLast: () => void;
  onDeleteTransaction: (id: string) => void;
  onEditTransaction: (tx: Transaction) => void;
  onOpenAutoRecord: () => void;
  onOpenNeonModal: () => void;
  onOpenExportImport: () => void;
  categories: string[];
  onAddCategory?: (newCategory: string) => void;
  onDeleteCategory?: (category: string) => void;
  filter: FilterState;
  onFilterChange: (newFilter: Partial<FilterState>) => void;
  monthOptions: { value: string; label: string }[];
  isAdmin: boolean;
  onOpenAdminModal: () => void;
  onLogoutAdmin: () => void;
  storeName?: string;
}

export const DompetTokoView: React.FC<DompetTokoViewProps> = ({
  accounts,
  transactions,
  stats,
  neonConfig,
  onAddTransaction,
  onTransfer,
  onTransferCategory,
  onUndoLast,
  onDeleteTransaction,
  onEditTransaction,
  onOpenAutoRecord,
  onOpenNeonModal,
  onOpenExportImport,
  categories,
  onAddCategory,
  onDeleteCategory,
  filter,
  onFilterChange,
  monthOptions,
  isAdmin,
  onOpenAdminModal,
  onLogoutAdmin,
  storeName,
}) => {
  const currentStoreName = storeName || 'Dompet Keuangan';

  // Tabs: 'catat' | 'pindah' | 'filter'
  const [activeTab, setActiveTab] = useState<'catat' | 'pindah' | 'filter'>('catat');

  // Sorting state untuk Riwayat Transaksi
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Editing state for Admin
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editKeterangan, setEditKeterangan] = useState('');
  const [editAkun, setEditAkun] = useState('cash');
  const [editJenis, setEditJenis] = useState<'masuk' | 'keluar'>('keluar');
  const [editNominalStr, setEditNominalStr] = useState('0');
  const [editKategori, setEditKategori] = useState('');
  const [editCatatan, setEditCatatan] = useState('');

  const handleStartEdit = (tx: Transaction) => {
    if (isCatTransfer(tx)) {
      alert('Pindah kategori tidak bisa diedit. Hapus lalu buat ulang dengan nominal yang benar.');
      return;
    }
    setEditingTx(tx);
    setEditDate(tx.date);
    setEditKeterangan(tx.description);
    setEditAkun(tx.accountId);
    setEditJenis(tx.type);
    setEditNominalStr(tx.amount.toLocaleString('id-ID'));
    setEditKategori(tx.category || '');
    setEditCatatan(tx.notes || '');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;

    const parsedAmount = parseRupiahInput(editNominalStr);
    if (parsedAmount <= 0) {
      alert('Nominal harus lebih dari 0.');
      return;
    }

    const updated: Transaction = {
      ...editingTx,
      date: editDate,
      description: editKeterangan.trim(),
      accountId: editAkun,
      type: editJenis,
      amount: parsedAmount,
      category: editKategori,
      notes: editCatatan.trim() || undefined,
    };

    onEditTransaction(updated);
    setEditingTx(null);
  };

  // Form states for 'Catat'
  const [tanggal, setTanggal] = useState(getCurrentDateIndo());
  const [jenis, setJenis] = useState<TransactionType>('keluar');
  const [selectedAkun, setSelectedAkun] = useState<string>('cash');
  const [keterangan, setKeterangan] = useState<string>('');
  const [nominalStr, setNominalStr] = useState<string>('');
  const [kategori, setKategori] = useState<string>('');

  // State for adding new category & managing/deleting categories
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [isManagingCategories, setIsManagingCategories] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // Form states for 'Pindah Saldo'
  const [transferDari, setTransferDari] = useState<string>('seabank');
  const [transferKe, setTransferKe] = useState<string>('cash');
  const [transferNominalStr, setTransferNominalStr] = useState<string>('');
  const [transferKeterangan, setTransferKeterangan] = useState<string>('');

  // Form states for 'Pindah Kategori'
  const [pindahMode, setPindahMode] = useState<'akun' | 'kategori'>('akun');
  const [ktDari, setKtDari] = useState<string>('');
  const [ktKe, setKtKe] = useState<string>('');
  const [ktAkun, setKtAkun] = useState<string>('');
  const [ktNominalStr, setKtNominalStr] = useState<string>('');
  const [ktKeterangan, setKtKeterangan] = useState<string>('');

  // Auto-sync account selections if accounts are added/edited/deleted
  React.useEffect(() => {
    if (accounts.length > 0) {
      if (!accounts.some(a => a.id === selectedAkun)) {
        setSelectedAkun(accounts[0].id);
      }
      if (!accounts.some(a => a.id === transferDari)) {
        setTransferDari(accounts[0].id);
      }
      if (!accounts.some(a => a.id === transferKe) || (transferKe === transferDari && accounts.length > 1)) {
        const other = accounts.find(a => a.id !== transferDari) || accounts[0];
        setTransferKe(other.id);
      }
    }
  }, [accounts, selectedAkun, transferDari, transferKe]);

  
    
   // Hanya menyimpan input keterangan tanpa auto-detect apapun
  const handleKeteranganChange = (val: string) => {
    setKeterangan(val);
  };   

    

  const handleNominalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      setNominalStr('');
      return;
    }
    const num = parseInt(raw, 10);
    setNominalStr(num.toLocaleString('id-ID'));
  };

  const handleTransferNominalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      setTransferNominalStr('');
      return;
    }
    const num = parseInt(raw, 10);
    setTransferNominalStr(num.toLocaleString('id-ID'));
  };

  const handleKtNominalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    setKtNominalStr(raw ? parseInt(raw, 10).toLocaleString('id-ID') : '0');
  };

  // Submit 'Catat'
  const handleSimpan = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseRupiahInput(nominalStr);
    if (!keterangan.trim() || amount <= 0) return;

    const ok = await onAddTransaction({
      date: tanggal,
      description: keterangan.trim(),
      accountId: selectedAkun,
      type: jenis,
      category: kategori || (jenis === 'masuk' ? 'Toko' : 'Pribadi'),
      amount,
    });

    if (ok === false) return;
    confetti({ particleCount: 30, spread: 50, origin: { y: 0.7 } });
    setKeterangan('');
    setNominalStr('0');
    setKategori('');
  };

  // Submit 'Pindah Saldo'
  const handlePindahSaldo = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseRupiahInput(transferNominalStr);
    if (amount <= 0 || transferDari === transferKe) return;

    const ok = await onTransfer(
      transferDari, 
      transferKe, 
      amount, 
      tanggal, 
      transferKeterangan.trim() || 'Pindah'
    );

    if (ok === false) return;
    confetti({ particleCount: 35, spread: 60, origin: { y: 0.7 } });
    setTransferNominalStr('0');
    setTransferKeterangan('');
  };

  // Helper to exclude any 'lainnya' / 'lainya' / empty strings
  const isExcludedCategory = (name?: string) => {
    if (!name) return true;
    const lower = name.trim().toLowerCase();
    return lower === '' || lower === '-' || lower === 'lainnya' || lower === 'lainya' || lower === 'lain-lain' || lower === 'lain nya';
  };

  // Function to save newly created category
  const handleSaveNewCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed || isExcludedCategory(trimmed)) return;
    if (onAddCategory) {
      onAddCategory(trimmed);
    }
    setKategori(trimmed);
    setNewCategoryInput('');
    setIsAddingNewCategory(false);
  };

  // Function to delete a category
  const handleDeleteCategory = (catToDelete: string) => {
    if (onDeleteCategory) {
      onDeleteCategory(catToDelete);
    }
    if (kategori === catToDelete) {
      setKategori('');
    }
  };

  // All unique categories for filter & recording (strictly excluding 'Lainnya' / 'lainya')
  const allCategories = React.useMemo(() => {
    const set = new Set<string>();
    categories.forEach(c => {
      if (!isExcludedCategory(c)) set.add(c.trim());
    });
    transactions.forEach(t => {
      if (!isExcludedCategory(t.category)) {
        set.add(t.category!.trim());
      }
    });
    return Array.from(set);
  }, [categories, transactions]);

  // Saldo kantong sebuah kategori (semua transaksi, termasuk pindah kategori)
  const pocketBalance = (cat: string) =>
    transactions.reduce(
      (sum, t) => (t.category === cat ? sum + (t.type === 'masuk' ? t.amount : -t.amount) : sum),
      0
    );

  const ktAkunId = accounts.some(a => a.id === ktAkun) ? ktAkun : accounts[0]?.id || '';

  // Submit 'Pindah Kategori'
  const handlePindahKategori = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseRupiahInput(ktNominalStr);
    if (!ktDari || !ktKe || ktDari === ktKe || amount <= 0 || !ktAkunId) return;

    const ok = await onTransferCategory(ktDari, ktKe, ktAkunId, amount, tanggal, ktKeterangan.trim());
    if (!ok) return;

    confetti({ particleCount: 35, spread: 60, origin: { y: 0.7 } });
    setKtNominalStr('0');
    setKtKeterangan('');
  };

  // Filter pagination limit
  const [filterDisplayCount, setFilterDisplayCount] = useState<number>(30);

  // Satu aturan filter dipakai bersama oleh daftar transaksi dan kedua rekap.
  // skip: abaikan satu filter supaya rekapnya tetap menampilkan semua pilihan (akun atau kategori)
  const matchesFilter = (t: Transaction, skip?: 'category' | 'account') => {
    if (filter.monthYear !== 'ALL' && !t.date.startsWith(filter.monthYear)) return false;
    if (filter.dateFrom && t.date < filter.dateFrom) return false;
    if (filter.dateTo && t.date > filter.dateTo) return false;
    if (skip !== 'account' && filter.accountId !== 'ALL' && t.accountId !== filter.accountId) return false;
    if (filter.type !== 'ALL' && t.type !== filter.type) return false;
    if (skip !== 'category' && filter.category !== 'ALL') {
      if (filter.category === 'EMPTY') {
        if (t.category && t.category.trim() !== '' && t.category !== '-') return false;
      } else if (t.category !== filter.category) {
        return false;
      }
    }
    if (filter.searchQuery.trim()) {
      const q = filter.searchQuery.toLowerCase();
      if (!t.description.toLowerCase().includes(q) && !t.category?.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const filteredList = transactions.filter(t => matchesFilter(t));

  // Kantong (kartu di halaman utama): saldo tiap kategori sepanjang waktu
  const pockets = (() => {
    const map = new Map<string, { masuk: number; keluar: number; pindah: number }>();
    transactions.forEach(t => {
      if (t.category === 'Pindah Saldo') return;
      const key = t.category && t.category.trim() && t.category !== '-' ? t.category : 'EMPTY';
      const row = map.get(key) || { masuk: 0, keluar: 0, pindah: 0 };
      if (isCatTransfer(t)) row.pindah += t.type === 'masuk' ? t.amount : -t.amount;
      else if (t.type === 'masuk') row.masuk += t.amount;
      else row.keluar += t.amount;
      map.set(key, row);
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: key === 'EMPTY' ? 'Tanpa Kategori' : key,
        masuk: v.masuk,
        keluar: v.keluar,
        pindah: v.pindah,
        saldo: v.masuk - v.keluar + v.pindah,
      }))
      .sort((a, b) => b.masuk + b.keluar + Math.abs(b.pindah) - (a.masuk + a.keluar + Math.abs(a.pindah)));
  })();

  // Selisih antara total akun dan total kantong (mis. saldo awal akun yang belum punya kantong)
  const totalAkun = accounts.reduce((sum, a) => sum + (stats.accountBalances[a.id] ?? 0), 0);
  const totalKantong = pockets.reduce((sum, p) => sum + p.saldo, 0);
  const diluarKantong = totalAkun - totalKantong;

  // Rekap per kantong (kategori): ikut semua filter kecuali filter kategori
  const categoryRecap = (() => {
    const map = new Map<string, { masuk: number; keluar: number; pindah: number }>();
    transactions.forEach(t => {
      if (!matchesFilter(t, 'category')) return;
      if (t.category === 'Pindah Saldo') return;
      const key = t.category && t.category.trim() && t.category !== '-' ? t.category : 'EMPTY';
      const row = map.get(key) || { masuk: 0, keluar: 0, pindah: 0 };
      if (isCatTransfer(t)) row.pindah += t.type === 'masuk' ? t.amount : -t.amount;
      else if (t.type === 'masuk') row.masuk += t.amount;
      else row.keluar += t.amount;
      map.set(key, row);
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: key === 'EMPTY' ? 'Tanpa Kategori' : key,
        masuk: v.masuk,
        keluar: v.keluar,
        pindah: v.pindah,
        selisih: v.masuk - v.keluar + v.pindah,
      }))
      .sort((a, b) => b.masuk + b.keluar + Math.abs(b.pindah) - (a.masuk + a.keluar + Math.abs(a.pindah)));
  })();

  // Rekap per akun: ikut semua filter kecuali filter akun
  const accountRecap = accounts
    .map(acc => {
      let masuk = 0;
      let keluar = 0;
      let pindah = 0;
      transactions.forEach(t => {
        if (t.accountId !== acc.id || !matchesFilter(t, 'account')) return;
        if (isCatTransfer(t) && filter.category === 'ALL') return;
        if (t.category === 'Pindah Saldo') {
          pindah += t.type === 'masuk' ? t.amount : -t.amount;
        } else if (t.type === 'masuk') {
          masuk += t.amount;
        } else {
          keluar += t.amount;
        }
      });
      return { key: acc.id, label: acc.name, masuk, keluar, selisih: masuk - keluar, pindah };
    })
    .filter(r => r.masuk > 0 || r.keluar > 0 || r.pindah !== 0);

  const renderRecap = (
    title: string,
    rows: { key: string; label: string; masuk: number; keluar: number; selisih: number; pindah: number }[],
    selectedKey: string,
    onSelect: (key: string) => void,
    pindahLabel: string
  ) => {
    if (rows.length === 0 && selectedKey === 'ALL') return null;
    return (
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-2.5 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="font-bold text-slate-700">{title}</span>
          {selectedKey !== 'ALL' && (
            <button
              type="button"
              onClick={() => onSelect('ALL')}
              className="text-[11px] text-[#1e3a5f] hover:underline font-bold cursor-pointer"
            >
              Tampilkan semua
            </button>
          )}
        </div>

        {rows.length === 0 && <div className="px-2.5 py-2 text-slate-400">Tidak ada data.</div>}

        <div className="divide-y divide-slate-100">
          {rows.map(r => {
            const selected = selectedKey === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => onSelect(selected ? 'ALL' : r.key)}
                className={`w-full text-left flex items-center gap-2 px-2.5 py-2 transition cursor-pointer ${
                  selected ? 'bg-amber-50 border-l-4 border-amber-400' : 'hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800 truncate">{r.label}</div>
                  <div className="text-[11px] flex flex-wrap gap-x-2">
                    {r.masuk > 0 && <span className="text-emerald-700">Masuk {formatRupiah(r.masuk)}</span>}
                    {r.keluar > 0 && <span className="text-rose-700">Keluar {formatRupiah(r.keluar)}</span>}
                    {r.pindah !== 0 && (
                      <span className="text-sky-700">
                        {pindahLabel} {r.pindah > 0 ? '+' : '-'}{formatRupiah(Math.abs(r.pindah))}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`font-mono font-bold shrink-0 ${r.selisih >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {r.selisih < 0 ? '-' : ''}{formatRupiah(Math.abs(r.selisih))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Check if any filter criteria is active
  const isFilterActive = Boolean(
    filter.monthYear !== 'ALL' ||
    filter.accountId !== 'ALL' ||
    filter.type !== 'ALL' ||
    filter.category !== 'ALL' ||
    filter.searchQuery.trim() ||
    filter.dateFrom ||
    filter.dateTo
  );

  const handleResetFilter = () => {
    onFilterChange({
      monthYear: 'ALL',
      accountId: 'ALL',
      type: 'ALL',
      category: 'ALL',
      searchQuery: '',
      dateFrom: '',
      dateTo: '',
    });
  };

  const getAccountName = (id: string) => {
    return accounts.find(a => a.id === id)?.name || id;
  };

  // Urutkan transaksi untuk riwayat
  const sortedTransactions = React.useMemo(() => {
    return [...transactions].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      // Jika tanggal sama, urutkan berdasarkan ID (asumsi ID berurutan)
      if (dateA === dateB) {
        return sortOrder === 'desc' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
      }
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
  }, [transactions, sortOrder]);

  return (
    <div className="w-full space-y-3.5">
      
                  {/* Title & Header Toolbar */}
      <div className="flex items-start justify-between gap-2 pt-1 pb-0.5">
        {/* Kiri: Judul (bisa 2 baris) */}
        <h1 className="text-lg sm:text-xl font-extrabold text-[#1e3a5f] tracking-tight leading-tight flex-1 min-w-0">
          {currentStoreName}
        </h1>

        {/* Kanan: Tombol Admin/Kasir + Tombol Aksi */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Tombol Admin/Kasir — klik untuk buka modal pengaturan */}
          <button
            type="button"
            onClick={onOpenAdminModal}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border transition cursor-pointer whitespace-nowrap shrink-0 ${
              isAdmin
                ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-300'
            }`}
            title={isAdmin ? 'Pengaturan Admin (klik untuk buka)' : 'Login Admin (klik untuk buka)'}
          >
            {isAdmin ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>Admin</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>Kasir</span>
              </>
            )}
          </button>

          <button
            onClick={onOpenAutoRecord}
            title="Catat Otomatis dari Teks / Foto Struk"
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-xs transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>Otomatis</span>
          </button>

          <button
            onClick={onOpenNeonModal}
            title={neonConfig.isConnected ? 'Neon DB Terhubung' : 'Konfigurasi Neon DB & Vercel'}
            className={`p-1.5 rounded-md border text-xs transition cursor-pointer ${
              neonConfig.isConnected
                ? 'bg-cyan-50 border-cyan-300 text-cyan-700 hover:bg-cyan-100'
                : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Database className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenExportImport}
            title="Ekspor ke Excel / Backup Data"
            className="p-1.5 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 text-xs transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Akun: di mana uangnya berada */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide px-0.5">
          Akun
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {accounts.map(acc => {
            const balance = stats.accountBalances[acc.id] ?? 0;
            return (
              <div 
                key={acc.id}
                className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-xs"
              >
                <div className="text-[11px] font-medium text-slate-500 leading-tight">
                  {acc.name}
                </div>
                <div className="text-sm font-bold text-slate-800 tracking-tight mt-0.5">
                  {formatRupiah(balance)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Kantong (kategori): jatah uang tiap kategori, klik untuk melihat detailnya di tab Filter */}
      {pockets.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide px-0.5">
            Kantong
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {pockets.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  onFilterChange({ category: p.key });
                  setActiveTab('filter');
                }}
                className="text-left bg-white rounded-xl border border-slate-200/90 p-3 shadow-xs hover:border-[#1e3a5f]/40 transition cursor-pointer"
              >
                <div className="text-[11px] font-medium text-slate-500 leading-tight">{p.label}</div>
                <div className={`text-sm font-bold tracking-tight mt-0.5 ${p.saldo < 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                  {p.saldo < 0 ? '-' : ''}{formatRupiah(Math.abs(p.saldo))}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug break-words">
                  +{formatRupiah(p.masuk)} · -{formatRupiah(p.keluar)}
                  {p.pindah !== 0 && (
                    <> · pindah {p.pindah > 0 ? '+' : '-'}{formatRupiah(Math.abs(p.pindah))}</>
                  )}
                </div>
              </button>
            ))}

                        {diluarKantong !== 0 && (
                <div className={diluarKantong < 0 ? 'rounded-xl border border-dashed p-3 bg-rose-50/60 border-rose-300' : 'rounded-xl border border-dashed p-3 bg-slate-50 border-slate-300'}>
                  <div className={diluarKantong < 0 ? 'text-[11px] font-bold leading-tight text-rose-700' : 'text-[11px] font-bold leading-tight text-slate-600'}>
                    {diluarKantong < 0 ? 'Tidak Sinkron Akun dan Kantong' : 'Di Luar Kantong'}
                  </div>
                  <div className={diluarKantong < 0 ? 'text-sm font-bold tracking-tight mt-0.5 text-rose-800' : 'text-sm font-bold tracking-tight mt-0.5 text-slate-600'}>
                    {diluarKantong < 0 ? '-' : '+'}{formatRupiah(Math.abs(diluarKantong))}
                  </div>
                  <div className={diluarKantong < 0 ? 'text-[10px] mt-0.5 leading-snug text-rose-600' : 'text-[10px] mt-0.5 leading-snug text-slate-400'}>
                    {diluarKantong < 0 ? 'Cek data nominal & transaksi pindah' : 'Saldo awal akun / belum dialokasikan'}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}

      {/* 3 Summary KPIs (Masuk, Keluar, Sisa) */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-xl border border-slate-200/90 p-2.5 shadow-xs text-center">
          <div className="text-[10px] font-semibold text-slate-500">Masuk</div>
          <div className="text-xs font-bold text-emerald-700 tracking-tight mt-0.5 truncate">
            {formatRupiah(stats.totalMasuk)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 p-2.5 shadow-xs text-center">
          <div className="text-[10px] font-semibold text-slate-500">Keluar</div>
          <div className="text-xs font-bold text-rose-700 tracking-tight mt-0.5 truncate">
            {formatRupiah(stats.totalKeluar)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 p-2.5 shadow-xs text-center">
          <div className="text-[10px] font-semibold text-slate-500">Sisa</div>
          <div className="text-xs font-bold text-[#1e3a5f] tracking-tight mt-0.5 truncate">
            {formatRupiah(stats.sisaSaldo)}
          </div>
        </div>
      </div>

      {/* Main Container Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-4 overflow-hidden">
        
        {/* Navigation Tabs: Catat | Pindah Saldo | Filter */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('catat')}
            className={`py-2 px-2 text-xs font-bold rounded-lg border transition ${
              activeTab === 'catat'
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Catat
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pindah')}
            className={`py-2 px-2 text-xs font-bold rounded-lg border transition ${
              activeTab === 'pindah'
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Pindah Saldo
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('filter')}
            className={`py-2 px-2 text-xs font-bold rounded-lg border transition ${
              activeTab === 'filter'
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Filter
          </button>
        </div>

        {/* TAB 1: CATAT TRANSAKSI */}
        {activeTab === 'catat' && (
          <form onSubmit={handleSimpan} className="space-y-3.5">
            
            {/* Tanggal */}
            <div className="w-full min-w-0">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Tanggal
              </label>
              <div className="relative w-full min-w-0">
                <input
                  type="date"
                  value={tanggal}
                  onChange={(e) => setTanggal(e.target.value)}
                  className="block w-full max-w-full box-border bg-white text-slate-800 text-xs sm:text-sm rounded-lg pl-3 pr-10 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] focus:border-[#1e3a5f] transition font-medium cursor-pointer"
                />
                <Calendar className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Jenis: Masuk / Keluar Toggle */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Jenis
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setJenis('masuk')}
                  className={`py-2 rounded-lg text-xs font-bold border transition ${
                    jenis === 'masuk'
                      ? 'bg-[#15803d] text-white border-[#15803d] shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Masuk
                </button>
                <button
                  type="button"
                  onClick={() => setJenis('keluar')}
                  className={`py-2 rounded-lg text-xs font-bold border transition ${
                    jenis === 'keluar'
                      ? 'bg-[#a83232] text-white border-[#a83232] shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Keluar
                </button>
              </div>
            </div>

            {/* Akun */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Akun
              </label>
              <div className="grid grid-cols-2 gap-2">
                {accounts.map(acc => {
                  const isSelected = selectedAkun === acc.id;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => setSelectedAkun(acc.id)}
                      className={`py-2 rounded-lg text-xs font-bold border transition ${
                        isSelected
                          ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-xs'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {acc.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Keterangan */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Keterangan
              </label>
              <input
                type="text"
                required
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="mis. Pemasukan Toko"
                className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] focus:border-[#1e3a5f] transition"
              />
            </div>

            {/* Nominal (Rp) */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nominal (Rp)
              </label>
              <input
                type="text"
                required
                value={nominalStr}
                onChange={handleNominalChange}
                placeholder="0"
                className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] focus:border-[#1e3a5f] font-mono transition"
              />
            </div>

            {/* Kategori (opsional) */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Kategori (opsional)
              </label>

              <select
                value={kategori}
                onChange={(e) => {
                  if (e.target.value === '__NEW__') {
                    setIsAddingNewCategory(true);
                    setIsManagingCategories(false);
                  } else if (e.target.value === '__MANAGE__') {
                    setIsManagingCategories(true);
                    setIsAddingNewCategory(false);
                  } else if (e.target.value === '__LOCKED_MANAGE__') {
                    onOpenAdminModal();
                  } else {
                    setKategori(e.target.value);
                  }
                }}
                className="w-full bg-white text-slate-700 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] focus:border-[#1e3a5f] transition cursor-pointer"
              >
                <option value="">— tanpa kategori —</option>
                {allCategories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option disabled>──────────</option>
                <option value="__NEW__" className="font-bold text-[#1e3a5f]">
                  +Tambah Kategori
                </option>
                {isAdmin ? (
                  <option value="__MANAGE__" className="font-bold text-rose-600">
                    -Hapus Kategori (Admin)
                  </option>
                ) : (
                  <option value="__LOCKED_MANAGE__" className="text-slate-400">
                    🔒 Hapus Kategori (Perlu PIN Admin)
                  </option>
                )}
              </select>

              {/* Inline input for adding a new category */}
              {isAddingNewCategory && (
                <div className="mt-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 animate-in fade-in space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-700">
                    + Tambah Kategori Baru:
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      placeholder="Nama kategori baru..."
                      className="flex-1 bg-white text-xs rounded-md px-2.5 py-1.5 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveNewCategory();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSaveNewCategory}
                      disabled={!newCategoryInput.trim()}
                      className="px-3 py-1.5 rounded-md bg-[#1e3a5f] hover:bg-[#162c47] text-white text-xs font-bold transition disabled:opacity-40 cursor-pointer"
                    >
                      Simpan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingNewCategory(false);
                        setNewCategoryInput('');
                      }}
                      className="px-2 py-1.5 rounded-md text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}

              {/* Inline panel for managing / deleting categories */}
              {isManagingCategories && (
                <div className="mt-2 bg-rose-50/60 p-2.5 rounded-lg border border-rose-200 animate-in fade-in space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>- Hapus Kategori</span>
                      </div>
                      <p className="text-[10px] sm:text-[11px] text-slate-500">
                        Klik tombol hapus pada kategori yang ingin dihilangkan.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsManagingCategories(false)}
                      className="px-2.5 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-bold border border-slate-300 shadow-2xs cursor-pointer"
                    >
                      Selesai
                    </button>
                  </div>

                  {/* List of categories with delete buttons */}
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1 divide-y divide-rose-100">
                    {allCategories.length === 0 ? (
                      <div className="text-center py-2 text-slate-400 text-xs">
                        Belum ada kategori tersimpan.
                      </div>
                    ) : (
                      allCategories.map(cat => (
                        <div key={cat} className="flex items-center justify-between pt-1.5 first:pt-0">
                          <span className="text-xs font-medium text-slate-800 bg-white px-2 py-1 rounded border border-slate-200 shadow-2xs">
                            {cat}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat)}
                            className="px-2 py-1 rounded-md text-rose-600 hover:text-rose-800 hover:bg-rose-100 transition flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                            title={`Hapus kategori "${cat}"`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Hapus</span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Tombol SIMPAN */}
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#1b7a4b] hover:bg-[#156a40] text-white font-bold text-sm tracking-wide shadow-sm transition active:scale-[0.99] cursor-pointer"
            >
              SIMPAN
            </button>

            {/* Batalkan transaksi terakhir - Hanya di Mode Admin */}
            {isAdmin && (
              <button
                type="button"
                onClick={onUndoLast}
                disabled={transactions.length === 0}
                className="w-full py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 hover:text-slate-800 font-medium text-xs transition disabled:opacity-40 cursor-pointer"
              >
                Batalkan transaksi terakhir
              </button>
            )}

          </form>
        )}

        {/* TAB 2: PINDAH (antar akun / antar kategori) */}
        {activeTab === 'pindah' && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPindahMode('akun')}
                className={`py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  pindahMode === 'akun'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Antar Akun
              </button>
              <button
                type="button"
                onClick={() => setPindahMode('kategori')}
                className={`py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  pindahMode === 'kategori'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Antar Kategori
              </button>
            </div>

            {pindahMode === 'kategori' ? (
              <form onSubmit={handlePindahKategori} className="space-y-3.5">
                <p className="text-[11px] text-slate-500">
                  Pindahkan jatah uang antar kategori, mis. diambil dari Toko untuk Pokok. Saldo akun tidak berubah.
                </p>

                {/* Tanggal */}
                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tanggal
                  </label>
                  <div className="relative w-full min-w-0">
                    <input
                      type="date"
                      value={tanggal}
                      onChange={(e) => setTanggal(e.target.value)}
                      className="block w-full max-w-full box-border bg-white text-slate-800 text-xs sm:text-sm rounded-lg pl-3 pr-10 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] transition cursor-pointer"
                    />
                    <Calendar className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Diambil dari kategori */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Diambil dari kategori
                  </label>
                  <select
                    value={ktDari}
                    onChange={(e) => setKtDari(e.target.value)}
                    className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                  >
                    <option value="">— pilih kategori —</option>
                    {allCategories.filter(c => c !== 'Pindah Saldo').map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {ktDari && (
                    <p className={`text-[11px] mt-1 ${pocketBalance(ktDari) < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                      Saldo kantong {ktDari}: {pocketBalance(ktDari) < 0 ? '-' : ''}{formatRupiah(Math.abs(pocketBalance(ktDari)))}
                    </p>
                  )}
                </div>

                {/* Untuk kategori */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Untuk kategori
                  </label>
                  <select
                    value={ktKe}
                    onChange={(e) => setKtKe(e.target.value)}
                    className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                  >
                    <option value="">— pilih kategori —</option>
                    {allCategories.filter(c => c !== 'Pindah Saldo' && c !== ktDari).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {ktKe && (
                    <p className={`text-[11px] mt-1 ${pocketBalance(ktKe) < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                      Saldo kantong {ktKe}: {pocketBalance(ktKe) < 0 ? '-' : ''}{formatRupiah(Math.abs(pocketBalance(ktKe)))}
                    </p>
                  )}
                </div>

                {/* Dicatat di akun */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Dicatat di akun
                  </label>
                  <select
                    value={ktAkunId}
                    onChange={(e) => setKtAkun(e.target.value)}
                    className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                {/* Nominal */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nominal (Rp)
                  </label>
                  <input
                    type="text"
                    required
                    value={ktNominalStr}
                    onChange={handleKtNominalChange}
                    placeholder="0"
                    className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] font-mono transition"
                  />
                </div>

                {/* Keterangan */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Keterangan (opsional)
                  </label>
                  <input
                    type="text"
                    value={ktKeterangan}
                    onChange={(e) => setKtKeterangan(e.target.value)}
                    placeholder="mis. Jatah bulanan"
                    className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!ktDari || !ktKe || parseRupiahInput(ktNominalStr) <= 0}
                  className="w-full py-2.5 rounded-lg bg-[#1e3a5f] hover:bg-[#162c47] disabled:opacity-40 text-white font-bold text-sm tracking-wide shadow-sm transition active:scale-[0.99] cursor-pointer"
                >
                  PINDAH KATEGORI
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={onUndoLast}
                    disabled={transactions.length === 0}
                    className="w-full py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 hover:text-slate-800 font-medium text-xs transition disabled:opacity-40 cursor-pointer"
                  >
                    Batalkan transaksi terakhir
                  </button>
                )}
              </form>
            ) : (
              <form onSubmit={handlePindahSaldo} className="space-y-3.5">
                
                {/* Tanggal */}
                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tanggal
                  </label>
                  <div className="relative w-full min-w-0">
                    <input
                      type="date"
                      value={tanggal}
                      onChange={(e) => setTanggal(e.target.value)}
                      className="block w-full max-w-full box-border bg-white text-slate-800 text-xs sm:text-sm rounded-lg pl-3 pr-10 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] transition cursor-pointer"
                    />
                    <Calendar className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Dari Akun */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Dari Akun (Sumber Dana)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {accounts.map(acc => {
                      const isSelected = transferDari === acc.id;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => setTransferDari(acc.id)}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${
                            isSelected
                              ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {acc.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ke Akun */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ke Akun (Tujuan Transfer)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {accounts.map(acc => {
                      const isSelected = transferKe === acc.id;
                      const isSame = transferDari === acc.id;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          disabled={isSame}
                          onClick={() => setTransferKe(acc.id)}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${
                            isSelected
                              ? 'bg-[#15803d] text-white border-[#15803d]'
                              : isSame
                              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {acc.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Nominal (Rp) */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nominal Pindah (Rp)
                  </label>
                  <input
                    type="text"
                    required
                    value={transferNominalStr}
                    onChange={handleTransferNominalChange}
                    placeholder="0"
                    className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] font-mono transition"
                  />
                </div>

                {/* Keterangan */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Keterangan (opsional)
                  </label>
                  <input
                    type="text"
                    value={transferKeterangan}
                    onChange={(e) => setTransferKeterangan(e.target.value)}
                    placeholder="mis. Pindah dari TF / Pindah ke Cash"
                    className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-lg px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] transition"
                  />
                </div>

                {/* Tombol PINDAH SALDO */}
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-[#1e3a5f] hover:bg-[#162c47] text-white font-bold text-sm tracking-wide shadow-sm transition active:scale-[0.99] cursor-pointer"
                >
                  PINDAH SALDO
                </button>

                {/* Batalkan transaksi terakhir - Hanya di Mode Admin */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={onUndoLast}
                    disabled={transactions.length === 0}
                    className="w-full py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 hover:text-slate-800 font-medium text-xs transition disabled:opacity-40 cursor-pointer"
                  >
                    Batalkan transaksi terakhir
                  </button>
                )}

              </form>
            )}
          </div>
        )}

        {/* TAB 3: FILTER & PELACAKAN BULANAN */}
        {activeTab === 'filter' && (
          <div className="space-y-3.5 text-xs">
            
            {/* Header Toolbar Filter: Judul & Tombol Reset Filter */}
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
              <span className="font-bold text-slate-700 text-xs flex items-center gap-1.5">
                <FilterIcon className="w-3.5 h-3.5 text-[#1e3a5f]" />
                Filter Transaksi
              </span>
              <button
                type="button"
                onClick={handleResetFilter}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer active:scale-95 ${
                  isFilterActive
                    ? 'bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                }`}
                title="Reset semua filter kembali ke awal"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filter</span>
              </button>
            </div>

            {/* Periode Bulan Selector */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Pilih Periode Bulan:
              </label>
              <select
                value={filter.monthYear}
                onChange={(e) => onFilterChange({ monthYear: e.target.value })}
                className="w-full bg-white text-slate-800 rounded-lg p-2 border border-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
              >
                {monthOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Rentang Tanggal (Dari Tanggal — Sampai Tanggal) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700">
                  Rentang Tanggal (Dari — Sampai):
                </label>
                {(filter.dateFrom || filter.dateTo) && (
                  <button
                    type="button"
                    onClick={() => onFilterChange({ dateFrom: '', dateTo: '' })}
                    className="text-[11px] text-[#1e3a5f] hover:underline font-bold cursor-pointer"
                  >
                    Reset Tanggal
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="block text-[11px] text-slate-500 mb-0.5 font-medium">Dari Tanggal:</span>
                  <input
                    type="date"
                    value={filter.dateFrom || ''}
                    onChange={(e) => onFilterChange({ dateFrom: e.target.value })}
                    className={`w-full rounded-lg p-2 border font-medium focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] text-xs transition ${
                      filter.dateFrom 
                        ? 'bg-amber-50/60 border-amber-400 text-slate-900 font-semibold' 
                        : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  />
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500 mb-0.5 font-medium">Sampai Tanggal:</span>
                  <input
                    type="date"
                    value={filter.dateTo || ''}
                    onChange={(e) => onFilterChange({ dateTo: e.target.value })}
                    className={`w-full rounded-lg p-2 border font-medium focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] text-xs transition ${
                      filter.dateTo 
                        ? 'bg-amber-50/60 border-amber-400 text-slate-900 font-semibold' 
                        : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Filter Kategori */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700">
                  Filter Kategori:
                </label>
                {filter.category !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => onFilterChange({ category: 'ALL' })}
                    className="text-[11px] text-[#1e3a5f] hover:underline font-bold"
                  >
                    Tampilkan Semua Kategori
                  </button>
                )}
              </div>
              <select
                value={filter.category}
                onChange={(e) => onFilterChange({ category: e.target.value })}
                className={`w-full rounded-lg p-2 border font-medium focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] transition ${
                  filter.category !== 'ALL' 
                    ? 'bg-amber-50/60 border-amber-400 text-slate-900 font-semibold' 
                    : 'bg-white border-slate-300 text-slate-800'
                }`}
              >
                <option value="ALL">Semua Kategori (Semua Jenis Pengeluaran & Pemasukan)</option>
                <option value="EMPTY">— Tanpa Kategori —</option>
                {allCategories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Akun Filter & Jenis Filter */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Filter Akun:
                </label>
                <select
                  value={filter.accountId}
                  onChange={(e) => onFilterChange({ accountId: e.target.value })}
                  className="w-full bg-white text-slate-800 rounded-lg p-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                >
                  <option value="ALL">Semua Akun</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Filter Jenis:
                </label>
                <select
                  value={filter.type}
                  onChange={(e) => onFilterChange({ type: e.target.value as any })}
                  className="w-full bg-white text-slate-800 rounded-lg p-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                >
                  <option value="ALL">Semua Jenis</option>
                  <option value="masuk">Masuk Saja</option>
                  <option value="keluar">Keluar Saja</option>
                </select>
              </div>
            </div>

            {/* Search */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Cari Keterangan:
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filter.searchQuery}
                  onChange={(e) => onFilterChange({ searchQuery: e.target.value })}
                  placeholder="Cari kata (e.g. bensin, semen, wifi)..."
                  className="w-full bg-white text-slate-800 rounded-lg pl-8 pr-3 py-1.5 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>
            </div>

            {/* Period Summary Result */}
            {(() => {
              // Pindah saldo tidak dihitung. Pindah kategori hanya dihitung saat satu kategori dipilih
              // (karena itu pemasukan/pengeluaran kantong tersebut).
              const counted = filteredList.filter(t => {
                if (t.category === 'Pindah Saldo') return filter.category === 'Pindah Saldo';
                if (isCatTransfer(t)) return filter.category !== 'ALL';
                return true;
              });
              const totalMasuk = counted.filter(t => t.type === 'masuk').reduce((sum, t) => sum + t.amount, 0);
              const totalKeluar = counted.filter(t => t.type === 'keluar').reduce((sum, t) => sum + t.amount, 0);
              const sisa = totalMasuk - totalKeluar;

              return (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-slate-600 font-medium">
                    <span>Ditemukan:</span>
                    <span className="font-bold text-slate-800">{filteredList.length} transaksi</span>
                  </div>
                  
                  {filter.category !== 'ALL' && (
                    <div className="flex items-center justify-between text-amber-900 font-bold bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
                      <span>Saldo Kantong "{filter.category === 'EMPTY' ? 'Tanpa Kategori' : filter.category}":</span>
                      <span>
                        {sisa < 0 ? '-' : ''}{formatRupiah(Math.abs(sisa))}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-emerald-700 font-medium">
                    <span>Total Masuk Periode:</span>
                    <span className="font-bold font-mono">
                      {formatRupiah(totalMasuk)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-rose-700 font-medium">
                    <span>Total Keluar Periode:</span>
                    <span className="font-bold font-mono">
                      {formatRupiah(totalKeluar)}
                    </span>
                  </div>
                  <div className="pt-1.5 mt-1 border-t border-slate-200 flex items-center justify-between font-bold">
                    <span className="text-slate-800">Sisa:</span>
                    <span className={`font-mono text-xs sm:text-sm font-extrabold ${sisa >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {sisa < 0 ? '-' : ''}{formatRupiah(Math.abs(sisa))}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Rekap per Kantong & per Akun (klik baris untuk memfilter) */}
            {renderRecap('Rekap per Kantong (kategori)', categoryRecap, filter.category, key => onFilterChange({ category: key }), 'Pindah kategori')}
            {renderRecap('Rekap per Akun', accountRecap, filter.accountId, key => onFilterChange({ accountId: key }), 'Pindah saldo')}

            {/* Filtered list preview (Full, no text truncation) */}
            <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
              {filteredList.length === 0 ? (
                <div className="p-4 text-center text-slate-400">
                  Tidak ada transaksi yang cocok dengan filter yang dipilih.
                </div>
              ) : (
                filteredList.slice(0, filterDisplayCount).map(t => (
                  <div key={t.id} className="p-2.5 flex items-start justify-between gap-2 hover:bg-slate-50 transition">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-semibold text-slate-900 break-words leading-snug">
                        <span>{t.description}</span>
                        <span className="text-slate-400 font-normal mx-1.5">—</span>
                        <span className={`font-bold font-mono text-xs sm:text-sm inline-block ${t.type === 'masuk' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatRupiah(t.amount)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 leading-relaxed">
                        <span>{formatTanggalIndo(t.date, true)}</span>
                        <span>•</span>
                        <span className="font-medium text-slate-700">{getAccountName(t.accountId)}</span>
                        <span>•</span>
                        <span className={`font-medium ${t.type === 'masuk' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {t.type === 'masuk' ? 'Masuk' : 'Keluar'}
                        </span>
                        <span>•</span>
                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-200">
                          {t.category || 'Tanpa Kategori'}
                        </span>
                        {isCatTransfer(t) && (
                          <span className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded text-[10px] font-medium border border-sky-200">
                            Pindah kategori
                          </span>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(t)}
                          className="p-1 text-slate-400 hover:text-[#1e3a5f] hover:bg-slate-100 rounded-md transition cursor-pointer"
                          title="Edit Transaksi (Admin)"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTransaction(t.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition cursor-pointer"
                          title="Hapus Transaksi (Admin)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Load more button in filter if there are more */}
            {filteredList.length > filterDisplayCount && (
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setFilterDisplayCount(prev => prev + 25)}
                  className="text-xs font-semibold text-[#1e3a5f] hover:underline"
                >
                  Tampilkan 25 lagi (sisa {filteredList.length - filterDisplayCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterDisplayCount(filteredList.length)}
                  className="text-xs font-semibold text-[#1e3a5f] hover:underline"
                >
                  Tampilkan Semua ({filteredList.length})
                </button>
              </div>
            )}

            <button
              onClick={onOpenExportImport}
              className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              {isAdmin ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-amber-300" />}
              <span>{isAdmin ? 'Ekspor Hasil Filter ke Excel' : 'Ekspor Hasil Filter ke Excel (Perlu PIN Admin)'}</span>
            </button>

          </div>
        )}

      </div>

      {/* RIWAYAT TRANSAKSI Card (Scrollable container agar halaman tidak panjang) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-2.5">
        <div className="pb-2 border-b border-slate-100 flex items-center justify-between relative z-10">
          <h2 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            RIWAYAT TRANSAKSI ({transactions.length})
          </h2>
          
          {/* Dropdown Sorting Modern & Rounded */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer shadow-2xs"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
              <span>{sortOrder === 'desc' ? 'Terbaru' : 'Terlama'}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${sortDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {sortDropdownOpen && (
              <>
                {/* Backdrop untuk menutup dropdown saat klik di luar */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setSortDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                  <button
                    type="button"
                    onClick={() => {
                      setSortOrder('desc');
                      setSortDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-medium transition flex items-center justify-between ${
                      sortOrder === 'desc' 
                        ? 'bg-amber-50 text-amber-900' 
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>Terbaru</span>
                    {sortOrder === 'desc' && <Check className="w-3.5 h-3.5 text-amber-700" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSortOrder('asc');
                      setSortDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-medium transition flex items-center justify-between ${
                      sortOrder === 'asc' 
                        ? 'bg-amber-50 text-amber-900' 
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>Terlama</span>
                    {sortOrder === 'asc' && <Check className="w-3.5 h-3.5 text-amber-700" />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Scrollable Transaction History Items */}
        <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {sortedTransactions.map(tx => {
            const isMasuk = tx.type === 'masuk';
            const accName = getAccountName(tx.accountId);
            const dateStr = formatTanggalIndo(tx.date, true);

            return (
              <div 
                key={tx.id} 
                className="py-2.5 first:pt-1 last:pb-1 group flex items-start justify-between gap-2.5 hover:bg-slate-50/60 px-1 rounded-lg transition"
              >
                <div className="min-w-0 flex-1">
                  {/* Full Description & Nominal with wrap, strictly no truncate */}
                  <div className="text-xs sm:text-sm font-semibold text-slate-900 break-words leading-snug">
                    <span>{tx.description}</span>
                    <span className="text-slate-400 font-normal mx-1.5 select-none">—</span>
                    <span className={`font-bold font-mono text-xs sm:text-sm inline-block ${
                      isMasuk ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {formatRupiah(tx.amount)}
                    </span>
                  </div>

                  {/* Date, Account, Type, Category Subtitle with clear wrap */}
                  <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-relaxed">
                    <span>{dateStr}</span>
                    <span>•</span>
                    <span className="font-medium text-slate-700">{accName}</span>
                    <span>•</span>
                    <span className={`font-medium ${isMasuk ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {isMasuk ? 'Masuk' : 'Keluar'}
                    </span>
                    {tx.category && tx.category !== '-' && (
                      <>
                        <span>•</span>
                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-200">
                          {tx.category}
                        </span>
                      </>
                    )}
                    {isCatTransfer(tx) && (
                      <span className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded text-[10px] font-medium border border-sky-200">
                        Pindah kategori
                      </span>
                    )}
                  </div>
                </div>

                {/* Edit & Delete Buttons - Hanya Muncul di Mode Admin */}
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    {!isCatTransfer(tx) && (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(tx)}
                        title="Edit transaksi ini (Admin)"
                        className="p-1 text-slate-400 hover:text-[#1e3a5f] hover:bg-slate-100 rounded-md transition cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteTransaction(tx.id)}
                      title="Hapus transaksi ini (Admin)"
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>

      {/* MODAL EDIT TRANSAKSI (ADMIN) */}
      {editingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f] flex items-center justify-center shrink-0">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm">
                    Edit Transaksi (Admin)
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    Ubah detail transaksi yang tersimpan
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveEdit} className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
              {/* Tanggal */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tanggal
                </label>
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              {/* Jenis: Masuk / Keluar */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Jenis Transaksi
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditJenis('masuk')}
                    className={`py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      editJenis === 'masuk'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Masuk
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditJenis('keluar')}
                    className={`py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      editJenis === 'keluar'
                        ? 'bg-[#a32828] text-white border-[#a32828]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Keluar
                  </button>
                </div>
              </div>

              {/* Akun */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Akun / Dompet
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {accounts.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setEditAkun(a.id)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        editAkun === a.id
                          ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keterangan */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Keterangan
                </label>
                <input
                  type="text"
                  required
                  value={editKeterangan}
                  onChange={(e) => setEditKeterangan(e.target.value)}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              {/* Nominal */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nominal (Rp)
                </label>
                <input
                  type="text"
                  required
                  value={editNominalStr}
                  onChange={(e) => {
                    const parsed = parseRupiahInput(e.target.value);
                    setEditNominalStr(parsed === 0 ? '' : parsed.toLocaleString('id-ID'));
                  }}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] font-mono font-bold"
                />
              </div>

              {/* Kategori */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kategori
                </label>
                <select
                  value={editKategori}
                  onChange={(e) => setEditKategori(e.target.value)}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                >
                  <option value="">— tanpa kategori —</option>
                  {allCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Catatan (opsional) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan (opsional)
                </label>
                <input
                  type="text"
                  value={editCatatan}
                  onChange={(e) => setEditCatatan(e.target.value)}
                  placeholder="Catatan tambahan..."
                  className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#1b7a4b] hover:bg-[#156a40] text-white font-bold text-xs transition shadow-xs cursor-pointer"
                >
                  Simpan Perubahan
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  className="py-2.5 px-4 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};