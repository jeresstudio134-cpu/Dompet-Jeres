/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  INITIAL_ACCOUNTS, 
  INITIAL_CATEGORIES,
  INITIAL_TRANSACTIONS,
  INITIAL_KANTONG // <--- Tambahkan ini
} from './data/initialData.ts';
import { 
  Transaction, 
  Account, 
  FilterState, 
  MonthlyStats, 
  NeonConfig,
  Debt,
  DebtPayment,
} from './types/finance.ts';
import { 
  getMonthYearOptions, 
  formatRupiah 
} from './utils/formatters.ts';
import { getSavedNeonConfig, saveNeonConfig } from './lib/neon.ts';
import {
  apiLoadAll,
  apiSaveTransaction,
  apiSaveTransactions,
  apiDeleteTransaction,
  apiSaveAccount,
  apiDeleteAccount,
  apiAddCategory,
  apiDeleteCategory,
  apiAddKantong,
  apiDeleteKantong,
  apiSaveSetting,
  getAdminToken,
  clearAdminToken,
  apiLoadDebts,
  apiSaveDebt,
  apiDeleteDebt,
  apiSaveDebtPayment,
  apiDeleteDebtPayment,
} from './lib/api.ts';

// Components
import { DompetTokoView } from './components/DompetTokoView.tsx';
import { AutoRecordModal } from './components/AutoRecordModal.tsx';
import { NeonVercelModal } from './components/NeonVercelModal.tsx';
import { ExportImportModal } from './components/ExportImportModal.tsx';
import { AdminPinModal } from './components/AdminPinModal.tsx';
import { UtangPiutangView } from './components/UtangPiutangView.tsx';
import { BukuTahunanView } from './components/BukuTahunanView.tsx';
import { Wallet, CreditCard, BookOpen } from 'lucide-react';


export default function App() {
  // 1. Core State
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [storeName, setStoreName] = useState<string>('Dompet Keuangan');
  const [ownerName, setOwnerName] = useState<string>('Mohammad Miftah');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadSlow, setLoadSlow] = useState<boolean>(false);

  const handleUpdateStoreName = async (newName: string): Promise<boolean> => {
    const trimmed = newName.trim() || 'Dompet Keuangan';
    try {
      await apiSaveSetting('store_name', trimmed);
      setStoreName(trimmed);
      showToast(`Nama toko berhasil diubah menjadi "${trimmed}"!`, 'success');
      return true;
    } catch (e) {
      console.error(e);
      showToast('Gagal menyimpan nama toko. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
  };

  const handleUpdateOwnerName = async (newName: string): Promise<boolean> => {
    const trimmed = newName.trim() || 'Mohammad Miftah';
    try {
      await apiSaveSetting('owner_name', trimmed);
      setOwnerName(trimmed);
      showToast(`Nama pemilik berhasil diubah menjadi "${trimmed}"!`, 'success');
      return true;
    } catch (e) {
      console.error(e);
      showToast('Gagal menyimpan nama pemilik. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
  };

  // Kategori
  const isExcludedCategory = (name?: string) => {
    if (!name) return true;
    const lower = name.trim().toLowerCase();
    return lower === '' || lower === '-' || lower === 'lainnya' || lower === 'lainya' || lower === 'lain-lain' || lower === 'lain nya';
  };

  const [categories, setCategories] = useState<string[]>([]);
  const [kantongList, setKantongList] = useState<string[]>([]);

  const handleAddCategory = async (newCat: string) => {
    const trimmed = newCat.trim();
    if (!trimmed || isExcludedCategory(trimmed)) return;
    if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) return;
    try {
      await apiAddCategory(trimmed);
      setCategories(prev => [...prev, trimmed]);
      showToast(`Kategori baru "${trimmed}" berhasil ditambahkan!`);
    } catch (e) {
      console.error(e);
      showToast('Gagal menambah kategori. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  const handleDeleteCategory = async (catToDelete: string) => {
    try {
      await apiDeleteCategory(catToDelete);
      setCategories(prev => prev.filter(c => c !== catToDelete));
      setTransactions(prev => prev.map(t => (t.category === catToDelete ? { ...t, category: '' } : t)));
      showToast(`Kategori "${catToDelete}" telah dihapus.`, 'info');
    } catch (e) {
      console.error(e);
      showToast('Gagal menghapus kategori. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  const handleAddKantong = async (newKt: string) => {
    const trimmed = newKt.trim();
    if (!trimmed || isExcludedCategory(trimmed)) return;
    if (kantongList.some(k => k.toLowerCase() === trimmed.toLowerCase())) return;
    try {
      await apiAddKantong(trimmed);
      setKantongList(prev => [...prev, trimmed]);
      showToast(`Kantong baru "${trimmed}" berhasil ditambahkan!`);
    } catch (e) {
      console.error(e);
      showToast('Gagal menambah kantong. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  const handleDeleteKantong = async (ktToDelete: string) => {
    try {
      await apiDeleteKantong(ktToDelete);
      setKantongList(prev => prev.filter(k => k !== ktToDelete));
      setTransactions(prev => prev.map(t => (t.kantong === ktToDelete ? { ...t, kantong: '' } : t)));
      showToast(`Kantong "${ktToDelete}" telah dihapus.`, 'info');
    } catch (e) {
      console.error(e);
      showToast('Gagal menghapus kantong. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  // ============================================
  // UTANG & PIUTANG & BUKU TAHUNAN
  // ============================================
  const [debts, setDebts] = useState<Debt[]>([]);
  const [mainView, setMainView] = useState<'dompet' | 'utang' | 'tahunan'>('dompet');

  // Handler: Tambah utang/piutang (dengan support payments dari AI)
  const handleAddDebt = async (
    debtData: Omit<Debt, 'id' | 'createdAt' | 'payments'> & { payments?: any[] }
  ) => {
    const debtId = `debt-${Date.now()}`;
    const incomingPayments = Array.isArray(debtData.payments) ? debtData.payments : [];

    const payments: DebtPayment[] = incomingPayments.map((p: any, idx: number) => ({
      id: `pay-${Date.now()}-${idx}-${Math.random().toString(36).slice(-4)}`,
      debtId,
      date: p.date,
      amount: p.amount,
      accountId: p.accountId,
      notes: p.notes,
    }));

    const newDebt: Debt = {
      type: debtData.type,
      name: debtData.name,
      counterparty: debtData.counterparty,
      totalAmount: debtData.totalAmount,
      startDate: debtData.startDate,
      dueDate: debtData.dueDate,
      installmentAmount: debtData.installmentAmount,
      installmentPeriod: debtData.installmentPeriod,
      notes: debtData.notes,
      id: debtId,
      createdAt: new Date().toISOString(),
      payments,
    };

    try {
      await apiSaveDebt(newDebt);
      for (const p of payments) {
        await apiSaveDebtPayment(p);
      }
      setDebts(prev => [newDebt, ...prev]);
      showToast(
        `${debtData.type === 'utang' ? 'Utang' : 'Piutang'} "${debtData.name}" berhasil dicatat${
          payments.length > 0 ? ` dengan ${payments.length} angsuran` : ''
        }!`
      );
    } catch (e) {
      console.error(e);
      showToast('Gagal menyimpan ke database. Coba lagi.', 'error');
    }
  };

  // Handler: Update utang/piutang
  const handleUpdateDebt = async (updated: Debt) => {
    try {
      await apiSaveDebt(updated);
      setDebts(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      showToast(`Perubahan "${updated.name}" disimpan.`);
    } catch (e) {
      console.error(e);
      showToast('Gagal memperbarui. Coba lagi.', 'error');
    }
  };

  // Handler: Hapus utang/piutang
  const handleDeleteDebt = async (id: string) => {
    const target = debts.find(d => d.id === id);
    try {
      await apiDeleteDebt(id);
      setDebts(prev => prev.filter(d => d.id !== id));
      showToast(
        `${target?.type === 'utang' ? 'Utang' : 'Piutang'} "${target?.name}" dihapus.`,
        'info'
      );
    } catch (e) {
      console.error(e);
      showToast('Gagal menghapus. Coba lagi.', 'error');
    }
  };

  // Handler: Tambah pembayaran/angsuran
  const handleAddDebtPayment = async (
    debtId: string,
    payment: Omit<DebtPayment, 'id' | 'debtId'>
  ) => {
    const newPayment: DebtPayment = {
      ...payment,
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(-4)}`,
      debtId,
    };
    try {
      await apiSaveDebtPayment(newPayment);
      setDebts(prev =>
        prev.map(d =>
          d.id === debtId ? { ...d, payments: [...d.payments, newPayment] } : d
        )
      );
      showToast(`Pembayaran ${formatRupiah(payment.amount)} berhasil dicatat!`);
    } catch (e) {
      console.error(e);
      showToast('Gagal menyimpan pembayaran. Coba lagi.', 'error');
    }
  };

  // Handler: Hapus pembayaran
  const handleDeleteDebtPayment = async (debtId: string, paymentId: string) => {
    try {
      await apiDeleteDebtPayment(paymentId);
      setDebts(prev =>
        prev.map(d => {
          if (d.id !== debtId) return d;
          return { ...d, payments: d.payments.filter(p => p.id !== paymentId) };
        })
      );
      showToast('Pembayaran dihapus.', 'info');
    } catch (e) {
      console.error(e);
      showToast('Gagal menghapus pembayaran. Coba lagi.', 'error');
    }
  };

  // 2. Neon Postgres Configuration
  const [neonConfig, setNeonConfig] = useState<NeonConfig>(() => getSavedNeonConfig());

  // 3. Filter State
  const [filter, setFilter] = useState<FilterState>({
    monthYear: 'ALL',
    accountId: 'ALL',
    type: 'ALL',
    category: 'ALL',
    kantong: 'ALL',
    searchQuery: '',
    dateFrom: '',
    dateTo: '',
  });

  // Handler: Add Account (Admin)
  const handleAddAccount = async (newAcc: { name: string; type: 'cash' | 'bank' | 'ewallet'; initialBalance?: number }) => {
    const slug = newAcc.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
    const id = `${slug || 'acc'}_${Date.now().toString(36).slice(-4)}`;
    const colorMap = { cash: 'emerald', bank: 'sky', ewallet: 'amber' };
    const iconMap = { cash: 'Wallet', bank: 'Landmark', ewallet: 'Smartphone' };
    const created: Account = {
      id,
      name: newAcc.name.trim(),
      type: newAcc.type,
      color: colorMap[newAcc.type] || 'slate',
      iconName: iconMap[newAcc.type] || 'Wallet',
      initialBalance: newAcc.initialBalance || 0,
    };
    try {
      await apiSaveAccount(created);
      setAccounts(prev => [...prev, created]);
      showToast(`Akun "${created.name}" berhasil ditambahkan!`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Gagal menyimpan akun. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  // Handler: Edit Account (Admin)
  const handleEditAccount = async (id: string, updated: { name: string; type: 'cash' | 'bank' | 'ewallet'; initialBalance?: number }) => {
    const existing = accounts.find(a => a.id === id);
    if (!existing) return;
    const merged: Account = {
      ...existing,
      name: updated.name.trim(),
      type: updated.type,
      initialBalance: updated.initialBalance !== undefined ? updated.initialBalance : existing.initialBalance,
    };
    try {
      await apiSaveAccount(merged);
      setAccounts(prev => prev.map(a => (a.id === id ? merged : a)));
      showToast(`Akun "${merged.name}" berhasil diperbarui!`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Gagal memperbarui akun. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  // Handler: Delete Account (Admin)
  const handleDeleteAccount = async (id: string) => {
    if (accounts.length <= 1) {
      showToast('Minimal harus ada 1 akun aktif di sistem.', 'error');
      return;
    }
    if (transactions.some(t => t.accountId === id || t.transferTargetAccountId === id)) {
      showToast('Akun tidak bisa dihapus karena masih punya transaksi.', 'error');
      return;
    }
    const acc = accounts.find(a => a.id === id);
    try {
      await apiDeleteAccount(id);
      setAccounts(prev => prev.filter(a => a.id !== id));
      showToast(`Akun "${acc?.name || id}" berhasil dihapus.`, 'info');
    } catch (e) {
      console.error(e);
      showToast('Gagal menghapus akun. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  // 4. Modal States
  const [isAutoRecordOpen, setIsAutoRecordOpen] = useState(false);
  const [isNeonModalOpen, setIsNeonModalOpen] = useState(false);
  const [isExportImportOpen, setIsExportImportOpen] = useState(false);

  // 5. Admin Authentication State
  const [isAdmin, setIsAdmin] = useState<boolean>(() => Boolean(getAdminToken()));
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  const handleLoginAdminSuccess = () => {
  setIsAdmin(true);
};

  const handleLogoutAdmin = () => {
  clearAdminToken();
  setIsAdmin(false);
};

  useEffect(() => {
    const onExpired = () => {
      setIsAdmin(false);
      setTimeout(() => showToast('Sesi admin berakhir. Masukkan PIN admin lagi.', 'error'), 100);
    };
    window.addEventListener('admin-session-expired', onExpired);
    return () => window.removeEventListener('admin-session-expired', onExpired);
  }, []);

  const handleOpenExportImport = () => {
    if (!isAdmin) {
      showToast('Masukkan PIN Admin untuk mengakses Ekspor & Impor data.', 'info');
      setIsAdminModalOpen(true);
      return;
    }
    setIsExportImportOpen(true);
  };

  const handleOpenNeonModal = () => {
    if (!isAdmin) {
      showToast('Masukkan PIN Admin untuk Pengaturan Database.', 'info');
      setIsAdminModalOpen(true);
      return;
    }
    setIsNeonModalOpen(true);
  };

  // 6. Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Muat semua data dari database
    const CACHE_KEY = 'dompet_cache_v1';

  // Muat semua data: tampilkan data tersimpan dulu, lalu segarkan dari database
  const loadAll = async () => {
    let hasCache = false;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (Array.isArray(c.accounts) && Array.isArray(c.transactions)) {
  setAccounts(c.accounts);
  setTransactions(c.transactions);
  setCategories(Array.isArray(c.categories) ? c.categories : []);
  if (Array.isArray(c.kantongList)) setKantongList(c.kantongList); // <--- Tambahkan ini
  if (c.storeName) setStoreName(c.storeName);
  if (c.ownerName) setOwnerName(c.ownerName);
  hasCache = true;
  setIsLoading(false);
}
      }
    } catch {
      /* cache rusak, abaikan */
    }

    if (!hasCache) setIsLoading(true);
    setLoadError(null);
    const slowTimer = setTimeout(() => setLoadSlow(true), 5000);
    try {
      const data = await apiLoadAll();

      let accs = data.accounts;
      if (accs.length === 0) {
        accs = INITIAL_ACCOUNTS;
        await Promise.all(accs.map(a => apiSaveAccount(a))).catch(() => {});
      }

      let cats = data.categories.filter(c => !isExcludedCategory(c));
      if (cats.length === 0) {
        cats = INITIAL_CATEGORIES.filter(c => !isExcludedCategory(c));
        await Promise.all(cats.map(c => apiAddCategory(c))).catch(() => {});
      }

     // Ganti data.kantongList menjadi data.kantongs
let kts = (data.kantongs || []).filter(k => !isExcludedCategory(k));
if (kts.length === 0) {
  kts = INITIAL_KANTONG ? INITIAL_KANTONG.filter(k => !isExcludedCategory(k)) : [];
}

      setAccounts(accs);
      setTransactions(data.transactions);
      setCategories(cats);
      setKantongList(kts);
      if (data.storeName && data.storeName.trim()) setStoreName(data.storeName.trim());
      if (data.ownerName && data.ownerName.trim()) setOwnerName(data.ownerName.trim());
      setIsLoading(false);

      // Utang-piutang dimuat di belakang, tidak menahan layar utama
      apiLoadDebts()
        .then(setDebts)
        .catch(err => console.warn('Gagal memuat utang-piutang:', err));
    } catch (e: any) {
  console.warn('Gagal memuat data dari database/server, fallback ke penyimpanan lokal:', e);
  setAccounts(INITIAL_ACCOUNTS);
  setTransactions(INITIAL_TRANSACTIONS);
  setCategories(INITIAL_CATEGORIES.filter(c => !isExcludedCategory(c)));
  // Tambahkan ini agar kantong tetap muncul saat offline:
  setKantongList(INITIAL_KANTONG ? INITIAL_KANTONG.filter(k => !isExcludedCategory(k)) : []);
  setLoadError(null);
}
  };

  // Simpan salinan terbaru agar pembukaan berikutnya langsung tampil
  useEffect(() => {
  if (isLoading || accounts.length === 0) return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ 
        accounts, 
        transactions, 
        categories, 
        kantongList, // <--- Tambahkan ini
        storeName, 
        ownerName 
      })
    );
  } catch {
    /* penyimpanan penuh, abaikan */
  }
}, [accounts, transactions, categories, kantongList, storeName, ownerName, isLoading]); // <--- Tambahkan kantongList di dependency array
  
  useEffect(() => {
    loadAll();
  }, []);

  // Month-Year dropdown options
  const monthOptions = useMemo(() => {
    return getMonthYearOptions(transactions);
  }, [transactions]);

  // Statistics calculation
  const stats: MonthlyStats = useMemo(() => {
    let totalMasuk = 0;
    let totalKeluar = 0;
    const categoryBreakdown: Record<string, number> = {};
    const dailyExpenses: Record<string, number> = {};

    transactions.forEach(t => {
      if (t.category === 'Pindah Saldo' || t.id.startsWith('kt-')) return;
      if (t.type === 'masuk') {
        totalMasuk += t.amount;
      } else {
        totalKeluar += t.amount;
        const cat = t.category || 'Lainnya';
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + t.amount;
        dailyExpenses[t.date] = (dailyExpenses[t.date] || 0) + t.amount;
      }
    });

    const sisaSaldo = totalMasuk - totalKeluar;
    const sisaPersen = totalMasuk > 0 ? (sisaSaldo / totalMasuk) * 100 : 0;

    const accountBalances: Record<string, number> = {};
    accounts.forEach(acc => {
      accountBalances[acc.id] = acc.initialBalance || 0;
    });

    transactions.forEach(t => {
      if (accountBalances[t.accountId] === undefined) {
        accountBalances[t.accountId] = 0;
      }
      if (t.type === 'masuk') {
        accountBalances[t.accountId] += t.amount;
      } else {
        accountBalances[t.accountId] -= t.amount;
      }
    });

    return {
      totalMasuk,
      totalKeluar,
      sisaSaldo,
      sisaPersen,
      transactionCount: transactions.length,
      categoryBreakdown,
      dailyExpenses,
      accountBalances,
    };
  }, [transactions, accounts]);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (filter.monthYear !== 'ALL' && !t.date.startsWith(filter.monthYear)) return false;
      if (filter.dateFrom && t.date < filter.dateFrom) return false;
      if (filter.dateTo && t.date > filter.dateTo) return false;
      if (filter.accountId !== 'ALL' && t.accountId !== filter.accountId) return false;
      if (filter.type !== 'ALL' && t.type !== filter.type) return false;
      if (filter.kantong && filter.kantong !== 'ALL') {
        if (filter.kantong === 'EMPTY') {
          if (t.kantong && t.kantong.trim() !== '' && t.kantong !== '-') return false;
        } else if (t.kantong !== filter.kantong) {
          return false;
        }
      }
      if (filter.category !== 'ALL') {
        if (filter.category === 'EMPTY') {
          if (t.category && t.category.trim() !== '' && t.category !== '-') return false;
        } else if (t.category !== filter.category) {
          return false;
        }
      }
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        if (
          !t.description.toLowerCase().includes(q) &&
          !t.category?.toLowerCase().includes(q) &&
          !t.kantong?.toLowerCase().includes(q) &&
          !t.notes?.toLowerCase().includes(q) &&
          !t.catatan?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [transactions, filter]);

  const getNextNo = () =>
    (transactions.length > 0 ? Math.max(...transactions.map(t => t.no || 0)) : 0) + 1;

  // Handler: Add new transactions (from Auto Record)
  const handleAddTransactions = async (newItems: Omit<Transaction, 'id'>[]): Promise<boolean> => {
    const startNo = getNextNo();
    const created: Transaction[] = newItems.map((item, idx) => ({
      ...item,
      id: `tx-${Date.now()}-${idx}`,
      no: startNo + idx,
      createdAt: new Date().toISOString(),
    }));

    try {
      await apiSaveTransactions(created);
      setTransactions(prev => [...created, ...prev]);
      showToast(`Berhasil menambahkan ${created.length} transaksi!`);
      return true;
    } catch (e) {
      console.error(e);
      showToast('Gagal menyimpan transaksi. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
  };

  // Handler: Save single transaction
  const handleSaveTransaction = async (txData: Omit<Transaction, 'id'>): Promise<boolean> => {
    const newTx: Transaction = {
      ...txData,
      id: `tx-${Date.now()}`,
      no: getNextNo(),
      createdAt: new Date().toISOString(),
    };
    try {
      await apiSaveTransaction(newTx);
      setTransactions(prev => [newTx, ...prev]);
      showToast(`Transaksi "${newTx.description}" (${formatRupiah(newTx.amount)}) berhasil disimpan!`);
      return true;
    } catch (e) {
      console.error(e);
      showToast('Gagal menyimpan transaksi. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
  };

  // Handler: Edit transaction
  const handleEditTransaction = async (updatedTx: Transaction) => {
    try {
      await apiSaveTransaction(updatedTx);
      setTransactions(prev => prev.map(t => (t.id === updatedTx.id ? updatedTx : t)));
      showToast(`Transaksi "${updatedTx.description}" berhasil diperbarui!`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Gagal memperbarui transaksi. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  // Handler: Pindah Saldo
  const handleTransfer = async (
    fromAccId: string,
    toAccId: string,
    amount: number,
    date: string,
    notes: string
  ): Promise<boolean> => {
    const fromName = accounts.find(a => a.id === fromAccId)?.name || fromAccId;
    const toName = accounts.find(a => a.id === toAccId)?.name || toAccId;

    const baseNo = getNextNo();
    const transferId = `tf-${Date.now()}`;

    const txKeluar: Transaction = {
      id: `${transferId}-out`,
      no: baseNo,
      date,
      description: notes ? `${notes} (${toName})` : 'Pindah',
      accountId: fromAccId,
      type: 'keluar',
      category: 'Pindah Saldo',
      amount,
      transferTargetAccountId: toAccId,
      createdAt: new Date().toISOString(),
    };

    const txMasuk: Transaction = {
      id: `${transferId}-in`,
      no: baseNo + 1,
      date,
      description: notes ? `${notes} (${fromName})` : 'Pindah',
      accountId: toAccId,
      type: 'masuk',
      category: 'Pindah Saldo',
      amount,
      createdAt: new Date().toISOString(),
    };

    try {
      await apiSaveTransactions([txMasuk, txKeluar]);
      setTransactions(prev => [txMasuk, txKeluar, ...prev]);
      showToast(`Pindah saldo ${formatRupiah(amount)} dari ${fromName} ke ${toName} berhasil!`);
      return true;
    } catch (e) {
      console.error(e);
      showToast('Gagal memindahkan saldo. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
  };

  // Handler: Pindah Kantong
  const handleTransferKantong = async (
    fromKt: string,
    toKt: string,
    accountId: string,
    amount: number,
    date: string,
    notes: string
  ): Promise<boolean> => {
    const baseNo = getNextNo();
    const stamp = Date.now();
    const outId = `kt-${stamp}-out`;
    const inId = `kt-${stamp}-in`;

    const txKeluar: Transaction = {
      id: outId,
      no: baseNo,
      date,
      description: notes ? `${notes} (untuk ${toKt})` : `Pindah jatah ke ${toKt}`,
      accountId,
      type: 'keluar',
      category: 'Pindah Kantong',
      kantong: fromKt,
      amount,
      linkedTransactionId: inId,
      createdAt: new Date().toISOString(),
    };

    const txMasuk: Transaction = {
      id: inId,
      no: baseNo + 1,
      date,
      description: notes ? `${notes} (dari ${fromKt})` : `Pindah jatah dari ${fromKt}`,
      accountId,
      type: 'masuk',
      category: 'Pindah Kantong',
      kantong: toKt,
      amount,
      linkedTransactionId: outId,
      createdAt: new Date().toISOString(),
    };

    try {
      await apiSaveTransactions([txMasuk, txKeluar]);
      setTransactions(prev => [txMasuk, txKeluar, ...prev]);
      showToast(`Pindah jatah kantong ${formatRupiah(amount)} dari "${fromKt}" ke "${toKt}" berhasil!`);
      return true;
    } catch (e) {
      console.error(e);
      showToast('Gagal memindahkan jatah kantong. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
  };

  // Handler: Pindah Kategori
  const handleTransferCategory = async (
    fromCat: string,
    toCat: string,
    accountId: string,
    amount: number,
    date: string,
    notes: string
  ): Promise<boolean> => {
    const baseNo = getNextNo();
    const stamp = Date.now();
    const outId = `kt-${stamp}-out`;
    const inId = `kt-${stamp}-in`;

    const txKeluar: Transaction = {
      id: outId,
      no: baseNo,
      date,
      description: notes ? `${notes} (untuk ${toCat})` : `Diambil untuk ${toCat}`,
      accountId,
      type: 'keluar',
      category: fromCat,
      amount,
      linkedTransactionId: inId,
      createdAt: new Date().toISOString(),
    };

    const txMasuk: Transaction = {
      id: inId,
      no: baseNo + 1,
      date,
      description: notes ? `${notes} (dari ${fromCat})` : `Ambil dari ${fromCat}`,
      accountId,
      type: 'masuk',
      category: toCat,
      amount,
      linkedTransactionId: outId,
      createdAt: new Date().toISOString(),
    };

    try {
      await apiSaveTransactions([txMasuk, txKeluar]);
      setTransactions(prev => [txMasuk, txKeluar, ...prev]);
      showToast(`Pindah kategori ${formatRupiah(amount)} dari ${fromCat} ke ${toCat} berhasil!`);
      return true;
    } catch (e) {
      console.error(e);
      showToast('Gagal memindahkan kategori. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
  };

  // Handler: Undo last
  const handleUndoLast = async () => {
    if (transactions.length === 0) return;
    const lastTx = transactions[0];

    const idsToRemove = [lastTx.id];
    if (lastTx.id.startsWith('kt-') && lastTx.linkedTransactionId) {
      idsToRemove.push(lastTx.linkedTransactionId);
    }
    if (lastTx.description.startsWith('Pindah') && transactions.length > 1) {
      const secondTx = transactions[1];
      if (secondTx.description.startsWith('Pindah') && secondTx.amount === lastTx.amount && secondTx.date === lastTx.date) {
        idsToRemove.push(secondTx.id);
      }
    }

    try {
      await Promise.all(idsToRemove.map(id => apiDeleteTransaction(id)));
      setTransactions(prev => prev.filter(t => !idsToRemove.includes(t.id)));
      showToast(`Transaksi terakhir "${lastTx.description}" (${formatRupiah(lastTx.amount)}) dibatalkan.`, 'info');
    } catch (e) {
      console.error(e);
      showToast('Gagal membatalkan transaksi. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  // Handler: Delete transaction
  const handleDeleteTransaction = async (id: string) => {
    const target = transactions.find(t => t.id === id);
    if (!confirm(`Hapus transaksi "${target?.description || ''}"?`)) return;

    const ids = [id];
    if (id.startsWith('kt-') && target?.linkedTransactionId) ids.push(target.linkedTransactionId);

    try {
      await Promise.all(ids.map(x => apiDeleteTransaction(x)));
      setTransactions(prev => prev.filter(t => !ids.includes(t.id)));
      showToast('Transaksi telah dihapus.', 'info');
    } catch (e) {
      console.error(e);
      showToast('Gagal menghapus transaksi. Periksa koneksi lalu coba lagi.', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-slate-100/90 flex items-center justify-center text-sm font-semibold text-slate-500">
        <div className="text-center space-y-1">
          <p>Memuat data...</p>
          {loadSlow && (
            <p className="text-xs font-normal text-slate-400">
              Server sedang bangun setelah lama tidak dipakai. Mohon tunggu sebentar.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-dvh bg-slate-100/90 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-semibold text-rose-700">Gagal memuat data dari database.</p>
        <p className="text-xs text-slate-500 break-words max-w-xs">{loadError}</p>
        <button
          type="button"
          onClick={loadAll}
          className="px-4 py-2 rounded-lg bg-[#1e3a5f] hover:bg-[#162c47] text-white text-xs font-bold cursor-pointer"
        >
          Coba Lagi
        </button>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-slate-100/90 text-slate-800 flex flex-col overflow-hidden antialiased selection:bg-emerald-600 selection:text-white">
      
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4">
          <div className={`px-4 py-2.5 rounded-xl shadow-lg border text-xs sm:text-sm font-semibold flex items-center gap-2 ${
            toast.type === 'error'
              ? 'bg-rose-900 text-rose-100 border-rose-700'
              : toast.type === 'info'
              ? 'bg-slate-800 text-slate-100 border-slate-700'
              : 'bg-emerald-800 text-emerald-100 border-emerald-600'
          }`}>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Main Content View (scrollable) */}
      <main className="flex-1 w-full max-w-md sm:max-w-lg md:max-w-xl mx-auto px-3 sm:px-4 py-5 sm:py-8 overflow-y-auto">
        {mainView === 'dompet' && (
          <DompetTokoView
            accounts={accounts}
            transactions={transactions}
            stats={stats}
            neonConfig={neonConfig}
            onAddTransaction={handleSaveTransaction}
            onTransfer={handleTransfer}
            onTransferKantong={handleTransferKantong}
            onTransferCategory={handleTransferCategory}
            onUndoLast={handleUndoLast}
            onDeleteTransaction={handleDeleteTransaction}
            onEditTransaction={handleEditTransaction}
            onOpenAutoRecord={() => setIsAutoRecordOpen(true)}
            onOpenNeonModal={handleOpenNeonModal}
            onOpenExportImport={handleOpenExportImport}
            categories={categories}
            onAddCategory={handleAddCategory}
            onDeleteCategory={handleDeleteCategory}
            kantongList={kantongList}
            onAddKantong={handleAddKantong}
            onDeleteKantong={handleDeleteKantong}
            filter={filter}
            onFilterChange={(newF) => setFilter(prev => ({ ...prev, ...newF }))}
            monthOptions={monthOptions}
            isAdmin={isAdmin}
            onOpenAdminModal={() => setIsAdminModalOpen(true)}
            onLogoutAdmin={handleLogoutAdmin}
            storeName={storeName}
          />
        )}

        {mainView === 'utang' && (
          <UtangPiutangView
            debts={debts}
            accounts={accounts}
            isAdmin={isAdmin}
            storeName={storeName}
            ownerName={ownerName}
            onAddDebt={handleAddDebt}
            onUpdateDebt={handleUpdateDebt}
            onDeleteDebt={handleDeleteDebt}
            onAddPayment={handleAddDebtPayment}
            onDeletePayment={handleDeleteDebtPayment}
          />
        )}

        {mainView === 'tahunan' && (
          <BukuTahunanView
            accounts={accounts}
            transactions={transactions}
            debts={debts}
            categories={categories}
            isAdmin={isAdmin}
            storeName={storeName}
            ownerName={ownerName}
            onOpenAdminModal={() => setIsAdminModalOpen(true)}
            onRefreshData={loadAll}
          />
        )}
      </main>

      {/* Bottom Navigation (fixed, always at bottom) */}
      <div
        className="flex-shrink-0 w-full bg-white border-t border-slate-200 shadow-lg z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="max-w-md sm:max-w-lg md:max-w-xl mx-auto grid grid-cols-3">
          <button
            type="button"
            onClick={() => setMainView('dompet')}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 transition cursor-pointer ${
              mainView === 'dompet'
                ? 'text-[#1e3a5f]'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Wallet className="w-5 h-5" />
            <span className="text-[10px] font-bold">Dompet</span>
            {mainView === 'dompet' && (
              <span className="absolute bottom-0 w-12 h-0.5 bg-[#1e3a5f] rounded-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMainView('utang')}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 transition cursor-pointer ${
              mainView === 'utang'
                ? 'text-[#1e3a5f]'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <CreditCard className="w-5 h-5" />
            <span className="text-[10px] font-bold">Utang & Piutang</span>
            {mainView === 'utang' && (
              <span className="absolute bottom-0 w-12 h-0.5 bg-[#1e3a5f] rounded-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMainView('tahunan')}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 transition cursor-pointer ${
              mainView === 'tahunan'
                ? 'text-[#1e3a5f]'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[10px] font-bold">Buku Tahunan</span>
            {mainView === 'tahunan' && (
              <span className="absolute bottom-0 w-12 h-0.5 bg-[#1e3a5f] rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* MODALS */}
      <AutoRecordModal
        isOpen={isAutoRecordOpen}
        onClose={() => setIsAutoRecordOpen(false)}
        onAddTransactions={handleAddTransactions}
        accounts={accounts}
        categories={categories}
      />

      <NeonVercelModal
        isOpen={isNeonModalOpen}
        onClose={() => setIsNeonModalOpen(false)}
        neonConfig={neonConfig}
        onUpdateNeonConfig={(cfg) => {
          setNeonConfig(cfg);
          saveNeonConfig(cfg);
          showToast('Pengaturan Neon Postgres disimpan!');
        }}
        accounts={accounts}
        transactions={transactions}
        onDataLoadedFromNeon={(loadedAccounts, loadedTransactions) => {
          setAccounts(loadedAccounts);
          setTransactions(loadedTransactions);
          showToast('Data berhasil dimuat dari Neon PostgreSQL!');
        }}
      />

      <ExportImportModal
        isOpen={isExportImportOpen}
        onClose={() => setIsExportImportOpen(false)}
        transactions={transactions}
        filteredTransactions={filteredTransactions}
        accounts={accounts}
        onImportTransactions={async (imported) => {
          try {
            await apiSaveTransactions(imported);
            setTransactions(prev => [...imported, ...prev]);
            showToast(`${imported.length} transaksi berhasil diimpor!`);
          } catch (e) {
            console.error(e);
            showToast('Gagal mengimpor transaksi ke database.', 'error');
          }
        }}
      />

      <AdminPinModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        isAdmin={isAdmin}
        onLoginSuccess={handleLoginAdminSuccess}
        onLogoutAdmin={handleLogoutAdmin}
        storeName={storeName}
        onUpdateStoreName={handleUpdateStoreName}
        ownerName={ownerName}
        onUpdateOwnerName={handleUpdateOwnerName}
        accounts={accounts}
        transactions={transactions}
        onAddAccount={handleAddAccount}
        onEditAccount={handleEditAccount}
        onDeleteAccount={handleDeleteAccount}
      />

    </div>
  );
}
