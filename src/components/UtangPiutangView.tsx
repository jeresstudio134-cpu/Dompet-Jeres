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
  Lock,
  Printer,
} from 'lucide-react';
import { AutoDebtModal } from './AutoDebtModal.tsx';
import { Debt, DebtType, DebtPayment, Account } from '../types/finance.ts';
import { formatRupiah, formatTanggalIndo, parseRupiahInput, getCurrentDateIndo } from '../utils/formatters.ts';
import { escapeHtml, printHtml } from '../utils/printReport.ts';

// Tanda kosong seragam untuk semua kotak yang datanya belum diisi
const EMPTY_DASH = <span className="font-mono">—</span>;
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
  onOpenAdminModal?: () => void;
  storeName?: string;
  ownerName?: string;
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
  onOpenAdminModal,
  storeName,
  ownerName,
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
  const [formTotal, setFormTotal] = useState('');
  const [formStartDate, setFormStartDate] = useState(getCurrentDateIndo());
  const [formDueDate, setFormDueDate] = useState('');
  const [formInstallment, setFormInstallment] = useState('');
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
    setFormTotal('');
    setFormStartDate(getCurrentDateIndo());
    setFormDueDate('');
    setFormInstallment('');
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
    setFormTotal(debt.totalAmount ? debt.totalAmount.toLocaleString('id-ID') : '');
    setFormStartDate(debt.startDate);
    setFormDueDate(debt.dueDate || '');
    setFormInstallment(debt.installmentAmount ? debt.installmentAmount.toLocaleString('id-ID') : '');
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

  const generateAndPrintTabReport = (type: DebtType) => {
    const now = new Date();
    const waktuCetak =
      now.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }) +
      ', ' +
      now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

    const storeTitle = storeName?.trim() || 'Dompet Keuangan';
    const isPiutang = type === 'piutang';
    const typeLabel = isPiutang ? 'Piutang Saya' : 'Utang Saya';
    const paidLabel = isPiutang ? 'Sudah Diterima' : 'Sudah Dibayar';

    const currentList = debts.filter(d => d.type === type);

    let totalPokok = 0;
    let totalDibayar = 0;
    let totalSisa = 0;
    let lunas = 0;
    let aktif = 0;

    currentList.forEach(d => {
      totalPokok += d.totalAmount;
      const paid = getTotalPaid(d);
      totalDibayar += paid;
      totalSisa += Math.max(0, d.totalAmount - paid);
      if (isLunas(d)) lunas++;
      else aktif++;
    });

    // Kelompokkan data per Pihak (counterparty)
    const partyGroups: { [party: string]: Debt[] } = {};
    currentList.forEach(d => {
      const key = d.counterparty?.trim() || 'Tanpa Pihak';
      if (!partyGroups[key]) partyGroups[key] = [];
      partyGroups[key].push(d);
    });

    // Urutkan kelompok: yang memiliki sisa tagihan terbesar di atas
    const sortedPartyKeys = Object.keys(partyGroups).sort((a, b) => {
      const sisaA = partyGroups[a].reduce((sum, d) => sum + getSisa(d), 0);
      const sisaB = partyGroups[b].reduce((sum, d) => sum + getSisa(d), 0);
      return sisaB - sisaA;
    });

    const hasDueDate = currentList.some(d => Boolean(d.dueDate && d.dueDate.trim() !== ''));

    const groupTablesHtml = sortedPartyKeys
      .map(partyName => {
        const items = partyGroups[partyName].sort((a, b) => {
          const aLunas = isLunas(a);
          const bLunas = isLunas(b);
          if (aLunas !== bLunas) return aLunas ? 1 : -1;
          return (b.startDate || '').localeCompare(a.startDate || '');
        });

        const partyPokok = items.reduce((sum, d) => sum + d.totalAmount, 0);
        const partyDibayar = items.reduce((sum, d) => sum + getTotalPaid(d), 0);
        const partySisa = items.reduce((sum, d) => sum + getSisa(d), 0);

        const itemsWithPayments = items.filter(d => d.payments && d.payments.length > 0);

        return `
        <div style="margin-bottom: 14px; page-break-inside: avoid;">
          <div style="background-color: #f1f3f5; border: 1px solid #ccc; border-bottom: none; padding: 5px 8px; font-weight: bold; font-size: 11px; display: flex; justify-content: space-between;">
            <span>Kelompok Pihak: ${escapeHtml(partyName)} (${items.length} transaksi)</span>
            <span style="font-size: 10px; color: #333;">Subtotal Sisa: ${formatRupiah(partySisa)}</span>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 9.5px;">
            <thead>
              <tr style="background-color: #f8f9fa; color: #222;">
                <th style="border: 1px solid #ccc; padding: 3px 5px; width: 26px; text-align: center;">No</th>
                <th style="border: 1px solid #ccc; padding: 3px 5px; text-align: left;">Keterangan</th>
                <th style="border: 1px solid #ccc; padding: 3px 5px; width: 75px; text-align: left;">Tanggal</th>
                ${hasDueDate ? '<th style="border: 1px solid #ccc; padding: 3px 5px; width: 75px; text-align: left;">Jatuh Tempo</th>' : ''}
                <th style="border: 1px solid #ccc; padding: 3px 5px; width: 90px; text-align: right;">Total Pokok</th>
                <th style="border: 1px solid #ccc; padding: 3px 5px; width: 90px; text-align: right;">${escapeHtml(paidLabel)}</th>
                <th style="border: 1px solid #ccc; padding: 3px 5px; width: 90px; text-align: right;">Sisa</th>
                <th style="border: 1px solid #ccc; padding: 3px 5px; width: 50px; text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map((d, idx) => {
                  const paid = getTotalPaid(d);
                  const sisa = getSisa(d);
                  return `
                  <tr>
                    <td style="border: 1px solid #ccc; padding: 3px 5px; text-align: center;">${idx + 1}</td>
                    <td style="border: 1px solid #ccc; padding: 3px 5px;">${escapeHtml(d.name)}</td>
                    <td style="border: 1px solid #ccc; padding: 3px 5px;">${escapeHtml(formatTanggalIndo(d.startDate))}</td>
                    ${hasDueDate ? `<td style="border: 1px solid #ccc; padding: 3px 5px;">${d.dueDate ? escapeHtml(formatTanggalIndo(d.dueDate)) : '-'}</td>` : ''}
                    <td style="border: 1px solid #ccc; padding: 3px 5px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(d.totalAmount)}</td>
                    <td style="border: 1px solid #ccc; padding: 3px 5px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(paid)}</td>
                    <td style="border: 1px solid #ccc; padding: 3px 5px; text-align: right; font-variant-numeric: tabular-nums; font-weight: bold;">${formatRupiah(sisa)}</td>
                    <td style="border: 1px solid #ccc; padding: 3px 5px; text-align: center;">${isLunas(d) ? 'Lunas' : 'Aktif'}</td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
            <tfoot>
              <tr style="background-color: #fafafa; font-weight: bold;">
                <td colspan="${hasDueDate ? 3 : 2}" style="border: 1px solid #ccc; padding: 4px 5px; text-align: right;">Subtotal ${escapeHtml(partyName)}:</td>
                <td style="border: 1px solid #ccc; padding: 4px 5px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(partyPokok)}</td>
                <td style="border: 1px solid #ccc; padding: 4px 5px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(partyDibayar)}</td>
                <td style="border: 1px solid #ccc; padding: 4px 5px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(partySisa)}</td>
                <td style="border: 1px solid #ccc; padding: 4px 5px; text-align: center;">-</td>
              </tr>
            </tfoot>
          </table>

          ${
            itemsWithPayments.length > 0
              ? `
            <div style="margin-top: 4px; padding: 4px 6px; background: #fafafa; border: 1px solid #e0e0e0; font-size: 8.5px;">
              <div style="font-weight: bold; margin-bottom: 2px; color: #444;">Riwayat Angsuran (${escapeHtml(partyName)}):</div>
              ${itemsWithPayments
                .map(
                  d => `
                <div style="margin-bottom: 3px;">
                  <span style="font-weight: bold;">${escapeHtml(d.name)}:</span>
                  ${d.payments
                    .map(
                      p =>
                        `[${formatTanggalIndo(p.date)}: ${formatRupiah(p.amount)}${
                          p.notes ? ' (' + escapeHtml(p.notes) + ')' : ''
                        }]`
                    )
                    .join(', ')}
                </div>
              `
                )
                .join('')}
            </div>
          `
              : ''
          }
        </div>
      `;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Laporan ${escapeHtml(typeLabel)} - ${escapeHtml(storeTitle)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 12mm 16mm 12mm;
      @bottom-right {
        content: "Hal. " counter(page) " / " counter(pages);
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9px;
        color: #555;
      }
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.5px;
      line-height: 1.4;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    thead { display: table-header-group; }
    tfoot { display: table-row-group; }
    tr { page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; word-wrap: break-word; }
  </style>
</head>
<body>
  <!-- Kop Toko -->
  <table style="width: 100%; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 12px;">
    <tr>
      <td style="vertical-align: bottom; text-align: left;">
        <div style="font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #111;">
          ${escapeHtml(storeTitle)}
        </div>
        <div style="font-size: 12px; font-weight: bold; color: #333; margin-top: 2px;">
          LAPORAN ${escapeHtml(typeLabel).toUpperCase()} (PER KELOMPOK PIHAK)
        </div>
      </td>
      <td style="vertical-align: bottom; text-align: right; font-size: 9.5px; color: #444;">
        <div>Waktu Cetak:</div>
        <div style="font-weight: bold; color: #111;">${escapeHtml(waktuCetak)}</div>
      </td>
    </tr>
  </table>

  <!-- Ringkasan Tab -->
  <div style="border: 1px solid #bbb; border-radius: 4px; padding: 8px 12px; background-color: #fafafa; margin-bottom: 12px;">
    <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 6px; color: #111;">
      RINGKASAN ${escapeHtml(typeLabel).toUpperCase()}
    </div>
    <table style="width: 100%; font-size: 10px;">
      <tr>
        <td style="color: #444; width: 33%;">Total Pokok: <b style="color: #111; font-variant-numeric: tabular-nums;">${formatRupiah(totalPokok)}</b></td>
        <td style="color: #444; width: 33%;">${escapeHtml(paidLabel)}: <b style="color: #111; font-variant-numeric: tabular-nums;">${formatRupiah(totalDibayar)}</b></td>
        <td style="color: #111; width: 34%; font-weight: bold;">Sisa: <b style="font-variant-numeric: tabular-nums;">${formatRupiah(totalSisa)}</b></td>
      </tr>
      <tr>
        <td colspan="3" style="color: #555; padding-top: 4px; font-size: 9px;">
          Status: <b>${aktif} Aktif</b>, <b>${lunas} Lunas</b> (Total: ${currentList.length} item dari ${sortedPartyKeys.length} kelompok pihak)
        </td>
      </tr>
    </table>
  </div>

  <!-- Kelompok Pihak -->
  ${groupTablesHtml}

  <!-- Grand Total Table -->
  <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; margin-bottom: 14px;">
    <tr style="background-color: #e9ecef; font-weight: bold;">
      <td style="border: 1.5px solid #333; padding: 6px 8px; text-align: right;">GRAND TOTAL ${escapeHtml(typeLabel).toUpperCase()}:</td>
      <td style="border: 1.5px solid #333; padding: 6px 8px; width: 110px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(totalPokok)}</td>
      <td style="border: 1.5px solid #333; padding: 6px 8px; width: 110px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(totalDibayar)}</td>
      <td style="border: 1.5px solid #333; padding: 6px 8px; width: 110px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(totalSisa)}</td>
    </tr>
  </table>

  <!-- Footer -->
  <div style="margin-top: 14px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 9px; color: #555; text-align: center;">
    Dokumen ini dibuat otomatis oleh aplikasi pada ${escapeHtml(waktuCetak)}.
  </div>
</body>
</html>`;

    printHtml(html, `Laporan ${typeLabel} - ${storeTitle}`);
  };

  const generateAndPrintSingleDebt = (debt: Debt) => {
    const now = new Date();
    const waktuCetak =
      now.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }) +
      ', ' +
      now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

    const storeTitle = storeName?.trim() || 'Dompet Keuangan';
    const ownerTitle = ownerName?.trim() || storeTitle;
    const isPiutang = debt.type === 'piutang';
    const typeLabel = isPiutang ? 'Piutang' : 'Utang';
    const paid = getTotalPaid(debt);
    const sisa = getSisa(debt);
    const lunas = isLunas(debt);

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Rincian ${escapeHtml(typeLabel)} - ${escapeHtml(debt.counterparty || debt.name)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 12mm 16mm 12mm;
      @bottom-right {
        content: "Hal. " counter(page) " / " counter(pages);
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9px;
        color: #555;
      }
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.5px;
      line-height: 1.4;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    thead { display: table-header-group; }
    tfoot { display: table-row-group; }
    tr { page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; word-wrap: break-word; }
  </style>
</head>
<body>
  <!-- Kop Toko -->
  <table style="width: 100%; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 12px;">
    <tr>
      <td style="vertical-align: bottom; text-align: left;">
        <div style="font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #111;">
          ${escapeHtml(storeTitle)}
        </div>
        <div style="font-size: 12px; font-weight: bold; color: #333; margin-top: 2px;">
          SURAT RINCIAN / KARTU ${escapeHtml(typeLabel).toUpperCase()}
        </div>
      </td>
      <td style="vertical-align: bottom; text-align: right; font-size: 9.5px; color: #444;">
        <div>Waktu Cetak:</div>
        <div style="font-weight: bold; color: #111;">${escapeHtml(waktuCetak)}</div>
      </td>
    </tr>
  </table>

  <!-- Data Pihak & Detail -->
  <div style="border: 1px solid #bbb; border-radius: 4px; padding: 10px 12px; background-color: #fafafa; margin-bottom: 14px;">
    <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; color: #111;">
      INFORMASI ${escapeHtml(typeLabel).toUpperCase()}
    </div>
    <table style="width: 100%; font-size: 10.5px;">
      <tr>
        <td style="width: 130px; color: #555; padding: 2px 0;">Pihak Bersangkutan:</td>
        <td style="font-weight: bold; color: #111;">${escapeHtml(debt.counterparty || '-')}</td>
      </tr>
      <tr>
        <td style="color: #555; padding: 2px 0;">Keterangan / Keperluan:</td>
        <td style="font-weight: bold; color: #111;">${escapeHtml(debt.name)}</td>
      </tr>
      <tr>
        <td style="color: #555; padding: 2px 0;">Tanggal Pinjam/Mulai:</td>
        <td>${escapeHtml(formatTanggalIndo(debt.startDate))}</td>
      </tr>
      ${
        debt.dueDate
          ? `
      <tr>
        <td style="color: #555; padding: 2px 0;">Jatuh Tempo:</td>
        <td>${escapeHtml(formatTanggalIndo(debt.dueDate))}</td>
      </tr>`
          : ''
      }
      ${
        debt.installmentAmount
          ? `
      <tr>
        <td style="color: #555; padding: 2px 0;">Cicilan per Bulan:</td>
        <td>${formatRupiah(debt.installmentAmount)}</td>
      </tr>`
          : ''
      }
      ${
        debt.notes
          ? `
      <tr>
        <td style="color: #555; padding: 2px 0;">Catatan Tambahan:</td>
        <td>${escapeHtml(debt.notes)}</td>
      </tr>`
          : ''
      }
      <tr>
        <td style="color: #555; padding: 2px 0;">Status Saat Ini:</td>
        <td style="font-weight: bold;">${lunas ? 'LUNAS' : 'AKTIF / BELUM LUNAS'}</td>
      </tr>
    </table>
  </div>

  <!-- Kartu Rekap Nominal 3 Kolom -->
  <table style="width: 100%; border-collapse: separate; border-spacing: 8px 0; margin-bottom: 14px;">
    <tr>
      <td style="width: 33.33%; border: 1px solid #bbb; border-radius: 4px; padding: 8px; background-color: #fafafa; text-align: center;">
        <div style="font-size: 9.5px; color: #555; text-transform: uppercase;">Total Pokok</div>
        <div style="font-size: 13px; font-weight: bold; margin-top: 3px; font-variant-numeric: tabular-nums;">
          ${formatRupiah(debt.totalAmount)}
        </div>
      </td>
      <td style="width: 33.33%; border: 1px solid #bbb; border-radius: 4px; padding: 8px; background-color: #fafafa; text-align: center;">
        <div style="font-size: 9.5px; color: #555; text-transform: uppercase;">${isPiutang ? 'Sudah Diterima' : 'Sudah Dibayar'}</div>
        <div style="font-size: 13px; font-weight: bold; margin-top: 3px; font-variant-numeric: tabular-nums;">
          ${formatRupiah(paid)}
        </div>
      </td>
      <td style="width: 33.33%; border: 1.5px solid #333; border-radius: 4px; padding: 8px; background-color: #f1f3f5; text-align: center;">
        <div style="font-size: 9.5px; color: #333; text-transform: uppercase; font-weight: bold;">Sisa Tagihan</div>
        <div style="font-size: 13px; font-weight: bold; margin-top: 3px; font-variant-numeric: tabular-nums;">
          ${formatRupiah(sisa)}
        </div>
      </td>
    </tr>
  </table>

  <!-- Riwayat Pembayaran / Angsuran -->
  <div style="margin-bottom: 24px;">
    <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; border-bottom: 1.5px solid #333; padding-bottom: 3px; margin-bottom: 6px;">
      RIWAYAT ANGSURAN / PEMBAYARAN (${debt.payments.length})
    </div>
    ${
      debt.payments.length === 0
        ? `
      <div style="border: 1px solid #ddd; padding: 12px; text-align: center; color: #777; font-size: 10px; background-color: #fafafa; border-radius: 4px;">
        Belum ada catatan pembayaran atau angsuran untuk item ini.
      </div>
    `
        : `
      <table style="width: 100%; border-collapse: collapse; font-size: 9.5px;">
        <thead>
          <tr style="background-color: #f1f3f5; color: #111;">
            <th style="border: 1px solid #ccc; padding: 4px 6px; width: 30px; text-align: center;">No</th>
            <th style="border: 1px solid #ccc; padding: 4px 6px; width: 100px; text-align: left;">Tanggal</th>
            <th style="border: 1px solid #ccc; padding: 4px 6px; width: 120px; text-align: right;">Nominal Angsuran</th>
            <th style="border: 1px solid #ccc; padding: 4px 6px; text-align: left;">Catatan / Keterangan</th>
          </tr>
        </thead>
        <tbody>
          ${debt.payments
            .map(
              (p, idx) => `
            <tr>
              <td style="border: 1px solid #ccc; padding: 3px 6px; text-align: center;">${idx + 1}</td>
              <td style="border: 1px solid #ccc; padding: 3px 6px;">${escapeHtml(formatTanggalIndo(p.date))}</td>
              <td style="border: 1px solid #ccc; padding: 3px 6px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(
                p.amount
              )}</td>
              <td style="border: 1px solid #ccc; padding: 3px 6px; color: #444;">${escapeHtml(p.notes || '-')}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr style="background-color: #f8f9fa; font-weight: bold;">
            <td colspan="2" style="border: 1px solid #ccc; padding: 4px 6px; text-align: right;">Total Telah Dibayar:</td>
            <td style="border: 1px solid #ccc; padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums;">${formatRupiah(
              paid
            )}</td>
            <td style="border: 1px solid #ccc; padding: 4px 6px;"></td>
          </tr>
        </tfoot>
      </table>
    `
    }
  </div>

  <!-- Area Tanda Tangan -->
  <table style="width: 100%; margin-top: 30px; margin-bottom: 20px; page-break-inside: avoid;">
    <tr>
      <td style="width: 50%; text-align: center; vertical-align: top;">
        <div style="font-size: 10px; color: #555;">Pihak Bersangkutan:</div>
        <div style="font-weight: bold; margin-top: 2px;">${escapeHtml(debt.counterparty || 'Debitur / Peminjam')}</div>
        <div style="height: 50px;"></div>
        <div style="border-top: 1px dashed #666; width: 60%; margin: 0 auto; padding-top: 3px; font-size: 9px; color: #666;">
          (Tanda Tangan &amp; Nama Terang)
        </div>
      </td>
      <td style="width: 50%; text-align: center; vertical-align: top;">
        <div style="font-size: 10px; color: #555;">Pihak Pengelola:</div>
        <div style="font-weight: bold; margin-top: 2px;">${escapeHtml(ownerTitle)}</div>
        <div style="height: 50px;"></div>
        <div style="border-top: 1px dashed #666; width: 60%; margin: 0 auto; padding-top: 3px; font-size: 9px; color: #666;">
          (Tanda Tangan / Cap Toko)
        </div>
      </td>
    </tr>
  </table>

  <!-- Footer -->
  <div style="margin-top: 18px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 9px; color: #555; text-align: center;">
    Dokumen ini dicetak otomatis oleh aplikasi pada ${escapeHtml(waktuCetak)}.
  </div>
</body>
</html>`;

    printHtml(html, `Rincian ${typeLabel} - ${debt.counterparty || debt.name}`);
  };

  const handlePrint = () => {
    const currentList = debts.filter(d => d.type === activeTab);
    if (currentList.length === 0) {
      alert(`Belum ada data ${activeTab === 'piutang' ? 'piutang' : 'utang'} untuk dicetak.`);
      return;
    }

    if (onOpenAdminModal && !isAdmin) {
      onOpenAdminModal();
      return;
    }

    generateAndPrintTabReport(activeTab);
  };

  const handlePrintSingleDebt = (debt: Debt) => {
    if (onOpenAdminModal && !isAdmin) {
      onOpenAdminModal();
      return;
    }

    generateAndPrintSingleDebt(debt);
  };

  return (
    <div className="w-full space-y-3.5">
      {/* Header */}
      <div className="flex items-center justify-between pt-1 pb-0.5">
        <h1 className="text-xl font-extrabold text-[#1e3a5f] tracking-tight">
          Utang & Piutang
        </h1>
        <div className="flex items-center gap-1.5">

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setAutoDebtOpen(true)}
                title="Catat Otomatis dari Teks"
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-xs transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                <span>Otomatis</span>
              </button>
              <button
                type="button"
                onClick={handleOpenAdd}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#1e3a5f] hover:bg-[#162c47] shadow-xs transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah</span>
              </button>
            </>
          )}
        </div>
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
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePrintSingleDebt(debt)}
                        className="p-1 text-slate-400 hover:text-[#1e3a5f] hover:bg-slate-100 rounded-md transition cursor-pointer"
                        title="Cetak Rincian Ini"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      {isAdmin && (
                        <>
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
                        </>
                      )}
                    </div>
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

                  {/* Ringkasan nominal */}
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">Total Pokok</div>
                      <div className="text-xs font-bold font-mono text-slate-800">
                        {formatRupiah(debt.totalAmount)}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">
                        {activeTab === 'utang' ? 'Sudah Dibayar' : 'Sudah Diterima'}
                      </div>
                      <div className="text-xs font-bold font-mono text-emerald-700">
                        {formatRupiah(paid)}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">Sisa</div>
                      <div className={`text-xs font-bold font-mono ${lunas ? 'text-emerald-700' : activeTab === 'utang' ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {formatRupiah(sisa)}
                      </div>
                    </div>
                  </div>

                  {/* Tanggal, jatuh tempo, cicilan (selalu tampil, kosong = tanda yang sama) */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">Tanggal Mulai</div>
                      <div className="text-xs font-bold text-slate-700 truncate">
                        {debt.startDate ? formatTanggalIndo(debt.startDate) : EMPTY_DASH}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">Jatuh Tempo</div>
                      <div className="text-xs font-bold text-slate-700 truncate">
                        {debt.dueDate ? formatTanggalIndo(debt.dueDate) : EMPTY_DASH}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">Cicilan / Bulan</div>
                      <div className="text-xs font-bold text-slate-700 truncate">
                        {debt.installmentAmount ? (
                          <span className="font-mono">{formatRupiah(debt.installmentAmount)}</span>
                        ) : (
                          EMPTY_DASH
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <div className="text-[10px] text-slate-500 font-medium">Jumlah Cicilan</div>
                      <div className="text-xs font-bold text-slate-700 truncate">
                        {debt.installmentPeriod ? `${debt.installmentPeriod}x` : EMPTY_DASH}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {!lunas && (
                      isAdmin ? (
                        // Mode Admin: tombol aktif
                        <button
                          type="button"
                          onClick={() => handleOpenPay(debt)}
                          className="flex-1 py-1.5 rounded-lg bg-[#1b7a4b] hover:bg-[#156a40] text-white text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <CircleDollarSign className="w-3.5 h-3.5" />
                          Bayar / Angsur
                        </button>
                      ) : (
                        // Mode Kasir: tombol terkunci (disabled, tanpa popup alert)
                        <button
                          type="button"
                          disabled
                          className="flex-1 py-1.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-400 text-[11px] font-bold flex items-center justify-center gap-1 cursor-not-allowed select-none opacity-80"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          Bayar (Hanya Admin)
                        </button>
                      )
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
                  Catatan: pembayaran di sini <b>tidak otomatis</b> mengurangi saldo akun. Catat transaksi "Keluar" di {storeName || 'Dompet Keuangan'} jika ingin mempengaruhi saldo.
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
