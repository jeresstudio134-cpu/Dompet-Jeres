import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './http.js';
import { getSetting, setSetting } from './settings.js';

declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean;
    }
  }
}

const DEFAULT_PIN = '1234';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

const getSecret = () =>
  process.env.AUTH_SECRET || process.env.DATABASE_URL || 'dev-secret-ganti-ini';

export function signToken(): string {
  const expiry = String(Date.now() + TOKEN_TTL_MS);
  const sig = createHmac('sha256', getSecret()).update(expiry).digest('hex');
  return `${expiry}.${sig}`;
}

export function verifyToken(token?: string): boolean {
  if (!token) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  const expected = createHmac('sha256', getSecret()).update(expiry).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expiry) > Date.now();
}

// Middleware: isi req.isAdmin dari header token
export function adminContext(req: Request, _res: Response, next: NextFunction) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : String(req.headers['x-admin-token'] || '');
  req.isAdmin = verifyToken(token);
  next();
}

export function assertAdmin(req: Request): void {
  if (!req.isAdmin) throw new HttpError(401, 'Akses admin diperlukan. Silakan login.');
}

const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

export async function verifyPin(pin: string): Promise<boolean> {
  const row = await getSetting('admin_pin');
  if (!row) return pin === DEFAULT_PIN;
  const [salt, hash] = row.split(':');
  if (!salt || !hash) return pin === DEFAULT_PIN;
  const a = Buffer.from(hashPin(pin, salt));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function savePin(pin: string): Promise<void> {
  const salt = randomBytes(16).toString('hex');
  await setSetting('admin_pin', `${salt}:${hashPin(pin, salt)}`);
  await setSetting('admin_pin_len', String(pin.length));
}

export async function getPinLength(): Promise<number> {
  return Number(await getSetting('admin_pin_len')) || 4;
}

export async function getLoginLock(): Promise<number> {
  const until = Number(await getSetting('login_lock_until')) || 0;
  const left = until - Date.now();
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

export async function registerLoginFail(): Promise<void> {
  const fails = (Number(await getSetting('login_fails')) || 0) + 1;
  if (fails >= MAX_FAILS) {
    await setSetting('login_lock_until', String(Date.now() + LOCK_MS));
    await setSetting('login_fails', '0');
  } else {
    await setSetting('login_fails', String(fails));
  }
}

export async function clearLoginFail(): Promise<void> {
  await setSetting('login_fails', '0');
  await setSetting('login_lock_until', '0');
}