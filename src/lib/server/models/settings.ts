import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadKeys } from '$lib/deepdive/keys';
import {
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_AGENTIC_MODEL_ID,
  coerceModelContext,
} from '$lib/constants/default-models';
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
    // Site-wide default — set from /admin/ai/models. Stored values (and any
    // legacy bare GLM ids) are coerced to OpenRouter contexts.
    const v = await getSetting<{ provider?: string; modelId?: string }>('jkai.chat.default_model');
    return coerceModelContext({ modelId: v?.modelId ?? DEFAULT_CHAT_MODEL_ID });
  }
  // Builder is the tool-heavy agentic path — keep it on the fast model, not the slow flagship.
  const v = await getSetting<{ provider?: string; modelId?: string }>('jkai.builder.default_model');
  return coerceModelContext({ modelId: v?.modelId ?? DEFAULT_AGENTIC_MODEL_ID });
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
  if (v && typeof v === 'object' && 'modelId' in v && typeof v.modelId === 'string') {
    return coerceModelContext({ modelId: v.modelId });
  }
  // Thinking tier is one-shot reasoning (plan/clarify), not agentic — use the flagship.
  return coerceModelContext({ modelId: DEFAULT_CHAT_MODEL_ID });
}

/** Chat-only: the alternate OpenRouter model that the in-chat toggle flips to. */
export async function resolveChatAltOpenRouterModel(): Promise<ModelContext | null> {
  const v = await getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model');
  if (!v?.modelId) return null;
  return { provider: 'openrouter', modelId: v.modelId };
}

/** /jkai approval-prompt UI behaviour — drives the inline Approve / Deny
 *  buttons that appear under Hermes' "dangerous command requires approval"
 *  messages. `defaultAction` is what auto-fires after `autoSelectMs` if the
 *  user doesn't click; `'none'` disables auto-select (buttons still render,
 *  user must click). */
export interface ApprovalUiSettings {
  defaultAction: 'approve' | 'approve_always' | 'deny' | 'none';
  autoSelectMs: number;
}

const APPROVAL_UI_KEY = 'jkai.approval_ui';
const DEFAULT_APPROVAL_UI: ApprovalUiSettings = {
  defaultAction: 'none',
  autoSelectMs: 20_000,
};

export async function getApprovalUiSettings(): Promise<ApprovalUiSettings> {
  const v = await getSetting<Partial<ApprovalUiSettings> | null>(APPROVAL_UI_KEY);
  return { ...DEFAULT_APPROVAL_UI, ...(v ?? {}) };
}

export async function setApprovalUiSettings(value: ApprovalUiSettings): Promise<void> {
  await setSetting(APPROVAL_UI_KEY, value);
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
  const v = await getSetting<{ value?: string }>('openrouter.api_key');
  if (v?.value) return v.value;
  return loadKeys().openrouterApiKey;
}
