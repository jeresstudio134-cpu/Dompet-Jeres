import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';
import { settings } from '../src/db/schema.js';

const memorySettings = new Map<string, string>();

function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL);
}

export async function getSetting(key: string): Promise<string | null> {
  if (!hasDb()) return memorySettings.get(key) ?? null;
  try {
    const rows = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  } catch {
    return memorySettings.get(key) ?? null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!hasDb()) {
    memorySettings.set(key, value);
    return;
  }
  try {
    await getDb()
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  } catch {
    memorySettings.set(key, value);
  }
}

export async function deleteSetting(key: string): Promise<void> {
  if (!hasDb()) {
    memorySettings.delete(key);
    return;
  }
  try {
    await getDb().delete(settings).where(eq(settings.key, key));
  } catch {
    memorySettings.delete(key);
  }
}
