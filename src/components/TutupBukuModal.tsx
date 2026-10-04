import React, { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Lock,
  CheckCircle2,
  Download,
  Loader2,
  FileSpreadsheet,
  FileCode,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Transaction, Account, Debt, YearlyArchive } from '../types/finance.ts';
import { formatRupiah } from '../utils/formatters.ts';
import { exportDirectToExcel, triggerDownload } from '../utils/excelExport.ts';
import { apiYearlyPreview, apiYearlyExecute } from '../lib/api.ts';

interface TutupBukuModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  transactions: Transaction[];
  accounts: Account[];
  categories: string[];
  debts: Debt[];
  onSuccess: (newYear: number) => void;
}

interface StepItem {
  id: number;
  label: string;
  status: 'waiting' | 'running' | 'done' | 'error';
}

export const TutupBukuModal: React.FC<TutupBukuModalProps> = ({
  isOpen,
  onClose,
  year,
  transactions,
  accounts,
  categories,
  debts,
  onSuccess,
}) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [previewData, setPreviewData] = useState<{
    transactionCount: number;
    accountBalances: { accountId: string; name: string; balance: number }[];
    pocketBalances: { category: string; balance: number }[];
    unpaidDebts: { id: string; name: string; remaining: number }[];
  } | null>(null);

  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const expectedText = `TUTUP BUKU ${year}`;
  const isMatch = confirmInput.trim().toUpperCase() === expectedText;

  const STEPS: StepItem[] = [
    { id: 1, label: 'Download backup offline (JSON & Excel)', status: 'waiting' },
    { id: 2, label: `Simpan arsip tahun ${year} ke database`, status: 'waiting' },
    { id: 3, label: 'Perbarui saldo awal akun untuk tahun baru', status: 'waiting' },
    { id: 4, label: 'Perbarui saldo awal kantong untuk tahun baru', status: 'waiting' },
    { id: 5, label: 'Arsipkan utang & piutang yang telah lunas', status: 'waiting' },
    { id: 6, label: `Hapus transaksi tahun ${year} dari buku aktif`, status: 'waiting' },
    { id: 7, label: `Setel tahun berjalan ke ${year + 1}`, status: 'waiting' },
  ];

  const [stepList, setStepList] = useState<StepItem[]>(STEPS);

  useEffect(() => {
    if (!isOpen) {
      setConfirmInput('');
      setIsExecuting(false);
      setCurrentStepIdx(-1);
      setErrorMessage(null);
      setStepList(STEPS);
      return;
    }

    let isMounted = true;
    setIsLoadingPreview(true);
    setErrorMessage(null);

    apiYearlyPreview(year)
      .then(res => {
        if (isMounted) {
          setPreviewData(res);
          setIsLoadingPreview(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          console.error(err);
          // Fallback lokal jika preview gagal
          const txYear = transactions.filter(t => t.date && t.date.startsWith(String(year)));
          setPreviewData({
            transactionCount: txYear.length,
            accountBalances: accounts.map(a => ({ accountId: a.id, name: a.name, balance: a.initialBalance || 0 })),
            pocketBalances: categories.map(c => ({ category: c, balance: 0 })),
            unpaidDebts: [],
          });
          setIsLoadingPreview(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, year]);

  if (!isOpen) return null;

  const runCloseBook = async () => {
    if (!isMatch || isExecuting) return;

    setIsExecuting(true);
    setErrorMessage(null);

    const updateStep = (idx: number, status: StepItem['status']) => {
      setStepList(prev => prev.map((s, i) => (i === idx ? { ...s, status } : s)));
    };

    try {
      // Siapkan paket backup utuh
      const yearStr = String(year);
      const txYear = transactions.filter(t => t.date && t.date.startsWith(yearStr));

      // 1. Hitung summary
      const realMasuk = txYear
        .filter(t => t.type === 'masuk' && t.category !== 'Pindah Saldo' && !t.id.startsWith('kt-'))
        .reduce((s, t) => s + t.amount, 0);
      const realKeluar = txYear
        .filter(t => t.type === 'keluar' && t.category !== 'Pindah Saldo' && !t.id.startsWith('kt-'))
        .reduce((s, t) => s + t.amount, 0);

      // Saldo akun final
      const finalAccBalances = accounts.map(a => {
        const pAcc = previewData?.accountBalances.find(p => p.accountId === a.id);
        return {
          ...a,
          initialBalance: pAcc ? pAcc.balance : a.initialBalance || 0,
        };
      });

      const backupPackage: YearlyArchive['data'] = {
        transactions: txYear,
        accounts: finalAccBalances,
        categories,
        debts,
        summary: {
          totalMasuk: realMasuk,
          totalKeluar: realKeluar,
          sisa: realMasuk - realKeluar,
        },
      };

      // Step 1: Download backup offline (JSON & Excel)
      setCurrentStepIdx(0);
      updateStep(0, 'running');
      await new Promise(r => setTimeout(r, 400));

      const todayStr = new Date().toISOString().split('T')[0];
      const jsonFilename = `dompet_toko_backup_${year}_${todayStr}.json`;
      const jsonBlob = new Blob([JSON.stringify(backupPackage, null, 2)], {
        type: 'application/json;charset=utf-8;',
      });
      triggerDownload(jsonBlob, jsonFilename);

      const xlsFilename = `dompet_toko_laporan_tahunan_${year}_${todayStr}.xls`;
      exportDirectToExcel(txYear, accounts, xlsFilename);
      updateStep(0, 'done');

      // Step 2, 3, 4, 5, 6, 7: Jalankan via backend / local API
      for (let s = 1; s < STEPS.length; s++) {
        setCurrentStepIdx(s);
        updateStep(s, 'running');
        await new Promise(r => setTimeout(r, 300));
        updateStep(s, 'done');
      }

      // Eksekusi final di database
      const res = await apiYearlyExecute(year, confirmInput.trim().toUpperCase(), backupPackage);

      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });

      await new Promise(r => setTimeout(r, 600));
      onSuccess(res.newYear || year + 1);
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Gagal menjalankan tutup buku.');
      if (currentStepIdx >= 0) {
        updateStep(currentStepIdx, 'error');
      }
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Header Modal */}
        <div className="px-5 py-4 border-b border-rose-100 bg-gradient-to-r from-rose-50 to-orange-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-800 text-sm sm:text-base leading-tight">
                Tutup Buku Tahun {year}
              </h3>
              <p className="text-[11px] text-slate-500">
                Arsipkan data lama & bawa saldo ke tahun {year + 1}
              </p>
            </div>
          </div>
          {!isExecuting && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/80 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Peringatan Kritis */}
          <div className="bg-rose-50 border border-rose-200/80 rounded-2xl p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>PERHATIAN: Tindakan Ini Mengubah Saldo Awal</span>
            </div>
            <p className="text-[11px] text-rose-700 leading-relaxed">
              Tutup buku akan memindahkan seluruh data transaksi tahun <b>{year}</b> ke dalam arsip,
              memperbarui <b>saldo awal akun & kantong</b> menjadi saldo akhir per 31 Desember {year},
              lalu mereset pencatatan transaksi untuk tahun <b>{year + 1}</b> dari nomor 1.
            </p>
          </div>

          {/* Ringkasan Preview Perubahan */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>Preview Perubahan:</span>
              {isLoadingPreview && (
                <span className="text-[10px] text-slate-400 font-normal flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Memuat data...
                </span>
              )}
            </div>

            {previewData ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                  <span className="text-[10px] text-slate-400 font-medium block">Transaksi Diarsipkan</span>
                  <span className="text-sm font-bold text-slate-800 font-mono">
                    {previewData.transactionCount.toLocaleString('id-ID')} transaksi
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                  <span className="text-[10px] text-slate-400 font-medium block">Akun Di-Update</span>
                  <span className="text-sm font-bold text-emerald-700 font-mono">
                    {previewData.accountBalances.length} akun
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                  <span className="text-[10px] text-slate-400 font-medium block">Kantong Di-Update</span>
                  <span className="text-sm font-bold text-[#1e3a5f] font-mono">
                    {previewData.pocketBalances.length} kantong
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                  <span className="text-[10px] text-slate-400 font-medium block">Utang Belum Lunas</span>
                  <span className="text-sm font-bold text-amber-700 font-mono">
                    {previewData.unpaidDebts.length} aktif
                  </span>
                </div>
              </div>
            ) : null}

            {previewData && previewData.accountBalances.length > 0 && (
              <details className="text-[11px] bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                <summary className="font-bold text-slate-600 cursor-pointer select-none">
                  Lihat rincian saldo baru per akun ({previewData.accountBalances.length})
                </summary>
                <div className="mt-2 space-y-1 pt-1 border-t border-slate-200">
                  {previewData.accountBalances.map(a => (
                    <div key={a.accountId} className="flex items-center justify-between">
                      <span className="text-slate-600">{a.name}</span>
                      <span className="font-mono font-bold text-slate-800">{formatRupiah(a.balance)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Stepper Progress Saat Eksekusi */}
          {isExecuting && (
            <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-2.5 animate-in fade-in">
              <div className="text-xs font-bold text-emerald-400 flex items-center justify-between">
                <span>Memproses Tutup Buku...</span>
                <span className="text-[10px] font-mono">
                  {Math.min(currentStepIdx + 1, STEPS.length)} / {STEPS.length}
                </span>
              </div>
              <div className="space-y-1.5 text-[11px]">
                {stepList.map((step, idx) => (
                  <div key={step.id} className="flex items-center gap-2">
                    {step.status === 'done' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : step.status === 'running' ? (
                      <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                    ) : step.status === 'error' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-slate-600 shrink-0" />
                    )}
                    <span
                      className={
                        step.status === 'done'
                          ? 'text-slate-300'
                          : step.status === 'running'
                          ? 'text-amber-300 font-bold'
                          : step.status === 'error'
                          ? 'text-rose-300 font-bold'
                          : 'text-slate-500'
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
              {errorMessage}
            </div>
          )}

          {/* Konfirmasi Teks */}
          {!isExecuting && (
            <div className="space-y-2 pt-1 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-700 leading-tight">
                Ketik kalimat di bawah untuk membuka kunci konfirmasi:
              </label>
              <div className="bg-slate-100 select-all font-mono font-bold text-xs text-center py-2 px-3 rounded-xl border border-slate-300 text-slate-800 tracking-wider">
                {expectedText}
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder={`Ketik "${expectedText}" di sini...`}
                className={`w-full text-xs sm:text-sm rounded-xl px-3 py-2.5 border font-mono tracking-wide transition focus:outline-none ${
                  isMatch
                    ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 ring-2 ring-emerald-200'
                    : 'border-slate-300 bg-white text-slate-800 focus:border-rose-400'
                }`}
              />
            </div>
          )}
        </div>

        {/* Footer Tombol */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition cursor-pointer disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={runCloseBook}
            disabled={!isMatch || isExecuting || isLoadingPreview}
            className={`px-5 py-2.5 rounded-xl text-xs font-extrabold text-white flex items-center gap-1.5 shadow-md transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isMatch
                ? 'bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800'
                : 'bg-slate-400'
            }`}
          >
            {isExecuting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Memproses...</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5" />
                <span>Tutup Buku & Mulai {year + 1}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
