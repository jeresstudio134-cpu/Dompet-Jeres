import React, { useState, useEffect } from 'react';
import { 
  X, 
  Lock, 
  Unlock, 
  ShieldCheck, 
  KeyRound, 
  Eye, 
  EyeOff, 
  Check, 
  AlertTriangle,
  Wallet,
  Plus,
  Trash2,
  Edit2,
  ArrowLeft,
  Landmark,
  Banknote,
  Smartphone,
  Store,
  User
} from 'lucide-react';
import { Account, Transaction } from '../types/finance.ts';
import { parseRupiahInput, formatRupiah } from '../utils/formatters.ts';
import { apiLogin, apiChangePin, apiPinLength } from '../lib/api.ts';

export const ADMIN_PIN_KEY = 'dompet_toko_admin_pin';
export const DEFAULT_ADMIN_PIN = '1234';

export const getSavedAdminPin = (): string => {
  try {
    const saved = localStorage.getItem(ADMIN_PIN_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch (e) {
    console.error('Failed reading admin PIN from storage:', e);
  }
  return DEFAULT_ADMIN_PIN;
};

export const saveAdminPin = (newPin: string): void => {
  try {
    localStorage.setItem(ADMIN_PIN_KEY, newPin.trim());
  } catch (e) {
    console.error('Failed saving admin PIN:', e);
  }
};

interface AdminPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onLoginSuccess: () => void;
  onLogoutAdmin: () => void;
  accounts: Account[];
  transactions: Transaction[];
  onAddAccount: (acc: { name: string; type: 'cash' | 'bank' | 'ewallet'; initialBalance?: number }) => void;
  onEditAccount: (id: string, updated: { name: string; type: 'cash' | 'bank' | 'ewallet'; initialBalance?: number }) => void;
  onDeleteAccount: (id: string) => void;
  storeName?: string;
  onUpdateStoreName?: (name: string) => Promise<boolean> | void;
  ownerName?: string;
  onUpdateOwnerName?: (name: string) => Promise<boolean>;
}

export const AdminPinModal: React.FC<AdminPinModalProps> = ({
  isOpen,
  onClose,
  isAdmin,
  onLoginSuccess,
  onLogoutAdmin,
  accounts,
  transactions,
  onAddAccount,
  onEditAccount,
  onDeleteAccount,
  storeName,
  onUpdateStoreName,
  ownerName,
  onUpdateOwnerName,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [pinLength, setPinLength] = useState<number | null>(null);

  // Mode: 'login' | 'menu' | 'change_pin' | 'manage_accounts' | 'change_store_name'
  const [activeView, setActiveView] = useState<'login' | 'menu' | 'change_pin' | 'manage_accounts' | 'change_store_name'>('menu');
  
  // State for changing store name & owner name
  const [storeNameInput, setStoreNameInput] = useState(storeName || 'Dompet Keuangan');
  const [ownerNameInput, setOwnerNameInput] = useState(ownerName || 'Mohammad Miftah');

  useEffect(() => {
    if (storeName) setStoreNameInput(storeName);
  }, [storeName]);

  useEffect(() => {
    if (ownerName) setOwnerNameInput(ownerName);
  }, [ownerName]);

  // State for changing PIN
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmNewPinInput, setConfirmNewPinInput] = useState('');

  // State for managing accounts
  const [isEditingAccountId, setIsEditingAccountId] = useState<string | null>(null);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [accountNameInput, setAccountNameInput] = useState('');
  const [accountTypeInput, setAccountTypeInput] = useState<'cash' | 'bank' | 'ewallet'>('bank');
  const [accountInitialBalance, setAccountInitialBalance] = useState<string>('0');
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

    // Ambil panjang PIN dari server saat layar PIN dibuka
  useEffect(() => {
    if (!isOpen || isAdmin) return;
    let active = true;
    apiPinLength()
      .then(len => {
        if (active) setPinLength(len);
      })
      .catch(() => {
        if (active) setPinLength(null);
      });
    return () => {
      active = false;
    };
  }, [isOpen, isAdmin]);

  // Login otomatis saat jumlah digit sama dengan panjang PIN
  useEffect(() => {
    if (!isOpen || isAdmin || isVerifying || !pinLength) return;
    if (pinInput.length === pinLength) {
      verifyPin(pinInput);
    }
  }, [pinInput, pinLength]);

  if (!isOpen) return null;

   const verifyPin = async (pin: string) => {
    setErrorMessage('');
    setIsVerifying(true);
    try {
      await apiLogin(pin.trim());
      setPinInput('');
      onLoginSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memeriksa PIN. Periksa koneksi lalu coba lagi.');
      setPinInput(''); // kosongkan supaya bisa mengetik ulang
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    verifyPin(pinInput);
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!/^\d{4,8}$/.test(newPinInput)) {
      setErrorMessage('PIN baru harus 4-8 digit angka.');
      return;
    }

    if (newPinInput !== confirmNewPinInput) {
      setErrorMessage('Konfirmasi PIN baru tidak cocok.');
      return;
    }

    try {
      await apiChangePin(currentPinInput.trim(), newPinInput.trim());
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal mengganti PIN. Periksa koneksi lalu coba lagi.');
      return;
    }

    setSuccessMessage('PIN Admin berhasil diperbarui!');
    setCurrentPinInput('');
    setNewPinInput('');
    setConfirmNewPinInput('');
    setTimeout(() => {
      setSuccessMessage('');
      setActiveView('menu');
    }, 1500);
  };

  const handleKeypadPress = (val: string) => {
    setErrorMessage('');
    if (val === 'backspace') {
      setPinInput(prev => prev.slice(0, -1));
    } else if (val === 'clear') {
      setPinInput('');
    } else if (isVerifying) {
      return;
    } else if (pinInput.length < (pinLength ?? 8)) {
      setPinInput(prev => prev + val);
    }
  };

  // Account Form Handlers
  const handleSaveAccountForm = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!accountNameInput.trim()) {
      setErrorMessage('Nama akun tidak boleh kosong.');
      return;
    }

    const initBal = parseRupiahInput(accountInitialBalance);

    if (isEditingAccountId) {
      onEditAccount(isEditingAccountId, {
        name: accountNameInput.trim(),
        type: accountTypeInput,
        initialBalance: initBal,
      });
      setIsEditingAccountId(null);
    } else {
      onAddAccount({
        name: accountNameInput.trim(),
        type: accountTypeInput,
        initialBalance: initBal,
      });
      setIsAddingAccount(false);
    }
    setAccountNameInput('');
    setAccountInitialBalance('0');
  };

  const handleStartEditAccount = (acc: Account) => {
    setIsEditingAccountId(acc.id);
    setIsAddingAccount(false);
    setAccountNameInput(acc.name);
    setAccountTypeInput(acc.type);
    setAccountInitialBalance(String(acc.initialBalance || 0));
    setErrorMessage('');
  };

  const handleConfirmDeleteAccount = (id: string) => {
    if (accounts.length <= 1) {
      setErrorMessage('Minimal harus ada 1 akun aktif dalam sistem toko.');
      setDeletingAccountId(null);
      return;
    }
    onDeleteAccount(id);
    setDeletingAccountId(null);
  };

  const getAccountIcon = (type: 'cash' | 'bank' | 'ewallet') => {
    switch (type) {
      case 'cash':
        return <Banknote className="w-4 h-4 text-emerald-600" />;
      case 'bank':
        return <Landmark className="w-4 h-4 text-sky-600" />;
      case 'ewallet':
        return <Smartphone className="w-4 h-4 text-amber-600" />;
    }
  };

  const getAccountTypeLabel = (type: 'cash' | 'bank' | 'ewallet') => {
    switch (type) {
      case 'cash':
        return 'Tunai (Cash)';
      case 'bank':
        return 'Rekening Bank';
      case 'ewallet':
        return 'E-Wallet';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              isAdmin ? 'bg-amber-100 text-amber-800' : 'bg-[#1e3a5f]/10 text-[#1e3a5f]'
            }`}>
              {isAdmin ? <ShieldCheck className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="font-extrabold text-slate-800 text-sm">
                {isAdmin ? 'Pengaturan Akses Admin' : 'Buka Kunci Akses Admin'}
              </h3>
              <p className="text-[10px] text-slate-500">
                {isAdmin ? 'Mode Admin sedang aktif' : 'Khusus Pemilik Toko / Owner'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setPinInput('');
              setErrorMessage('');
              setIsAddingAccount(false);
              setIsEditingAccountId(null);
              setDeletingAccountId(null);
              onClose();
            }}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[80vh] overflow-y-auto">

          {isAdmin ? (
            /* ADMIN VIEW */
            <div className="space-y-4">
              
              {/* VIEW 1: MANAGE ACCOUNTS */}
              {activeView === 'manage_accounts' ? (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('menu');
                        setIsAddingAccount(false);
                        setIsEditingAccountId(null);
                        setDeletingAccountId(null);
                        setErrorMessage('');
                      }}
                      className="text-xs font-bold text-[#1e3a5f] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Kembali ke Menu Admin</span>
                    </button>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Total {accounts.length} Akun
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-extrabold text-slate-800">
                        Kelola Akun & Dompet Toko
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Tambah akun bank baru, ubah nama, atau hapus akun
                      </p>
                    </div>

                    {!isAddingAccount && !isEditingAccountId && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingAccount(true);
                          setIsEditingAccountId(null);
                          setAccountNameInput('');
                          setAccountTypeInput('bank');
                          setAccountInitialBalance('0');
                          setErrorMessage('');
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-[#1e3a5f] hover:bg-[#152942] text-white font-bold text-xs flex items-center gap-1 transition shadow-2xs cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tambah Akun</span>
                      </button>
                    )}
                  </div>

                  {errorMessage && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {/* Add / Edit Form */}
                  {(isAddingAccount || isEditingAccountId) && (
                    <form onSubmit={handleSaveAccountForm} className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3 animate-in fade-in">
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        {isEditingAccountId ? <Edit2 className="w-3.5 h-3.5 text-[#1e3a5f]" /> : <Plus className="w-3.5 h-3.5 text-emerald-600" />}
                        <span>{isEditingAccountId ? 'Ubah Nama / Tipe Akun' : 'Tambah Akun / Dompet Baru'}</span>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Nama Akun / Dompet:
                        </label>
                        <input
                          type="text"
                          value={accountNameInput}
                          onChange={(e) => setAccountNameInput(e.target.value)}
                          placeholder="Contoh: BCA Toko, BRI, GoPay, Kas Laci 2"
                          className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                          autoFocus
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Tipe Akun:
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(['cash', 'bank', 'ewallet'] as const).map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setAccountTypeInput(t)}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition ${
                                accountTypeInput === t
                                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                            >
                              {t === 'cash' ? '💵 Tunai' : t === 'bank' ? '🏦 Bank' : '📱 E-Wallet'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Saldo Awal (Rp):
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={accountInitialBalance}
                          onChange={(e) => setAccountInitialBalance(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="0"
                          className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] font-mono"
                        />
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Saldo awal saat toko pertama kali mulai (isi 0 jika saldo dihitung murni dari transaksi).
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="submit"
                          className="flex-1 py-2 rounded-xl bg-[#1b7a4b] hover:bg-[#156a40] text-white font-bold text-xs transition cursor-pointer shadow-xs"
                        >
                          {isEditingAccountId ? 'Simpan Perubahan' : 'Tambah Akun'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingAccount(false);
                            setIsEditingAccountId(null);
                            setAccountNameInput('');
                            setAccountInitialBalance('0');
                            setErrorMessage('');
                          }}
                          className="py-2 px-3 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs transition cursor-pointer"
                        >
                          Batal
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Account List */}
                  <div className="space-y-2">
                    {accounts.map(acc => {
                      const txCount = transactions.filter(t => t.accountId === acc.id).length;
                      const isConfirmingDelete = deletingAccountId === acc.id;

                      return (
                        <div
                          key={acc.id}
                          className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                                {getAccountIcon(acc.type)}
                              </div>
                              <div>
                                <h5 className="text-xs font-bold text-slate-800 leading-tight">
                                  {acc.name}
                                </h5>
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5">
                                  <span>{getAccountTypeLabel(acc.type)}</span>
                                  <span>•</span>
                                  <span>{txCount} transaksi</span>
                                  {acc.initialBalance > 0 && (
                                    <>
                                      <span>•</span>
                                      <span className="text-emerald-700 font-medium">Awal: {formatRupiah(acc.initialBalance)}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEditAccount(acc)}
                                title="Ubah Akun"
                                className="p-1.5 text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100 rounded-lg transition cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeletingAccountId(acc.id);
                                  setErrorMessage('');
                                }}
                                title="Hapus Akun"
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Delete Confirmation Warning inside card */}
                          {isConfirmingDelete && (
                            <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200 space-y-1.5 animate-in fade-in">
                              <div className="text-[11px] font-bold text-rose-800 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Hapus akun "{acc.name}"?</span>
                              </div>
                              <p className="text-[10px] text-rose-700">
                                {txCount > 0 
                                  ? `Perhatian: Ada ${txCount} riwayat transaksi yang menggunakan akun ini.` 
                                  : 'Akun ini belum memiliki transaksi dan aman untuk dihapus.'}
                              </p>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmDeleteAccount(acc.id)}
                                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition cursor-pointer"
                                >
                                  Ya, Hapus
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingAccountId(null)}
                                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold text-[11px] hover:bg-slate-50 transition cursor-pointer"
                                >
                                  Batal
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              ) : activeView === 'change_pin' ? (
                /* VIEW 2: CHANGE PIN */
                <form onSubmit={handleChangePin} className="space-y-3 pt-1">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('menu');
                        setErrorMessage('');
                      }}
                      className="text-xs font-bold text-[#1e3a5f] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Kembali ke Menu Admin</span>
                    </button>
                  </div>

                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                    <span>Ubah PIN Keamanan Admin</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      PIN Lama:
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={currentPinInput}
                      onChange={(e) => setCurrentPinInput(e.target.value)}
                      placeholder="Masukkan PIN saat ini"
                      className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      PIN Baru (min. 4 angka):
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value)}
                      placeholder="PIN baru (mis. 5678)"
                      className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Konfirmasi PIN Baru:
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={confirmNewPinInput}
                      onChange={(e) => setConfirmNewPinInput(e.target.value)}
                      placeholder="Ulangi PIN baru"
                      className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                      required
                    />
                  </div>

                  {errorMessage && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {successMessage && (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>{successMessage}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-xl bg-[#1e3a5f] hover:bg-[#152942] text-white font-bold text-xs transition cursor-pointer"
                    >
                      Simpan PIN Baru
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('menu');
                        setErrorMessage('');
                      }}
                      className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs transition cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              ) : activeView === 'change_store_name' ? (
                /* VIEW: CHANGE STORE & OWNER NAME */
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setErrorMessage('');
                    const trimmedStore = storeNameInput.trim();
                    const trimmedOwner = ownerNameInput.trim();

                    if (!trimmedStore) {
                      setErrorMessage('Nama toko tidak boleh kosong.');
                      return;
                    }
                    if (!trimmedOwner) {
                      setErrorMessage('Nama pemilik tidak boleh kosong.');
                      return;
                    }

                    const currentStore = (storeName || '').trim();
                    const currentOwner = (ownerName || '').trim();
                    const storeChanged = trimmedStore !== currentStore;
                    const ownerChanged = trimmedOwner !== currentOwner;

                    // Jika tidak ada perubahan, langsung kembali ke menu
                    if (!storeChanged && !ownerChanged) {
                      setActiveView('menu');
                      return;
                    }

                    let okStore = true;
                    let okOwner = true;

                    if (storeChanged && onUpdateStoreName) {
                      const res = await onUpdateStoreName(trimmedStore);
                      if (res === false) okStore = false;
                    }

                    if (ownerChanged && onUpdateOwnerName) {
                      const res = await onUpdateOwnerName(trimmedOwner);
                      if (res === false) okOwner = false;
                    }

                    if (!okStore || !okOwner) {
                      setErrorMessage('Gagal menyimpan perubahan. Pastikan mode admin masih aktif dan koneksi baik.');
                      return;
                    }

                    setSuccessMessage('Nama toko & pemilik berhasil diperbarui!');
                    setTimeout(() => {
                      setActiveView('menu');
                      setSuccessMessage('');
                    }, 1000);
                  }} 
                  className="space-y-3 pt-1"
                >
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('menu');
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
                      className="text-xs font-bold text-[#1e3a5f] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Kembali ke Menu Admin</span>
                    </button>
                  </div>

                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-blue-600" />
                    <span>Ubah Nama Toko & Pemilik</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Nama Toko:
                    </label>
                    <input
                      type="text"
                      value={storeNameInput}
                      onChange={(e) => setStoreNameInput(e.target.value)}
                      placeholder="Contoh: Toko Berkah, Toko Makmur, dll."
                      className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                      autoFocus
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Ditampilkan pada judul utama dan kop laporan.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Nama Pemilik:
                    </label>
                    <input
                      type="text"
                      value={ownerNameInput}
                      onChange={(e) => setOwnerNameInput(e.target.value)}
                      placeholder="Contoh: Mohammad Miftah"
                      className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Ditampilkan pada bagian tanda tangan laporan.
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {successMessage && (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>{successMessage}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-xl bg-[#1e3a5f] hover:bg-[#152942] text-white font-bold text-xs transition cursor-pointer"
                    >
                      Simpan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('menu');
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
                      className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs transition cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              ) : (
                /* VIEW 3: MAIN ADMIN MENU */
                <div className="space-y-4">
                  <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-start gap-2.5">
                    <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                    <div className="text-xs text-emerald-900">
                      <p className="font-bold">Mode Admin Sedang Aktif</p>
                      <p className="text-[11px] text-emerald-800 mt-0.5">
                        Anda memiliki akses penuh untuk kelola akun, hapus/edit transaksi, kelola kategori, dan backup data.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-1">
                    {/* 1. Kelola Akun & Dompet */}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('manage_accounts');
                        setErrorMessage('');
                      }}
                      className="w-full p-3 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center justify-between border border-slate-200 shadow-2xs hover:border-[#1e3a5f]/40 transition group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f] flex items-center justify-center group-hover:scale-105 transition">
                          <Wallet className="w-4 h-4" />
                        </div>
                        <div className="text-left">
                          <h4 className="font-bold text-slate-800 text-xs">Kelola Akun & Dompet Toko</h4>
                          <p className="text-[10px] text-slate-500">Tambah akun bank baru, edit nama, atau hapus akun</p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {accounts.length} Akun
                      </span>
                    </button>

                    {/* 2. Ubah Nama Toko & Pemilik */}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('change_store_name');
                        setStoreNameInput(storeName || 'Dompet Keuangan');
                        setOwnerNameInput(ownerName || 'Mohammad Miftah');
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
                      className="w-full p-3 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center justify-between border border-slate-200 shadow-2xs hover:border-[#1e3a5f]/40 transition group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center group-hover:scale-105 transition">
                          <Store className="w-4 h-4" />
                        </div>
                        <div className="text-left">
                          <h4 className="font-bold text-slate-800 text-xs">Ubah Nama Toko & Pemilik</h4>
                          <p className="text-[10px] text-slate-500">Nama toko dan nama pemilik pada judul dan laporan</p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 max-w-[120px] truncate">
                        {storeName || 'Dompet Keuangan'}
                      </span>
                    </button>

                    {/* 3. Ubah PIN */}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('change_pin');
                        setErrorMessage('');
                      }}
                      className="w-full p-3 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center gap-2.5 border border-slate-200 shadow-2xs hover:border-[#1e3a5f]/40 transition group cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center group-hover:scale-105 transition">
                        <KeyRound className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <h4 className="font-bold text-slate-800 text-xs">Ganti PIN Keamanan Admin</h4>
                        <p className="text-[10px] text-slate-500">Ubah kombinasi PIN rahasia pemilik toko</p>
                      </div>
                    </button>

                    {/* 3. Kunci / Logout Admin */}
                    <button
                      type="button"
                      onClick={() => {
                        onLogoutAdmin();
                        onClose();
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs mt-2"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Kunci & Kembali ke Mode Kasir</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* PIN Input Form to Unlock Admin */
            <form onSubmit={handleVerifyPin} className="space-y-3.5">
              <div className="text-center space-y-1">
                <p className="text-xs text-slate-600">
                  Masukkan PIN Owner untuk mengakses pengaturan akun toko dan fitur admin.
                </p>
                
              </div>

              {/* PIN Display Input */}
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder={pinLength ? `Ketik ${pinLength} digit PIN...` : 'Ketik PIN...'}
                  autoFocus
                  maxLength={pinLength ?? 8}
                  className="w-full bg-slate-50 text-slate-900 text-center text-lg tracking-widest font-mono font-bold rounded-2xl py-2.5 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:bg-white transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                  title={showPin ? 'Sembunyikan' : 'Lihat'}
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Numeric keypad for convenient touch in mobile */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(btn => (
                  <button
                    key={btn}
                    type="button"
                    onClick={() => {
                      if (btn === 'C') handleKeypadPress('clear');
                      else if (btn === '⌫') handleKeypadPress('backspace');
                      else handleKeypadPress(btn);
                    }}
                    className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 font-bold text-sm transition select-none cursor-pointer"
                  >
                    {btn}
                  </button>
                ))}
              </div>

              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={pinInput.length === 0 || isVerifying}
                className="w-full py-2.5 rounded-xl bg-[#1e3a5f] hover:bg-[#152942] disabled:opacity-50 text-white font-bold text-xs tracking-wide transition shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Buka Kunci Admin</span>
              </button>
            </form>
          )}

        </div>

      </div>
    </div>
  );
};
