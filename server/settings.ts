import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';
import { settings } from '../src/db/schema.js';

export async function getSetting(key: string): Promise<string | null> {
  const rows = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function deleteSetting(key: string): Promise<void> {
  await getDb().delete(settings).where(eq(settings.key, key));
}