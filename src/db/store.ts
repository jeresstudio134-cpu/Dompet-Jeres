// src/db/store.ts
import fs from 'fs';
import path from 'path';
import type { Account, Transaction, Debt, DebtPayment, YearlyArchive } from '../types/finance.ts';
import { INITIAL_ACCOUNTS, INITIAL_CATEGORIES, INITIAL_TRANSACTIONS } from '../data/initialData.ts';

export interface LocalDatabaseSchema {
  accounts: Account[];
  transactions: Transaction[];
  categories: { name: string; openingBalance: number; createdAt: string }[];
  settings: Record<string, string>;
  debts: Debt[];
  debtPayments: DebtPayment[];
  yearlyArchives: YearlyArchive[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'dompet_db.json');

let cache: LocalDatabaseSchema | null = null;

function getDefaultData(): LocalDatabaseSchema {
  return {
    accounts: JSON.parse(JSON.stringify(INITIAL_ACCOUNTS)),
    transactions: JSON.parse(JSON.stringify(INITIAL_TRANSACTIONS)),
    categories: INITIAL_CATEGORIES.map(name => ({
      name,
      openingBalance: 0,
      createdAt: new Date().toISOString(),
    })),
    settings: {
      store_name: 'JERES STUDIO',
      admin_pin_len: '4',
    },
    debts: [],
    debtPayments: [],
    yearlyArchives: [],
  };
}

export function loadLocalData(): LocalDatabaseSchema {
  if (cache) return cache;

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        cache = {
          accounts: Array.isArray(parsed.accounts) && parsed.accounts.length > 0 ? parsed.accounts : getDefaultData().accounts,
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : getDefaultData().transactions,
          categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : getDefaultData().categories,
          settings: typeof parsed.settings === 'object' && parsed.settings ? parsed.settings : getDefaultData().settings,
          debts: Array.isArray(parsed.debts) ? parsed.debts : [],
          debtPayments: Array.isArray(parsed.debtPayments) ? parsed.debtPayments : [],
          yearlyArchives: Array.isArray(parsed.yearlyArchives) ? parsed.yearlyArchives : [],
        };
        return cache;
      }
    }
  } catch (err) {
    console.warn('Gagal membaca data/dompet_db.json, menggunakan data awal:', err);
  }

  cache = getDefaultData();
  saveLocalData(cache);
  return cache;
}

export function saveLocalData(data: LocalDatabaseSchema): void {
  try {
    cache = data;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Gagal menyimpan data/dompet_db.json:', err);
  }
}
