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
  if (kind === 'chat') {
    // Chat default is always the configured GLM model.
    const v = await getSetting<{ modelId?: string }>('jkai.chat.default_glm_model');
    return { provider: 'zai', modelId: v?.modelId ?? 'glm-5.1' };
  }
  const v = await getSetting<ModelContext>('jkai.builder.default_model');
  return v ?? { provider: 'zai', modelId: 'glm-5.1' };
}

/**
 * Orchestrator-only: a smarter / larger-context model used for "thinking"
 * turns — plan emission, clarify emission, plan revision, clarify-answer
 * resumption, and any turn where the prompt has grown past the large-
 * context threshold. Returns null if the operator has explicitly disabled
 * the split (set the setting to `{ disabled: true }`).
 */
export async function resolveThinkingModel(): Promise<ModelContext | null> {
  const v = await getSetting<ModelContext | { modelId?: string; disabled?: boolean } | null>(
    'jkai.builder.thinking_model',
  );
  if (v && typeof v === 'object' && 'disabled' in v && v.disabled) return null;
  if (v && typeof v === 'object' && 'provider' in v && 'modelId' in v) return v as ModelContext;
  if (v && typeof v === 'object' && 'modelId' in v && typeof v.modelId === 'string') {
    return { provider: 'zai', modelId: v.modelId };
  }
  return { provider: 'zai', modelId: 'glm-5.1' };
}

/** Chat-only: the alternate OpenRouter model that the in-chat toggle flips to. */
export async function resolveChatAltOpenRouterModel(): Promise<ModelContext | null> {
  const v = await getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model');
  if (!v?.modelId) return null;
  return { provider: 'openrouter', modelId: v.modelId };
}

/** Chat-only: the configured GLM default as a ModelContext. */
export async function resolveChatGlmModel(): Promise<ModelContext> {
  return resolveDefaultModel('chat');
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
  const v = await getSetting<{ value?: string }>('openrouter.api_key');
  if (v?.value) return v.value;
  return loadKeys().openrouterApiKey;
}
