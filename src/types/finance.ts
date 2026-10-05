export type TransactionType = 'masuk' | 'keluar';

export type DefaultCategory = 
  | 'Pribadi'
  | 'Pokok'
  | 'Kendaraan'
  | 'Bangun Rumah'
  | 'Operasional'
  | 'Pemasukan Toko'
  | 'Pindah Saldo'
  | 'Lainnya';

export interface Account {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'ewallet';
  color: string;
  iconName: string;
  initialBalance: number;
}

export interface Transaction {
  id: string;
  no?: number;
  date: string; // YYYY-MM-DD
  description: string;
  accountId: string;
  type: TransactionType;
  category: string; // Kategori (mis. Makanan, Bensin, Operasional)
  kantong?: string; // Kantong (mis. Toko, Pribadi, Pokok, dll.)
  amount: number;
  notes?: string;
  catatan?: string;
  transferTargetAccountId?: string;
  linkedTransactionId?: string;
  createdAt?: string;
}

export interface FilterState {
  monthYear: string; // '2026-07' or 'ALL'
  accountId: string; // 'ALL' or account id
  type: 'ALL' | TransactionType;
  category: string; // 'ALL' or category name
  kantong: string; // 'ALL' or kantong name
  searchQuery: string;
  dateFrom: string;
  dateTo: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface MonthlyStats {
  totalMasuk: number;
  totalKeluar: number;
  sisaSaldo: number;
  sisaPersen: number;
  transactionCount: number;
  categoryBreakdown: { [category: string]: number };
  dailyExpenses: { [day: string]: number };
  accountBalances: { [accountId: string]: number };
}

export interface NeonConfig {
  connectionString: string;
  isConnected: boolean;
  lastSyncedAt?: string;
  autoSync: boolean;
}

// ============================================
// UTANG & PIUTANG
// ============================================

export type DebtType = 'utang' | 'piutang';
export type DebtStatus = 'aktif' | 'lunas';

export interface DebtPayment {
  id: string;
  debtId: string;
  date: string;
  amount: number;
  accountId?: string;
  notes?: string;
}

export interface Debt {
  id: string;
  type: DebtType;
  name: string;
  counterparty: string;
  totalAmount: number;
  startDate: string;
  dueDate?: string;
  installmentAmount?: number;
  installmentPeriod?: number;
  notes?: string;
  createdAt: string;
  payments: DebtPayment[];
  archivedAt?: string;
}

export interface YearlyArchive {
  id: string;
  year: number;
  transactionCount: number;
  createdAt: string;
  data: {
    transactions: Transaction[];
    accounts: Account[];
    categories: string[];
    debts: Debt[];
    summary: {
      totalMasuk: number;
      totalKeluar: number;
      sisa: number;
    };
  };
}
