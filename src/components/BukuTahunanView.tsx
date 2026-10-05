import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Wallet,
  Download,
  Lock,
  Archive,
  RotateCcw,
  Layers,
  CreditCard,
  CheckCircle2,
  FileSpreadsheet,
  FileCode,
  AlertCircle,
  Clock,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { Transaction, Account, Debt, YearlyArchive } from '../types/finance.ts';
import { formatRupiah, formatRupiahCompact } from '../utils/formatters.ts';
import { exportDirectToExcel, triggerDownload } from '../utils/excelExport.ts';
import { TutupBukuModal } from './TutupBukuModal.tsx';
import {
  apiYearlyListArchives,
  apiYearlyLoadArchive,
  apiYearlyRestore,
} from '../lib/api.ts';

interface BukuTahunanViewProps {
  accounts: Account[];
  transactions: Transaction[];
  debts: Debt[];
  categories: string[];
  isAdmin: boolean;
  storeName?: string;
  ownerName?: string;
  onOpenAdminModal: () => void;
  onRefreshData: () => Promise<void> | void;
}

const NAMA_BULAN_PENDEK = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
];

const NAMA_BULAN_LENGKAP = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export const BukuTahunanView: React.FC<BukuTahunanViewProps> = ({
  accounts: liveAccounts,
  transactions: liveTransactions,
  debts: liveDebts,
  categories: liveCategories,
  isAdmin,
  storeName,
  ownerName,
  onOpenAdminModal,
  onRefreshData,
}) => {
  const currentCalendarYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentCalendarYear);
  const [isTutupBukuOpen, setIsTutupBukuOpen] = useState(false);
  const [archiveList, setArchiveList] = useState<{ year: number; transactionCount: number; createdAt: string }[]>([]);
  const [archivedData, setArchivedData] = useState<YearlyArchive['data'] | null>(null);
  const [isLoadingArchive, setIsLoadingArchive] = useState(false);
  const [hoveredBar, setHoveredBar] = useState<{ monthIdx: number; type: 'masuk' | 'keluar'; amount: number } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Ambil daftar arsip dari server / local
  const loadArchiveList = async () => {
    try {
      const list = await apiYearlyListArchives();
      setArchiveList(list);
    } catch (e) {
      console.warn('Gagal memuat daftar arsip:', e);
    }
  };

  useEffect(() => {
    loadArchiveList();
  }, []);

  // Kumpulan pilihan tahun yang tersedia
  const availableYears = useMemo(() => {
    const setYears = new Set<number>();
    setYears.add(currentCalendarYear);

    // Dari transaksi aktif
    liveTransactions.forEach(t => {
      if (t.date && t.date.length >= 4) {
        const y = parseInt(t.date.substring(0, 4), 10);
        if (!isNaN(y) && y > 2000 && y < 2100) setYears.add(y);
      }
    });

    // Dari daftar arsip
    archiveList.forEach(a => setYears.add(a.year));

    return Array.from(setYears).sort((a, b) => b - a);
  }, [currentCalendarYear, liveTransactions, archiveList]);

  // Cek apakah tahun yang dipilih adalah arsip
  const isArchiveSelected = useMemo(() => {
    return archiveList.some(a => a.year === selectedYear);
  }, [archiveList, selectedYear]);

  // Muat data arsip jika tahun yang dipilih ada di arsip
  useEffect(() => {
    if (isArchiveSelected) {
      setIsLoadingArchive(true);
      apiYearlyLoadArchive(selectedYear)
        .then(data => {
          setArchivedData(data);
          setIsLoadingArchive(false);
        })
        .catch(err => {
          console.error(err);
          setIsLoadingArchive(false);
        });
    } else {
      setArchivedData(null);
    }
  }, [selectedYear, isArchiveSelected]);

  // Transaksi aktif sesuai tahun yang dipilih
  const displayTransactions = useMemo(() => {
    if (isArchiveSelected && archivedData?.transactions) {
      return archivedData.transactions;
    }
    const yearStr = String(selectedYear);
    return liveTransactions.filter(t => t.date && t.date.startsWith(yearStr));
  }, [isArchiveSelected, archivedData, selectedYear, liveTransactions]);

  const displayAccounts = useMemo(() => {
    if (isArchiveSelected && archivedData?.accounts) {
      return archivedData.accounts;
    }
    return liveAccounts;
  }, [isArchiveSelected, archivedData, liveAccounts]);

  const displayCategories = useMemo(() => {
    if (isArchiveSelected && archivedData?.categories) {
      return archivedData.categories;
    }
    return liveCategories;
  }, [isArchiveSelected, archivedData, liveCategories]);

  const displayDebts = useMemo(() => {
    if (isArchiveSelected && archivedData?.debts) {
      return archivedData.debts;
    }
    return liveDebts;
  }, [isArchiveSelected, archivedData, liveDebts]);

  // B. Ringkasan Keuangan Setahun
  const summary = useMemo(() => {
    let totalMasuk = 0;
    let totalKeluar = 0;

    displayTransactions.forEach(t => {
      // Pindah saldo & pindah kategori (kt-) tidak dihitung pemasukan/pengeluaran nyata
      if (t.category === 'Pindah Saldo' || t.id.startsWith('kt-')) return;

      if (t.type === 'masuk') totalMasuk += t.amount;
      else if (t.type === 'keluar') totalKeluar += t.amount;
    });

    const sisa = totalMasuk - totalKeluar;
    return { totalMasuk, totalKeluar, sisa };
  }, [displayTransactions]);

  // C. Rekap Bulanan (Januari - Desember) untuk Chart & Tabel
  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      monthIdx: i,
      monthName: NAMA_BULAN_LENGKAP[i],
      monthShort: NAMA_BULAN_PENDEK[i],
      masuk: 0,
      keluar: 0,
      sisa: 0,
      count: 0,
    }));

    displayTransactions.forEach(t => {
      if (!t.date || t.date.length < 7) return;
      const parts = t.date.split('-');
      const mIdx = parseInt(parts[1], 10) - 1;
      if (mIdx < 0 || mIdx > 11) return;

      months[mIdx].count += 1;

      // Pengecualian mutasi internal
      if (t.category === 'Pindah Saldo' || t.id.startsWith('kt-')) return;

      if (t.type === 'masuk') months[mIdx].masuk += t.amount;
      else if (t.type === 'keluar') months[mIdx].keluar += t.amount;
    });

    months.forEach(m => {
      m.sisa = m.masuk - m.keluar;
    });

    return months;
  }, [displayTransactions]);

  // Max value untuk skala SVG Chart
  const maxChartVal = useMemo(() => {
    let max = 0;
    monthlyData.forEach(m => {
      if (m.masuk > max) max = m.masuk;
      if (m.keluar > max) max = m.keluar;
    });
    return max > 0 ? max : 1000000;
  }, [monthlyData]);

  // D. Top 5 Kategori Pengeluaran
  const topExpenses = useMemo(() => {
    const map: Record<string, number> = {};
    let totalExpense = 0;

    displayTransactions.forEach(t => {
      if (t.type !== 'keluar' || t.category === 'Pindah Saldo' || t.id.startsWith('kt-')) return;
      const cat = t.category && t.category.trim() ? t.category.trim() : 'Lainnya';
      map[cat] = (map[cat] || 0) + t.amount;
      totalExpense += t.amount;
    });

    return Object.entries(map)
      .map(([name, amount]) => ({
        name,
        amount,
        percent: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [displayTransactions]);

  // E. Top 5 Sumber Pemasukan
  const topIncomes = useMemo(() => {
    const map: Record<string, number> = {};
    let totalIncome = 0;

    displayTransactions.forEach(t => {
      if (t.type !== 'masuk' || t.category === 'Pindah Saldo' || t.id.startsWith('kt-')) return;
      const cat = t.category && t.category.trim() ? t.category.trim() : 'Lainnya';
      map[cat] = (map[cat] || 0) + t.amount;
      totalIncome += t.amount;
    });

    return Object.entries(map)
      .map(([name, amount]) => ({
        name,
        amount,
        percent: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [displayTransactions]);

  // G. Saldo Akhir Akun
  const accountBalances = useMemo(() => {
    const map: Record<string, number> = {};
    displayAccounts.forEach(a => {
      map[a.id] = a.initialBalance || 0;
    });

    displayTransactions.forEach(t => {
      if (t.id.startsWith('kt-')) return; // Pindah kategori tidak ubah saldo akun
      if (t.accountId && map[t.accountId] !== undefined) {
        if (t.type === 'masuk') map[t.accountId] += t.amount;
        else map[t.accountId] -= t.amount;
      }
    });

    const list = displayAccounts.map(a => ({
      ...a,
      finalBalance: map[a.id] ?? 0,
    }));

    const total = list.reduce((s, a) => s + a.finalBalance, 0);
    return { list, total };
  }, [displayAccounts, displayTransactions]);

  // H. Saldo Kantong (Kategori)
  const pocketBalances = useMemo(() => {
    const map: Record<string, { masuk: number; keluar: number; pindah: number }> = {};
    displayCategories.forEach(c => {
      map[c] = { masuk: 0, keluar: 0, pindah: 0 };
    });

    displayTransactions.forEach(t => {
      if (t.category === 'Pindah Saldo') return;
      const key = t.category && t.category.trim() ? t.category.trim() : 'Lainnya';
      if (!map[key]) map[key] = { masuk: 0, keluar: 0, pindah: 0 };

      if (t.id.startsWith('kt-')) {
        map[key].pindah += t.type === 'masuk' ? t.amount : -t.amount;
      } else if (t.type === 'masuk') {
        map[key].masuk += t.amount;
      } else {
        map[key].keluar += t.amount;
      }
    });

    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        masuk: d.masuk,
        keluar: d.keluar,
        pindah: d.pindah,
        saldo: d.masuk - d.keluar + d.pindah,
      }))
      .sort((a, b) => b.saldo - a.saldo);
  }, [displayCategories, displayTransactions]);

  // I. Utang & Piutang Aktif
  const activeDebts = useMemo(() => {
    return displayDebts
      .map(d => {
        const totalPaid = (d.payments || []).reduce((s, p) => s + p.amount, 0);
        const sisa = Math.max(0, d.totalAmount - totalPaid);
        return {
          ...d,
          totalPaid,
          sisa,
          isLunas: sisa <= 0,
        };
      })
      .filter(d => !d.isLunas && !d.archivedAt);
  }, [displayDebts]);

  // J. Handler Aksi: Download Backup (JSON + Excel)
  const handleDownloadBackup = () => {
    if (displayTransactions.length === 0) {
      alert('Tidak ada data transaksi untuk diekspor.');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // 1. JSON
    const backupObj = {
      year: selectedYear,
      exportedAt: new Date().toISOString(),
      summary,
      transactions: displayTransactions,
      accounts: displayAccounts,
      categories: displayCategories,
      debts: displayDebts,
    };
    const jsonBlob = new Blob([JSON.stringify(backupObj, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    triggerDownload(jsonBlob, `dompet_toko_backup_${selectedYear}_${todayStr}.json`);

    // 2. Excel
    exportDirectToExcel(
      displayTransactions,
      displayAccounts,
      `dompet_toko_backup_${selectedYear}_${todayStr}.xls`
    );

    setActionNotice({
      text: `File JSON dan Excel tahun ${selectedYear} berhasil diunduh!`,
      type: 'success',
    });
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Handler: Download Laporan Excel Tahunan
  const handleDownloadReport = () => {
    if (displayTransactions.length === 0) {
      alert('Tidak ada transaksi di tahun ini.');
      return;
    }
    const todayStr = new Date().toISOString().split('T')[0];
    exportDirectToExcel(
      displayTransactions,
      displayAccounts,
      `laporan_tahunan_${selectedYear}_${todayStr}.xls`
    );
  };

  // Handler: Restore Arsip (Khusus jika tahun lama ingin dikembalikan ke aktif)
  const handleRestore = async () => {
    if (!isAdmin) {
      onOpenAdminModal();
      return;
    }
    if (!confirm(`Pulihkan transaksi tahun ${selectedYear} ke pembukuan aktif? Transaksi akan digabungkan kembali.`)) {
      return;
    }

    setIsRestoring(true);
    try {
      const res = await apiYearlyRestore(selectedYear);
      setActionNotice({
        text: `Berhasil memulihkan ${res.restoredCount} transaksi tahun ${selectedYear}!`,
        type: 'success',
      });
      await onRefreshData();
      await loadArchiveList();
    } catch (err: any) {
      setActionNotice({
        text: err.message || 'Gagal memulihkan arsip.',
        type: 'error',
      });
    } finally {
      setIsRestoring(false);
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  return (
    <div className="w-full space-y-4 pb-4">
      {/* HEADER: Judul + Dropdown Tahun + Status */}
      <div className="flex items-center justify-between gap-2 pt-1 pb-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-extrabold text-[#1e3a5f] tracking-tight">
              Buku Tahunan
            </h1>
            {isArchiveSelected ? (
              <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <Archive className="w-3 h-3" />
                ARSIP RESMI
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" />
                TAHUN BERJALAN
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ringkasan keuangan, laporan tahunan, dan tutup buku
          </p>
        </div>

        {/* Dropdown Pemilih Tahun */}
        <div className="relative shrink-0">
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(parseInt(e.target.value, 10))}
            className="appearance-none bg-white text-slate-800 text-xs sm:text-sm font-bold pl-3 pr-8 py-2 rounded-xl border border-slate-300 shadow-2xs hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] cursor-pointer"
          >
            {availableYears.map(y => (
              <option key={y} value={y}>
                Tahun {y} {archiveList.some(a => a.year === y) ? '(Arsip)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {actionNotice && (
        <div
          className={`p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 animate-in fade-in ${
            actionNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : actionNotice.type === 'error'
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-sky-50 text-sky-800 border border-sky-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionNotice.text}</span>
        </div>
      )}

      {isLoadingArchive && (
        <div className="p-4 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-400 animate-pulse">
          Memuat data arsip tahun {selectedYear}...
        </div>
      )}

      {/* B. RINGKASAN SETAHUN (3 KARTU) */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-xs">
          <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Pemasukan</span>
          </div>
          <div className="text-sm sm:text-base font-extrabold text-emerald-700 tracking-tight mt-1 font-mono truncate">
            {formatRupiah(summary.totalMasuk)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">riil tahun {selectedYear}</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-xs">
          <div className="flex items-center gap-1 text-[11px] font-bold text-rose-700">
            <TrendingDown className="w-3.5 h-3.5" />
            <span>Pengeluaran</span>
          </div>
          <div className="text-sm sm:text-base font-extrabold text-rose-700 tracking-tight mt-1 font-mono truncate">
            {formatRupiah(summary.totalKeluar)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">riil tahun {selectedYear}</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-xs">
          <div className="flex items-center gap-1 text-[11px] font-bold text-[#1e3a5f]">
            <Wallet className="w-3.5 h-3.5" />
            <span>Sisa / Laba</span>
          </div>
          <div
            className={`text-sm sm:text-base font-extrabold tracking-tight mt-1 font-mono truncate ${
              summary.sisa >= 0 ? 'text-[#1e3a5f]' : 'text-rose-700'
            }`}
          >
            {formatRupiah(summary.sisa)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">laba bersih setahun</div>
        </div>
      </div>

      {/* C. GRAFIK BATANG PER BULAN (INLINE SVG) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Grafik Arus Kas Bulanan ({selectedYear})
            </h2>
            <p className="text-[10px] text-slate-400">
              Perbandingan pemasukan (hijau) & pengeluaran (merah) per bulan
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-bold">
            <span className="flex items-center gap-1 text-emerald-700">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" /> Masuk
            </span>
            <span className="flex items-center gap-1 text-rose-700">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-600 inline-block" /> Keluar
            </span>
          </div>
        </div>

        {/* SVG Chart Container */}
        <div className="w-full overflow-x-auto pt-2 pb-1">
          <div className="min-w-[620px]">
            <svg viewBox="0 0 720 200" className="w-full h-44 select-none">
              {/* Garis Grid Horizontal */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                const y = 160 - pct * 140;
                return (
                  <g key={i}>
                    <line x1="30" y1={y} x2="710" y2={y} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3" />
                    <text x="25" y={y + 3} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="monospace">
                      {formatRupiahCompact(pct * maxChartVal)}
                    </text>
                  </g>
                );
              })}

              {/* Garis Dasar Sumbu X */}
              <line x1="30" y1="160" x2="710" y2="160" stroke="#cbd5e1" strokeWidth="1" />

              {/* Batang Per Bulan */}
              {monthlyData.map((m, idx) => {
                const slotWidth = 56;
                const slotX = 35 + idx * slotWidth;

                const masukHeight = (m.masuk / maxChartVal) * 140;
                const keluarHeight = (m.keluar / maxChartVal) * 140;

                const barWidth = 18;
                const masukX = slotX + 4;
                const keluarX = slotX + 24;

                const masukY = 160 - masukHeight;
                const keluarY = 160 - keluarHeight;

                return (
                  <g key={idx}>
                    {/* Batang Masuk */}
                    <rect
                      x={masukX}
                      y={masukY}
                      width={barWidth}
                      height={Math.max(masukHeight, 2)}
                      rx="3"
                      fill="#10b981"
                      className="transition-all hover:opacity-80 cursor-pointer"
                      onMouseEnter={() => setHoveredBar({ monthIdx: idx, type: 'masuk', amount: m.masuk })}
                      onMouseLeave={() => setHoveredBar(null)}
                    />

                    {/* Batang Keluar */}
                    <rect
                      x={keluarX}
                      y={keluarY}
                      width={barWidth}
                      height={Math.max(keluarHeight, 2)}
                      rx="3"
                      fill="#f43f5e"
                      className="transition-all hover:opacity-80 cursor-pointer"
                      onMouseEnter={() => setHoveredBar({ monthIdx: idx, type: 'keluar', amount: m.keluar })}
                      onMouseLeave={() => setHoveredBar(null)}
                    />

                    {/* Label Bulan */}
                    <text
                      x={slotX + 23}
                      y="180"
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="bold"
                      fill="#64748b"
                    >
                      {m.monthShort}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Tooltip Keterangan Nilai yang Disorot */}
            <div className="h-6 flex items-center justify-center text-xs">
              {hoveredBar ? (
                <div className="bg-slate-900 text-white px-3 py-1 rounded-full text-[11px] font-mono flex items-center gap-1.5 shadow-md animate-in fade-in">
                  <span>{NAMA_BULAN_LENGKAP[hoveredBar.monthIdx]}</span>
                  <span>•</span>
                  <span className={hoveredBar.type === 'masuk' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {hoveredBar.type === 'masuk' ? 'Pemasukan' : 'Pengeluaran'}: {formatRupiah(hoveredBar.amount)}
                  </span>
                </div>
              ) : (
                <span className="text-[10px] text-slate-400 italic">
                  Arahkan kursor atau sentuh batang untuk melihat nominal tepat
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* D & E. TOP 5 PENGELUARAN & PEMASUKAN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Top 5 Pengeluaran */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-2.5">
          <h2 className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center justify-between">
            <span>Top 5 Pengeluaran</span>
            <TrendingDown className="w-3.5 h-3.5" />
          </h2>
          {topExpenses.length === 0 ? (
            <div className="text-slate-400 text-xs py-4 text-center">Belum ada pengeluaran di tahun ini.</div>
          ) : (
            <div className="space-y-2">
              {topExpenses.map((c, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 truncate">{c.name}</span>
                    <span className="font-mono font-bold text-slate-800">{formatRupiah(c.amount)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-rose-500 h-full rounded-full transition-all"
                      style={{ width: `${c.percent}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 text-right">{c.percent.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top 5 Pemasukan */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-2.5">
          <h2 className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center justify-between">
            <span>Top 5 Sumber Pemasukan</span>
            <TrendingUp className="w-3.5 h-3.5" />
          </h2>
          {topIncomes.length === 0 ? (
            <div className="text-slate-400 text-xs py-4 text-center">Belum ada pemasukan di tahun ini.</div>
          ) : (
            <div className="space-y-2">
              {topIncomes.map((c, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 truncate">{c.name}</span>
                    <span className="font-mono font-bold text-slate-800">{formatRupiah(c.amount)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all"
                      style={{ width: `${c.percent}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 text-right">{c.percent.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* F. TABEL DETAIL PER BULAN */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-2.5">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Rincian Transaksi Per Bulan ({selectedYear})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/60">
                <th className="py-2 px-2 font-bold">Bulan</th>
                <th className="py-2 px-2 font-bold text-center">Tx</th>
                <th className="py-2 px-2 font-bold text-right text-emerald-700">Masuk</th>
                <th className="py-2 px-2 font-bold text-right text-rose-700">Keluar</th>
                <th className="py-2 px-2 font-bold text-right text-[#1e3a5f]">Sisa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthlyData.map(m => (
                <tr key={m.monthIdx} className="hover:bg-slate-50/50">
                  <td className="py-2 px-2 font-semibold text-slate-700">{m.monthName}</td>
                  <td className="py-2 px-2 text-center text-slate-400 font-mono">{m.count}</td>
                  <td className="py-2 px-2 text-right font-mono text-emerald-700 font-medium">
                    {formatRupiah(m.masuk)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-rose-700 font-medium">
                    {formatRupiah(m.keluar)}
                  </td>
                  <td
                    className={`py-2 px-2 text-right font-mono font-bold ${
                      m.sisa >= 0 ? 'text-[#1e3a5f]' : 'text-rose-700'
                    }`}
                  >
                    {formatRupiah(m.sisa)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold bg-slate-50">
                <td className="py-2 px-2 text-slate-800">Total Setahun</td>
                <td className="py-2 px-2 text-center font-mono text-slate-600">
                  {displayTransactions.length}
                </td>
                <td className="py-2 px-2 text-right font-mono text-emerald-700">
                  {formatRupiah(summary.totalMasuk)}
                </td>
                <td className="py-2 px-2 text-right font-mono text-rose-700">
                  {formatRupiah(summary.totalKeluar)}
                </td>
                <td
                  className={`py-2 px-2 text-right font-mono ${
                    summary.sisa >= 0 ? 'text-[#1e3a5f]' : 'text-rose-700'
                  }`}
                >
                  {formatRupiah(summary.sisa)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* G. SALDO AKHIR PER AKUN (UNTUK TAHUN BARU) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Saldo Akhir Tahun Ini ({selectedYear})
            </h2>
            <p className="text-[10px] text-slate-400">
              Saldo per 31 Desember {selectedYear} yang akan dibawa sebagai Saldo Awal tahun {selectedYear + 1}
            </p>
          </div>
          <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
            Total: {formatRupiah(accountBalances.total)}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {accountBalances.list.map(acc => (
            <div key={acc.id} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-600 truncate block">
                {acc.name}
              </span>
              <span className="text-xs font-extrabold font-mono text-slate-900 block truncate">
                {formatRupiah(acc.finalBalance)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* H. SALDO KANTONG (KATEGORI) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
          <span>Saldo Kantong ({selectedYear})</span>
          <Layers className="w-3.5 h-3.5 text-slate-400" />
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {pocketBalances.map(pocket => (
            <div
              key={pocket.name}
              className={`rounded-xl p-2.5 border space-y-0.5 ${
                pocket.saldo < 0
                  ? 'bg-rose-50/60 border-rose-200 text-rose-800'
                  : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <div className="text-[11px] font-semibold truncate">{pocket.name}</div>
              <div className="text-xs font-bold font-mono truncate">
                {formatRupiah(pocket.saldo)}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                Masuk {formatRupiahCompact(pocket.masuk)} • Keluar {formatRupiahCompact(pocket.keluar)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* I. UTANG & PIUTANG AKTIF */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Utang & Piutang Belum Lunas
            </h2>
            <p className="text-[10px] text-slate-400">
              Kewajiban aktif yang terus berjalan ke tahun berikutnya
            </p>
          </div>
          <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">
            {activeDebts.length} aktif
          </span>
        </div>

        {activeDebts.length === 0 ? (
          <div className="text-slate-400 text-xs py-2 text-center italic">
            Semua utang & piutang telah lunas atau belum ada catatan.
          </div>
        ) : (
          <div className="space-y-1.5">
            {activeDebts.map(d => (
              <div
                key={d.id}
                className="bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        d.type === 'utang' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {d.type.toUpperCase()}
                    </span>
                    <span>{d.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {d.counterparty ? `Pihak: ${d.counterparty} • ` : ''}
                    Pokok {formatRupiah(d.totalAmount)}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Sisa</span>
                  <span
                    className={`font-mono font-bold ${
                      d.type === 'utang' ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatRupiah(d.sisa)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* J & K. TOMBOL AKSI UTAMA (Hanya Admin) */}
      <div className="space-y-2 pt-1">
        {/* Tombol Download Laporan & Backup (Hanya Admin) */}
        {isAdmin && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="py-2.5 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Download Backup (JSON+XLS)</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadReport}
              className="py-2.5 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Laporan Excel {selectedYear}</span>
            </button>
          </div>
        )}

        {/* Kondisi 1: Tahun yang dipilih adalah tahun berjalan & belum tutup buku (Hanya Admin) */}
        {!isArchiveSelected && isAdmin && (
          <button
            type="button"
            onClick={() => setIsTutupBukuOpen(true)}
            className="w-full py-3 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800 text-white rounded-xl text-xs sm:text-sm font-extrabold transition flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-[0.99]"
          >
            <Lock className="w-4 h-4" />
            <span>
              Tutup Buku Tahun {selectedYear} & Mulai {selectedYear + 1}
            </span>
          </button>
        )}

        {/* Kondisi 2: Tahun yang dipilih adalah arsip masa lalu */}
        {isArchiveSelected && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2 text-slate-600">
              <Archive className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Tahun <b>{selectedYear}</b> telah resmi ditutup dan disimpan dalam arsip permanen.
              </span>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={handleRestore}
                disabled={isRestoring}
                className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center gap-1 transition cursor-pointer shrink-0 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isRestoring ? 'Memulihkan...' : 'Restore ke Aktif'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* MODAL KONFIRMASI TUTUP BUKU */}
      <TutupBukuModal
        isOpen={isTutupBukuOpen}
        onClose={() => setIsTutupBukuOpen(false)}
        year={selectedYear}
        transactions={displayTransactions}
        accounts={displayAccounts}
        categories={displayCategories}
        debts={displayDebts}
        onSuccess={async (newYear) => {
          setSelectedYear(newYear);
          await onRefreshData();
          await loadArchiveList();
          setActionNotice({
            text: `Selamat! Tutup buku tahun ${selectedYear} selesai. Pembukuan tahun ${newYear} dimulai.`,
            type: 'success',
          });
          setTimeout(() => setActionNotice(null), 5000);
        }}
      />
    </div>
  );
};
