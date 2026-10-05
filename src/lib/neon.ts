import { neon } from '@neondatabase/serverless';
import { Transaction, Account } from '../types/finance.ts';

export const NEON_STORAGE_KEY = 'dompet_pintar_neon_config';
export const LOCAL_TX_KEY = 'dompet_pintar_transactions';
export const LOCAL_ACC_KEY = 'dompet_pintar_accounts';

export const getSavedNeonConfig = () => {
  try {
    const raw = localStorage.getItem(NEON_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse neon config', e);
  }
  return {
    connectionString: '',
    isConnected: false,
    autoSync: false,
  };
};

export const saveNeonConfig = (config: {
  connectionString: string;
  isConnected: boolean;
  autoSync: boolean;
  lastSyncedAt?: string;
}) => {
  localStorage.setItem(NEON_STORAGE_KEY, JSON.stringify(config));
};

export const testNeonConnection = async (connectionString: string): Promise<{ success: boolean; message: string; version?: string }> => {
  if (!connectionString || !connectionString.trim()) {
    return { success: false, message: 'URL Database Neon tidak boleh kosong.' };
  }

  try {
    const sql = neon(connectionString.trim());
    const result = await sql`SELECT version(), current_database() as db_name, now() as current_time;`;
    if (result && result.length > 0) {
      return {
        success: true,
        message: `Terhubung ke Neon Postgres database "${result[0].db_name}"!`,
        version: result[0].version,
      };
    }
    return { success: false, message: 'Tidak dapat mengambil respon dari server Neon.' };
  } catch (err: any) {
    console.error('Neon test connection error:', err);
    return {
      success: false,
      message: err.message || 'Gagal terhubung ke Neon PostgreSQL. Periksa URL koneksi dan parameter sslmode=require.',
    };
  }
};

export const initNeonTables = async (connectionString: string): Promise<{ success: boolean; message: string }> => {
  try {
    const sql = neon(connectionString.trim());
    
    // Create accounts table
    await sql`
      CREATE TABLE IF NOT EXISTS accounts (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) NOT NULL,
        color VARCHAR(20) DEFAULT '#0284c7',
        icon_name VARCHAR(50) DEFAULT 'Wallet',
        initial_balance BIGINT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Create transactions table
    await sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(64) PRIMARY KEY,
        no INTEGER,
        date DATE NOT NULL,
        description VARCHAR(255) NOT NULL,
        account_id VARCHAR(50) REFERENCES accounts(id) ON DELETE SET NULL,
        type VARCHAR(10) NOT NULL,
        category VARCHAR(50) NOT NULL,
        kantong VARCHAR(50),
        amount BIGINT NOT NULL,
        notes TEXT,
        transfer_target_account_id VARCHAR(50),
        linked_transaction_id VARCHAR(64),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Create categories, kantongs, settings tables
    await sql`
      CREATE TABLE IF NOT EXISTS categories (
        name VARCHAR(50) PRIMARY KEY,
        opening_balance BIGINT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS kantongs (
        name VARCHAR(50) PRIMARY KEY,
        opening_balance BIGINT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Ensure all columns exist on existing tables
    await sql`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS no INTEGER,
        ADD COLUMN IF NOT EXISTS account_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT '',
        ADD COLUMN IF NOT EXISTS kantong VARCHAR(50),
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS transfer_target_account_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS linked_transaction_id VARCHAR(64),
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `;
    await sql`
      ALTER TABLE categories
        ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `;
    await sql`
      ALTER TABLE kantongs
        ADD COLUMN IF NOT EXISTS opening_balance BIGINT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `;

    // Create index on date and account for fast monthly filtering
    await sql`
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id);
    `;

    return {
      success: true,
      message: 'Semua tabel ("accounts", "transactions", "categories", "kantongs", "settings") berhasil disiapkan di Neon PostgreSQL!',
    };
  } catch (err: any) {
    console.error('Neon init tables error:', err);
    return {
      success: false,
      message: err.message || 'Gagal membuat tabel di database Neon.',
    };
  }
};

export const syncAllToNeon = async (
  connectionString: string,
  accounts: Account[],
  transactions: Transaction[]
): Promise<{ success: boolean; count: number; message: string }> => {
  try {
    const sql = neon(connectionString.trim());

    // 1. Ensure tables exist
    await initNeonTables(connectionString);

    // 2. Upsert accounts
    for (const acc of accounts) {
      await sql`
        INSERT INTO accounts (id, name, type, color, icon_name, initial_balance)
        VALUES (${acc.id}, ${acc.name}, ${acc.type}, ${acc.color}, ${acc.iconName}, ${acc.initialBalance})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          color = EXCLUDED.color,
          icon_name = EXCLUDED.icon_name,
          initial_balance = EXCLUDED.initial_balance;
      `;
    }

    // 3. Upsert transactions
    let pushed = 0;
    for (const tx of transactions) {
      await sql`
        INSERT INTO transactions (
          id, no, date, description, account_id, type, category, kantong, amount, notes, transfer_target_account_id, linked_transaction_id, created_at
        ) VALUES (
          ${tx.id},
          ${tx.no ?? null},
          ${tx.date},
          ${tx.description},
          ${tx.accountId},
          ${tx.type},
          ${tx.category},
          ${tx.kantong ?? null},
          ${tx.amount},
          ${tx.notes ?? null},
          ${tx.transferTargetAccountId ?? null},
          ${tx.linkedTransactionId ?? null},
          ${tx.createdAt ? new Date(tx.createdAt).toISOString() : new Date().toISOString()}
        )
        ON CONFLICT (id) DO UPDATE SET
          no = EXCLUDED.no,
          date = EXCLUDED.date,
          description = EXCLUDED.description,
          account_id = EXCLUDED.account_id,
          type = EXCLUDED.type,
          category = EXCLUDED.category,
          kantong = EXCLUDED.kantong,
          amount = EXCLUDED.amount,
          notes = EXCLUDED.notes,
          transfer_target_account_id = EXCLUDED.transfer_target_account_id,
          linked_transaction_id = EXCLUDED.linked_transaction_id;
      `;
      pushed++;
    }

    return {
      success: true,
      count: pushed,
      message: `Berhasil sinkronisasi ${pushed} transaksi & ${accounts.length} dompet ke Neon PostgreSQL!`,
    };
  } catch (err: any) {
    console.error('Neon sync error:', err);
    return {
      success: false,
      count: 0,
      message: err.message || 'Gagal sinkronisasi data ke Neon PostgreSQL.',
    };
  }
};

export const fetchAllFromNeon = async (
  connectionString: string
): Promise<{ success: boolean; accounts?: Account[]; transactions?: Transaction[]; message: string }> => {
  try {
    const sql = neon(connectionString.trim());
    await initNeonTables(connectionString);

    // Fetch accounts
    const accRows = await sql`
      SELECT id, name, type, color, icon_name, initial_balance FROM accounts ORDER BY id ASC;
    `;

    // Fetch transactions
    const txRows = await sql`
      SELECT 
        id, 
        no, 
        to_char(date, 'YYYY-MM-DD') as date, 
        description, 
        account_id as "accountId", 
        type, 
        category, 
        kantong,
        amount, 
        notes, 
        transfer_target_account_id as "transferTargetAccountId", 
        linked_transaction_id as "linkedTransactionId", 
        created_at as "createdAt"
      FROM transactions 
      ORDER BY date DESC, no DESC NULLS LAST, id DESC;
    `;

    const accounts: Account[] = accRows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      color: r.color || '#0284c7',
      iconName: r.icon_name || 'Wallet',
      initialBalance: Number(r.initial_balance) || 0,
    }));

    const transactions: Transaction[] = txRows.map(r => ({
      id: r.id,
      no: r.no ? Number(r.no) : undefined,
      date: r.date,
      description: r.description,
      accountId: r.accountId,
      type: r.type,
      category: r.category,
      kantong: r.kantong || undefined,
      amount: Number(r.amount) || 0,
      notes: r.notes || undefined,
      transferTargetAccountId: r.transferTargetAccountId || undefined,
      linkedTransactionId: r.linkedTransactionId || undefined,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
    }));

    return {
      success: true,
      accounts,
      transactions,
      message: `Berhasil memuat ${transactions.length} transaksi dari Neon Postgres.`,
    };
  } catch (err: any) {
    console.error('Neon fetch error:', err);
    return {
      success: false,
      message: err.message || 'Gagal memuat data dari Neon PostgreSQL.',
    };
  }
};

// Persist single transaction (insert or update) to Neon directly or via Vercel /api/transactions
export const persistTransactionToDatabase = async (
  tx: Transaction,
  connectionString?: string
): Promise<void> => {
  // 1. Direct Neon driver
  if (connectionString && connectionString.trim()) {
    try {
      const sql = neon(connectionString.trim());
      await sql`
        INSERT INTO transactions (
          id, no, date, description, account_id, type, category, kantong, amount, notes, transfer_target_account_id, linked_transaction_id, created_at
        ) VALUES (
          ${tx.id},
          ${tx.no ?? null},
          ${tx.date},
          ${tx.description},
          ${tx.accountId},
          ${tx.type},
          ${tx.category},
          ${tx.kantong ?? null},
          ${tx.amount},
          ${tx.notes ?? null},
          ${tx.transferTargetAccountId ?? null},
          ${tx.linkedTransactionId ?? null},
          ${tx.createdAt ? new Date(tx.createdAt).toISOString() : new Date().toISOString()}
        )
        ON CONFLICT (id) DO UPDATE SET
          no = EXCLUDED.no,
          date = EXCLUDED.date,
          description = EXCLUDED.description,
          account_id = EXCLUDED.account_id,
          type = EXCLUDED.type,
          category = EXCLUDED.category,
          kantong = EXCLUDED.kantong,
          amount = EXCLUDED.amount,
          notes = EXCLUDED.notes,
          transfer_target_account_id = EXCLUDED.transfer_target_account_id,
          linked_transaction_id = EXCLUDED.linked_transaction_id;
      `;
      return;
    } catch (err) {
      console.warn('Direct Neon persist error, falling back to /api/transactions...', err);
    }
  }

  // 2. Vercel API fallback
  try {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx),
    });
  } catch (err) {
    console.warn('API persist error:', err);
  }
};

// Remove single transaction from Neon directly or via Vercel /api/transactions
export const removeTransactionFromDatabase = async (
  id: string,
  connectionString?: string
): Promise<void> => {
  // 1. Direct Neon driver
  if (connectionString && connectionString.trim()) {
    try {
      const sql = neon(connectionString.trim());
      await sql`DELETE FROM transactions WHERE id = ${id};`;
      return;
    } catch (err) {
      console.warn('Direct Neon delete error, falling back to /api/transactions...', err);
    }
  }

  // 2. Vercel API fallback
  try {
    await fetch(`/api/transactions?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn('API delete error:', err);
  }
};

// Simpan 1 akun (insert / update) ke Neon langsung atau lewat /api/transactions
export const persistAccountToDatabase = async (
  acc: Account,
  connectionString?: string
): Promise<void> => {
  // 1. Direct Neon driver
  if (connectionString && connectionString.trim()) {
    try {
      const sql = neon(connectionString.trim());
      await sql`
        INSERT INTO accounts (id, name, type, color, icon_name, initial_balance)
        VALUES (${acc.id}, ${acc.name}, ${acc.type}, ${acc.color || '#0284c7'}, ${acc.iconName || 'Wallet'}, ${acc.initialBalance || 0})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          color = EXCLUDED.color,
          icon_name = EXCLUDED.icon_name,
          initial_balance = EXCLUDED.initial_balance;
      `;
      return;
    } catch (err) {
      console.warn('Direct Neon account persist error, falling back to /api/transactions...', err);
    }
  }

  // 2. Vercel API fallback
  try {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: 'account', account: acc }),
    });
  } catch (err) {
    console.warn('API account persist error:', err);
  }
};

// Hapus 1 akun dari Neon langsung atau lewat /api/transactions
export const removeAccountFromDatabase = async (
  id: string,
  connectionString?: string
): Promise<void> => {
  // 1. Direct Neon driver
  if (connectionString && connectionString.trim()) {
    try {
      const sql = neon(connectionString.trim());
      await sql`DELETE FROM accounts WHERE id = ${id};`;
      return;
    } catch (err) {
      console.warn('Direct Neon account delete error, falling back to /api/transactions...', err);
    }
  }

  // 2. Vercel API fallback
  try {
    await fetch(`/api/transactions?entity=account&id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn('API account delete error:', err);
  }
};


// Pastikan tabel settings ada (aman dipanggil berulang)
const ensureSettingsTable = async (sql: any) => {
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(50) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
};

// Simpan 1 pengaturan (mis. nama toko) ke Neon langsung atau lewat /api/transactions
export const persistSettingToDatabase = async (
  key: string,
  value: string,
  connectionString?: string
): Promise<void> => {
  // 1. Direct Neon driver
  if (connectionString && connectionString.trim()) {
    try {
      const sql = neon(connectionString.trim());
      await ensureSettingsTable(sql);
      await sql`
        INSERT INTO settings (key, value, updated_at)
        VALUES (${key}, ${value}, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = CURRENT_TIMESTAMP;
      `;
      return;
    } catch (err) {
      console.warn('Direct Neon setting persist error, falling back to /api/transactions...', err);
    }
  }

  // 2. Vercel API fallback
  try {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: 'setting', key, value }),
    });
  } catch (err) {
    console.warn('API setting persist error:', err);
  }
};

// Ambil 1 pengaturan dari database. Mengembalikan null jika belum ada / gagal.
export const fetchSettingFromDatabase = async (
  key: string,
  connectionString?: string
): Promise<string | null> => {
  // 1. Direct Neon driver
  if (connectionString && connectionString.trim()) {
    try {
      const sql = neon(connectionString.trim());
      await ensureSettingsTable(sql);
      const rows = await sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1;`;
      return rows.length > 0 ? (rows[0].value as string) : null;
    } catch (err) {
      console.warn('Direct Neon setting fetch error, falling back to /api/transactions...', err);
    }
  }

  // 2. Vercel API fallback
  try {
    const resp = await fetch(`/api/transactions?entity=setting&key=${encodeURIComponent(key)}`);
    if (resp.ok) {
      const json = await resp.json();
      if (json.success && typeof json.value === 'string') return json.value;
    }
  } catch (err) {
    console.warn('API setting fetch error:', err);
  }
  return null;
};