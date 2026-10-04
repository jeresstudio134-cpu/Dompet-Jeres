import React, { useState, useMemo } from 'react';
import {
  Plus,
  X,
  Trash2,
  Edit2,
  Check,
  AlertCircle,
  Calendar,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Wallet,
  CircleDollarSign,
  Clock,
  Sparkles,
} from 'lucide-react';
import { AutoDebtModal } from './AutoDebtModal.tsx';
import { Debt, DebtType, DebtPayment, Account } from '../types/finance.ts';
import { formatRupiah, formatTanggalIndo, parseRupiahInput, getCurrentDateIndo } from '../utils/formatters.ts';

interface UtangPiutangViewProps {
  debts: Debt[];
  accounts: Account[];
  isAdmin: boolean;
  onAddDebt: (debt: Omit<Debt, 'id' | 'createdAt' | 'payments'>) => void | Promise<void>;
  onUpdateDebt: (debt: Debt) => void | Promise<void>;
  onDeleteDebt: (id: string) => void | Promise<void>;
  onAddPayment: (debtId: string, payment: Omit<DebtPayment, 'id' | 'debtId'>) => void | Promise<void>;
  onDeletePayment: (debtId: string, paymentId: string) => void | Promise<void>;
  onOpenAutoDebt?: () => void;
}



export const UtangPiutangView: React.FC<UtangPiutangViewProps> = ({
  debts,
  accounts,
  isAdmin,
  onAddDebt,
  onUpdateDebt,
  onDeleteDebt,
  onAddPayment,
  onDeletePayment,
}) => {
  const [activeTab, setActiveTab] = useState<DebtType>('utang');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [expandedDebt, setExpandedDebt] = useState<string | null>(null);
  const [payingDebt, setPayingDebt] = useState<Debt | null>(null);
  const [autoDebtOpen, setAutoDebtOpen] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCounterparty, setFormCounterparty] = useState('');
  const [formTotal, setFormTotal] = useState('0');
  const [formStartDate, setFormStartDate] = useState(getCurrentDateIndo());
  const [formDueDate, setFormDueDate] = useState('');
  const [formInstallment, setFormInstallment] = useState('0');
  const [formPeriod, setFormPeriod] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Payment form state
  const [payDate, setPayDate] = useState(getCurrentDateIndo());
  const [payAmount, setPayAmount] = useState('');
  const [payAccount, setPayAccount] = useState(accounts[0]?.id || '');
  const [payNotes, setPayNotes] = useState('');

  const resetForm = () => {
    setFormName('');
    setFormCounterparty('');
    setFormTotal('0');
    setFormStartDate(getCurrentDateIndo());
    setFormDueDate('');
    setFormInstallment('0');
    setFormPeriod('');
    setFormNotes('');
  };

  const handleOpenAdd = () => {
    resetForm();
    setEditingDebt(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (debt: Debt) => {
    setFormName(debt.name);
    setFormCounterparty(debt.counterparty);
    setFormTotal(debt.totalAmount.toLocaleString('id-ID'));
    setFormStartDate(debt.startDate);
    setFormDueDate(debt.dueDate || '');
    setFormInstallment((debt.installmentAmount || 0).toLocaleString('id-ID'));
    setFormPeriod(debt.installmentPeriod?.toString() || '');
    setFormNotes(debt.notes || '');
    setEditingDebt(debt);
    setShowAddModal(true);
  };

    const handleSubmitDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = parseRupiahInput(formTotal);
    if (!formName.trim() || total <= 0) return;

    const payload = {
      type: activeTab,
      name: formName.trim(),
      counterparty: formCounterparty.trim(),
      totalAmount: total,
      startDate: formStartDate,
      dueDate: formDueDate || undefined,
      installmentAmount: parseRupiahInput(formInstallment) || undefined,
      installmentPeriod: formPeriod ? parseInt(formPeriod, 10) : undefined,
      notes: formNotes.trim() || undefined,
    };

    if (editingDebt) {
  await onUpdateDebt({ ...editingDebt, ...payload });
} else {
  await onAddDebt(payload);
}

    setShowAddModal(false);
    resetForm();
    setEditingDebt(null);
  };

  const handleOpenPay = (debt: Debt) => {
    setPayDate(getCurrentDateIndo());
    const sisa = getSisa(debt);
    setPayAmount('');
    setPayAccount(accounts[0]?.id || '');
    setPayNotes('');
    setPayingDebt(debt);
  };

    const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingDebt) return;
    const amount = parseRupiahInput(payAmount);
    if (amount <= 0) return;

    await onAddPayment(payingDebt.id, {
      date: payDate,
      amount,
      accountId: payAccount || undefined,
      notes: payNotes.trim() || undefined,
    });

    setPayingDebt(null);
  };

  const getTotalPaid = (debt: Debt) =>
    debt.payments.reduce((sum, p) => sum + p.amount, 0);

  const getSisa = (debt: Debt) =>
    Math.max(0, debt.totalAmount - getTotalPaid(debt));

  const getProgress = (debt: Debt) => {
    if (debt.totalAmount === 0) return 0;
    return Math.min(100, (getTotalPaid(debt) / debt.totalAmount) * 100);
  };

  const isLunas = (debt: Debt) => getSisa(debt) <= 0;

  const filteredDebts = useMemo(
    () => debts.filter(d => d.type === activeTab),
    [debts, activeTab]
  );

  // Ringkasan
  const summary = useMemo(() => {
    const list = debts.filter(d => d.type === activeTab);
    let totalPokok = 0;
    let totalDibayar = 0;
    let totalSisa = 0;
    let lunas = 0;
    let aktif = 0;

    list.forEach(d => {
      totalPokok += d.totalAmount;
      const paid = getTotalPaid(d);
      totalDibayar += paid;
      totalSisa += Math.max(0, d.totalAmount - paid);
      if (isLunas(d)) lunas++;
      else aktif++;
    });

    return { totalPokok, totalDibayar, totalSisa, lunas, aktif, count: list.length };
  }, [debts, activeTab]);

  // Cek jatuh tempo dekat (dalam 7 hari)
  const getDueStatus = (debt: Debt) => {
    if (!debt.dueDate || isLunas(debt)) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(debt.dueDate);
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: `Terlambat ${Math.abs(diffDays)} hari`, color: 'rose' };
    if (diffDays <= 7) return { label: `${diffDays} hari lagi`, color: 'amber' };
    return null;
  };

  return (
    <div className="w-full space-y-3.5">
      {/* Header */}
      <div className="flex items-center justify-between pt-1 pb-0.5">
        <h1 className="text-xl font-extrabold text-[#1e3a5f] tracking-tight">
          Utang & Piutang
        </h1>
        {isAdmin && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAutoDebtOpen(true)}
              title="Catat Otomatis dari Teks"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-xs transition"
            >
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>Otomatis</span>
            </button>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#1e3a5f] hover:bg-[#162c47] shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah</span>
            </button>
          </div>
        )}
      </div>

      {/* Tab Switch: Utang / Piutang */}
      <div className="grid grid-cols-2 gap-2 bg-white rounded-2xl border border-slate-200/90 p-1.5 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab('utang')}
          className={`py-2 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
            activeTab === 'utang'
              ? 'bg-[#a83232] text-white border-[#a83232] shadow-xs'
              : 'bg-white text-slate-700 border-transparent hover:bg-slate-50'
          }`}
        >
          <TrendingDown className="w-3.5 h-3.5" />
          Utang Saya
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('piutang')}
          className={`py-2 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
            activeTab === 'piutang'
              ? 'bg-[#15803d] text-white border-[#15803d] shadow-xs'
              : 'bg-white text-slate-700 border-transparent hover:bg-slate-50'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          Piutang Saya
        </button>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-xl border border-slate-200/90 p-2.5 shadow-xs text-center">
          <div className="text-[10px] font-semibold text-slate-500">Total Pokok</div>
          <div className="text-xs font-bold text-slate-800 tracking-tight mt-0.5 truncate">
            {formatRupiah(summary.totalPokok)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 p-2.5 shadow-xs text-center">
          <div className="text-[10px] font-semibold text-slate-500">Sudah Dibayar</div>
          <div className="text-xs font-bold text-emerald-700 tracking-tight mt-0.5 truncate">
            {formatRupiah(summary.totalDibayar)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 p-2.5 shadow-xs text-center">
          <div className="text-[10px] font-semibold text-slate-500">Sisa</div>
          <div className={`text-xs font-bold tracking-tight mt-0.5 truncate ${
            activeTab === 'utang' ? 'text-rose-700' : 'text-emerald-700'
          }`}>
            {formatRupiah(summary.totalSisa)}
          </div>
        </div>
      </div>

      {/* Info Aktif / Lunas */}
      <div className="flex items-center gap-2 text-[11px] text-slate-500 px-1">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400"></span>
          Aktif: <b className="text-slate-700">{summary.aktif}</b>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          Lunas: <b className="text-slate-700">{summary.lunas}</b>
        </span>
        <span className="ml-auto">Total: <b className="text-slate-700">{summary.count}</b></span>
      </div>

      {/* Daftar Utang/Piutang */}
      <div className="space-y-2">
        {filteredDebts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-400 text-xs">
            Belum ada {activeTab === 'utang' ? 'utang' : 'piutang'} tercatat.
            {isAdmin && ' Klik "Tambah" untuk mulai mencatat.'}
          </div>
        ) : (
          filteredDebts.map(debt => {
            const paid = getTotalPaid(debt);
            const sisa = getSisa(debt);
            const progress = getProgress(debt);
            const lunas = isLunas(debt);
            const dueStatus = getDueStatus(debt);
            const expanded = expandedDebt === debt.id;

            return (
              <div
                key={debt.id}
                className={`bg-white rounded-2xl border shadow-xs overflow-hidden transition ${
                  lunas ? 'border-emerald-200' : 'border-slate-200/90'
                }`}
              >
                {/* Header Card */}
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm text-slate-800 truncate">
                          {debt.name}
                        </span>
                        {lunas ? (
                          <span className="inline-flex items-center gap-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded text-[10px] font-bold">
                            <Check className="w-3 h-3" />
                            LUNAS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded text-[10px] font-bold">
                            <Clock className="w-3 h-3" />
                            AKTIF
                          </span>
                        )}
                        {dueStatus && (
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            dueStatus.color === 'rose'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            <AlertCircle className="w-3 h-3" />
                            {dueStatus.label}
                          </span>
                        )}
                      </div>
                      {debt.counterparty && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Kepada: <span className="font-medium text-slate-700">{debt.counterparty}</span>
                        </div>
                      )}
                      {debt.notes && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Catatan: <span className="font-medium text-slate-700">{debt.notes}</span>
                        </div>
                      )}
                      </div>
                    {isAdmin && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(debt)}
                          className="p-1 text-slate-400 hover:text-[#1e3a5f] hover:bg-slate-100 rounded-md transition cursor-pointer"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`Hapus "${debt.name}" beserta riwayat pembayarannya?`)) {
                              await onDeleteDebt(debt.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition cursor-pointer"
                          title="Hapus"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-500">
                        Dibayar <b className="text-slate-700">{formatRupiah(paid)}</b> dari <b className="text-slate-700">{formatRupiah(debt.totalAmount)}</b>
                      </span>
                      <span className="font-bold text-slate-700">{progress.toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          lunas ? 'bg-emerald-500' : 'bg-[#1e3a5f]'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Sisa + Info */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">Sisa</div>
                      <div className={`text-xs font-bold ${lunas ? 'text-emerald-700' : activeTab === 'utang' ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {formatRupiah(sisa)}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">
                        {debt.installmentAmount ? 'Cicilan / bulan' : 'Jatuh tempo'}
                      </div>
                      <div className="text-xs font-bold text-slate-700 truncate">
                        {debt.installmentAmount
                          ? formatRupiah(debt.installmentAmount)
                          : debt.dueDate
                            ? formatTanggalIndo(debt.dueDate, true)
                            : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {!lunas && (
                      <button
                        type="button"
                        onClick={() => handleOpenPay(debt)}
                        className="flex-1 py-1.5 rounded-lg bg-[#1b7a4b] hover:bg-[#156a40] text-white text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <CircleDollarSign className="w-3.5 h-3.5" />
                        Bayar / Angsur
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedDebt(expanded ? null : debt.id)}
                      className="flex-1 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      Riwayat ({debt.payments.length})
                    </button>
                  </div>
                </div>

                {/* Riwayat Pembayaran (Expand) */}
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-3.5 py-2.5 space-y-1.5 animate-in fade-in">
                    {debt.payments.length === 0 ? (
                      <div className="text-center text-[11px] text-slate-400 py-2">
                        Belum ada pembayaran.
                      </div>
                    ) : (
                      [...debt.payments]
                        .sort((a, b) => (a.date < b.date ? 1 : -1))
                        .map((p, idx) => {
                          const accName = accounts.find(a => a.id === p.accountId)?.name;
                          return (
                            <div
                              key={p.id}
                              className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 flex items-start justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-bold text-slate-800">
                                  Angsuran #{debt.payments.length - idx}
                                </div>
                                <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-x-1.5">
                                  <span>{formatTanggalIndo(p.date, true)}</span>
                                  {accName && (
                                    <>
                                      <span>•</span>
                                      <span className="inline-flex items-center gap-0.5">
                                        <Wallet className="w-2.5 h-2.5" />
                                        {accName}
                                      </span>
                                    </>
                                  )}
                                  {p.notes && (
                                    <>
                                      <span>•</span>
                                      <span className="italic">{p.notes}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[11px] font-bold font-mono text-emerald-700">
                                  {formatRupiah(p.amount)}
                                </div>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (confirm('Hapus pembayaran ini?')) {
                                        await onDeletePayment(debt.id, p.id);
                                      }
                                    }}
                                    className="text-[10px] text-rose-500 hover:text-rose-700 hover:underline cursor-pointer"
                                  >
                                    Hapus
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* MODAL TAMBAH / EDIT UTANG-PIUTANG */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  activeTab === 'utang' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {activeTab === 'utang' ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm">
                    {editingDebt ? 'Edit' : 'Tambah'} {activeTab === 'utang' ? 'Utang' : 'Piutang'}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    Catat pokok, cicilan, dan jatuh tempo
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddModal(false); setEditingDebt(null); resetForm(); }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitDebt} className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
              {/* Nama */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama {activeTab === 'utang' ? 'Utang' : 'Piutang'}
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={activeTab === 'utang' ? 'mis. Motor Vario' : 'mis. Pinjaman Ali'}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              {/* Pihak */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {activeTab === 'utang' ? 'Kepada' : 'Dari'}
                </label>
                <input
                  type="text"
                  value={formCounterparty}
                  onChange={(e) => setFormCounterparty(e.target.value)}
                  placeholder={activeTab === 'utang' ? 'mis. Dealer Honda' : 'mis. Ali'}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              {/* Total */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Total Pokok (Rp)
                </label>
                <input
                  type="text"
                  required
                  value={formTotal}
                  onChange={(e) => {
                    const parsed = parseRupiahInput(e.target.value);
                    setFormTotal(parsed === 0 ? '' : parsed.toLocaleString('id-ID'));
                  }}
                  placeholder="0"
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] font-mono font-bold"
                />
              </div>

              {/* Tanggal Mulai & Jatuh Tempo */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tanggal Mulai
                  </label>
                  <input
                    type="date"
                    required
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Jatuh Tempo (opsional)
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                  />
                </div>
              </div>

              {/* Cicilan */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cicilan / Bulan (opsional)
                  </label>
                  <input
                    type="text"
                    value={formInstallment}
                    onChange={(e) => {
                      const parsed = parseRupiahInput(e.target.value);
                      setFormInstallment(parsed === 0 ? '' : parsed.toLocaleString('id-ID'));
                    }}
                    placeholder="0"
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Jumlah Cicilan (opsional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formPeriod}
                    onChange={(e) => setFormPeriod(e.target.value)}
                    placeholder="mis. 12"
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                  />
                </div>
              </div>

              {/* Catatan */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan (opsional)
                </label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="mis. Bunga 0%, DP 1 juta"
                  className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#1b7a4b] hover:bg-[#156a40] text-white font-bold text-xs transition shadow-xs cursor-pointer"
                >
                  {editingDebt ? 'Simpan Perubahan' : 'Simpan'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddModal(false); setEditingDebt(null); resetForm(); }}
                  className="py-2.5 px-4 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL BAYAR / ANGSUR */}
      {payingDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-emerald-50/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CircleDollarSign className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm">
                    Bayar / Angsur
                  </h3>
                  <p className="text-[10px] text-slate-500 truncate">
                    {payingDebt.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPayingDebt(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-5 space-y-3.5">
              <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Total Pokok</span>
                  <span className="font-bold text-slate-800">{formatRupiah(payingDebt.totalAmount)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Sudah Dibayar</span>
                  <span className="font-bold text-emerald-700">{formatRupiah(getTotalPaid(payingDebt))}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200">
                  <span className="font-bold text-slate-700">Sisa</span>
                  <span className="font-bold text-rose-700">{formatRupiah(getSisa(payingDebt))}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tanggal Bayar
                </label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Jumlah Bayar (Rp)
                </label>
                <input
                  type="text"
                  required
                  value={payAmount}
                  onChange={(e) => {
                    const parsed = parseRupiahInput(e.target.value);
                    setPayAmount(parsed === 0 ? '' : parsed.toLocaleString('id-ID'));
                  }}
                  placeholder="0"
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] font-mono font-bold"
                />
                <div className="flex items-center gap-1.5 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setPayAmount(getSisa(payingDebt).toLocaleString('id-ID'))}
                    className="text-[10px] font-bold text-[#1e3a5f] hover:underline cursor-pointer"
                  >
                    Lunasi ({formatRupiah(getSisa(payingDebt))})
                  </button>
                  {payingDebt.installmentAmount && (
                    <>
                      <span className="text-slate-300">•</span>
                      <button
                        type="button"
                        onClick={() => setPayAmount(payingDebt.installmentAmount!.toLocaleString('id-ID'))}
                        className="text-[10px] font-bold text-[#1e3a5f] hover:underline cursor-pointer"
                      >
                        Cicilan ({formatRupiah(payingDebt.installmentAmount)})
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Bayar dari Akun (opsional)
                </label>
                <select
                  value={payAccount}
                  onChange={(e) => setPayAccount(e.target.value)}
                  className="w-full bg-white text-slate-800 text-xs sm:text-sm rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                >
                  <option value="">— tidak dicatat di akun —</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Catatan: pembayaran di sini <b>tidak otomatis</b> mengurangi saldo akun. Catat transaksi "Keluar" di Dompet Toko jika ingin mempengaruhi saldo.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan (opsional)
                </label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="mis. angsuran ke-3"
                  className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#1b7a4b] hover:bg-[#156a40] text-white font-bold text-xs transition shadow-xs cursor-pointer"
                >
                  Simpan Pembayaran
                </button>
                <button
                  type="button"
                  onClick={() => setPayingDebt(null)}
                  className="py-2.5 px-4 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        <AutoDebtModal
      isOpen={autoDebtOpen}
      onClose={() => setAutoDebtOpen(false)}
      onAddDebts={async (items) => {
        for (const item of items) {
          await onAddDebt(item);
        }
      }}
    />
    </div>
  );
};