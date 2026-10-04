// api/debts.ts
import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'crypto';

export const config = { maxDuration: 30 };

const getSecret = () =>
  process.env.AUTH_SECRET || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';

function verifyToken(token?: string): boolean {
  if (!token || !getSecret()) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  const expected = createHmac('sha256', getSecret()).update(expiry).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expiry) > Date.now();
}

let isInitialized = false;

async function ensureTables(sql: any) {
  if (isInitialized) return;
  try {
    await Promise.all([
      sql`
        CREATE TABLE IF NOT EXISTS debts (
          id VARCHAR(64) PRIMARY KEY,
          type VARCHAR(20) NOT NULL,
          name VARCHAR(100) NOT NULL,
          counterparty VARCHAR(100),
          total_amount BIGINT NOT NULL,
          start_date DATE NOT NULL,
          due_date DATE,
          installment_amount BIGINT,
          installment_period INTEGER,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
      sql`
        CREATE TABLE IF NOT EXISTS debt_payments (
          id VARCHAR(64) PRIMARY KEY,
          debt_id VARCHAR(64) NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
          date DATE NOT NULL,
          amount BIGINT NOT NULL,
          account_id VARCHAR(50),
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
    ]);
    await Promise.all([
      sql`CREATE INDEX IF NOT EXISTS idx_debt_payments_debt_id ON debt_payments (debt_id);`,
      sql`CREATE INDEX IF NOT EXISTS idx_debts_type ON debts (type);`,
    ]);
    isInitialized = true;
  } catch (e) {
    console.error('Error ensuring debt tables:', e);
  }
}

// Normalisasi tanggal: handle DATE, TIMESTAMP, TEXT, ISO string
function toDateStr(val: any): string | undefined {
  if (!val && val !== 0) return undefined;
  if (typeof val === 'string') {
    // Sudah YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    // ISO string (mis. "2026-10-03T00:00:00.000Z")
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : undefined;
  }
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  return undefined;
}

export default async function handler(req: any, res: any) {
  const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!databaseUrl) {
    return res.status(500).json({
      success: false,
      error: 'DATABASE_URL environment variable is missing on Vercel.',
    });
  }

  const sql = neon(databaseUrl);
  await ensureTables(sql);

  const token = req.headers['x-admin-token'] as string | undefined;
  const isAdmin = verifyToken(token);

  try {
    // GET: semua debts + payments
    if (req.method === 'GET') {
      const [debtRows, payRows] = await Promise.all([
        sql`
          SELECT 
            id, type, name, counterparty, total_amount as "totalAmount",
            start_date as "startDate",
            due_date as "dueDate",
            installment_amount as "installmentAmount",
            installment_period as "installmentPeriod",
            notes, created_at as "createdAt"
          FROM debts
          ORDER BY created_at DESC
        `,
        sql`
          SELECT 
            id, debt_id as "debtId",
            date,
            amount, account_id as "accountId", notes
          FROM debt_payments
          ORDER BY date DESC
        `,
      ]);

      const debts = debtRows.map((d: any) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        counterparty: d.counterparty || '',
        totalAmount: Number(d.totalAmount) || 0,
        startDate: toDateStr(d.startDate) || d.startDate,
        dueDate: toDateStr(d.dueDate) || undefined,
        installmentAmount: d.installmentAmount ? Number(d.installmentAmount) : undefined,
        installmentPeriod: d.installmentPeriod ? Number(d.installmentPeriod) : undefined,
        notes: d.notes || undefined,
        createdAt: d.createdAt,
        payments: payRows
          .filter((p: any) => p.debtId === d.id)
          .map((p: any) => ({
            id: p.id,
            debtId: p.debtId,
            date: toDateStr(p.date) || p.date,
            amount: Number(p.amount) || 0,
            accountId: p.accountId || undefined,
            notes: p.notes || undefined,
          })),
      }));

      return res.status(200).json({ success: true, debts });
    }

    // POST: semua mutasi
    if (req.method === 'POST') {
      const { action, payload } = req.body || {};

      // Wajib admin untuk semua mutasi
      if (!isAdmin) {
        return res.status(401).json({
          success: false,
          error: 'Akses ditolak. Token admin diperlukan.',
        });
      }

      if (action === 'saveDebt') {
        const d = payload;
        const startDate = toDateStr(d.startDate);
        const dueDate = toDateStr(d.dueDate);
        await sql`
          INSERT INTO debts (
            id, type, name, counterparty, total_amount, start_date,
            due_date, installment_amount, installment_period, notes, created_at
          )
          VALUES (
            ${d.id}, ${d.type}, ${d.name}, ${d.counterparty || null},
            ${Number(d.totalAmount) || 0}, ${startDate || null},
            ${dueDate || null}, ${d.installmentAmount || null},
            ${d.installmentPeriod || null}, ${d.notes || null},
            ${d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString()}
          )
          ON CONFLICT (id) DO UPDATE SET
            type = EXCLUDED.type,
            name = EXCLUDED.name,
            counterparty = EXCLUDED.counterparty,
            total_amount = EXCLUDED.total_amount,
            start_date = EXCLUDED.start_date,
            due_date = EXCLUDED.due_date,
            installment_amount = EXCLUDED.installment_amount,
            installment_period = EXCLUDED.installment_period,
            notes = EXCLUDED.notes;
        `;
        return res.status(200).json({ success: true });
      }

      if (action === 'deleteDebt') {
        await sql`DELETE FROM debts WHERE id = ${payload.id}`;
        return res.status(200).json({ success: true });
      }

      if (action === 'savePayment') {
        const p = payload;
        const payDate = toDateStr(p.date);
        await sql`
          INSERT INTO debt_payments (id, debt_id, date, amount, account_id, notes)
          VALUES (
            ${p.id}, ${p.debtId}, ${payDate || null}, ${Number(p.amount) || 0},
            ${p.accountId || null}, ${p.notes || null}
          )
          ON CONFLICT (id) DO UPDATE SET
            date = EXCLUDED.date,
            amount = EXCLUDED.amount,
            account_id = EXCLUDED.account_id,
            notes = EXCLUDED.notes;
        `;
        return res.status(200).json({ success: true });
      }

      if (action === 'deletePayment') {
        await sql`DELETE FROM debt_payments WHERE id = ${payload.id}`;
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e: any) {
    console.error('API /debts error:', e);
    return res.status(500).json({
      success: false,
      error: e.message || 'Server error',
    });
  }
}