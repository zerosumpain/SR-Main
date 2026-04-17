import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadKeys } from '$lib/deepdive/keys';
import type { ModelContext } from './types';

const TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearSettingsCache(): void {
  cache.clear();
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const value = (row?.value ?? null) as T | null;
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
  cache.delete(key);
}

export async function resolveDefaultModel(kind: 'chat' | 'builder'): Promise<ModelContext> {
  const key = kind === 'chat' ? 'jkai.chat.default_model' : 'jkai.builder.default_model';
  const v = await getSetting<ModelContext>(key);
  return v ?? { provider: 'zai', modelId: 'glm-5.1' };
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
  const v = await getSetting<{ value?: string }>('openrouter.api_key');
  if (v?.value) return v.value;
  return loadKeys().openrouterApiKey;
}
