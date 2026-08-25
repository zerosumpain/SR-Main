import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadKeys } from '$lib/deepdive/keys';
import { DEFAULT_CHAT_MODEL_ID, coerceModelContext } from '$lib/constants/default-models';
import type { ModelContext } from './types';
import { isThinkingLevel, type ThinkingLevel } from '$lib/models/thinking';

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

/**
 * Unset a key entirely.
 *
 * `setSetting(key, null)` CANNOT do this: `app_settings.value` is `jsonb NOT
 * NULL`, so a JS null binds as empty and the insert fails outright — every
 * "clear this setting" path that reached for it 500s. Deleting the row is also
 * the honest encoding: `getSetting` already returns null for a missing key, so
 * absent and "explicitly nothing" resolve identically without a row that says
 * neither.
 */
export async function deleteSetting(key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
  cache.delete(key);
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

/**
 * The site-wide default model. ONE value drives every LLM task — chat, the
 * autonomous builder, deep research, workflow LLM nodes, project-page chats,
 * briefings, self-improve (John, 2026-07-25).
 *
 * This used to take a `'chat' | 'builder'` kind, which it ignored: every caller
 * got the same value regardless. Keeping it made 14 call sites read as though
 * they selected a builder-specific model when nothing did, and left a
 * `jkai.builder.default_model` setting that no code path consulted. The
 * parameter and that setting are both gone — if a task ever genuinely needs its
 * own model, give it a named resolver instead, the way `resolveExtractionModel`
 * does, so the carve-out is visible rather than implied.
 *
 * Set from the /jkai model picker or /admin/ai/models. Stored values (and any
 * legacy bare GLM ids) are coerced to OpenRouter contexts.
 */
export async function resolveDefaultModel(): Promise<ModelContext> {
  const v = await getSetting<{ provider?: string; modelId?: string }>('jkai.chat.default_model');
  return coerceModelContext({ modelId: v?.modelId ?? DEFAULT_CHAT_MODEL_ID });
}

/**
 * Every deliberate exception to the one-default rule above now lives in the
 * workload registry — `$lib/models/workloads` for the definitions,
 * `./workload-settings` for the resolvers (`resolveExtractionModel` and
 * friends). They are not here because this module is the primitive the registry
 * is built on, and importing it back would make the graph circular.
 *
 * If you are adding a role that needs its own model, add it there: the registry
 * is what the model picker renders, so a carve-out declared in it is one the
 * operator can see and change, and a carve-out declared anywhere else is one
 * only a `grep` will ever find.
 */

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
  // Unset follows the SITE DEFAULT, not the code constant.
  //
  // This used to return DEFAULT_CHAT_MODEL_ID directly, which quietly made the
  // thinking tier the one role that ignored the operator's choice: with the
  // default on codex/gpt-5.6-terra, an unset thinking model still resolved to
  // deepseek/deepseek-v4-flash. It cost nothing in practice only because the
  // sole caller (general-chat.ts) is dormant behind the Hermes engine — which
  // is exactly the kind of latent divergence that surfaces the day that path
  // wakes up.
  return resolveDefaultModel();
}

/** Chat-only: the alternate OpenRouter model that the in-chat toggle flips to. */
export async function resolveChatAltOpenRouterModel(): Promise<ModelContext | null> {
  const v = await getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model');
  if (!v?.modelId) return null;
  return { provider: 'openrouter', modelId: v.modelId };
}

/**
 * The thinking level a NEW chat thread starts on: whatever was last chosen.
 *
 * There is no separate "site default" control for this and there should not be
 * one. A thinking level is a habit, not a policy — you turn it up because the
 * work got harder and you leave it there — so the picker writes this key on
 * every change and a fresh thread inherits it. Threads keep their own level in
 * `jkai_conversations.thinking_level`, so changing it here never reaches back
 * into a thread already running.
 *
 * Null (no row) means "provider default", the behaviour before the control
 * existed. Note that is the ONLY way to express it: `app_settings.value` is
 * `jsonb NOT NULL`, so clearing has to delete the row — see deleteSetting.
 */
const CHAT_THINKING_KEY = 'jkai.chat.thinking_level';

export async function resolveDefaultThinkingLevel(): Promise<ThinkingLevel | null> {
  const v = await getSetting<{ level?: unknown } | null>(CHAT_THINKING_KEY);
  return isThinkingLevel(v?.level) ? v.level : null;
}

export async function setDefaultThinkingLevel(level: ThinkingLevel | null): Promise<void> {
  if (level === null) await deleteSetting(CHAT_THINKING_KEY);
  else await setSetting(CHAT_THINKING_KEY, { level });
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

/** Which engine answers /jkai chat.
 *
 * `true` → Hermes (the gateway on homeserv: terminal, file editing, skills,
 * delegation, web search). `false` → the in-repo `generalChat` loop, which
 * keeps every site toolset (intel, canvas, datastore, drive, Gmail…) but has
 * no terminal, file or browser tools.
 *
 * Unset falls back to the `JKAI_HERMES_CANVAS_CHAT` env var, so a host that
 * has never touched the toggle behaves exactly as it did before. Setting it
 * from /admin/ops/engine overrides the env var — which is the point: flipping
 * engines used to need an env edit and a redeploy on the VPS.
 *
 * Read per request (30s cache in getSetting), never captured at module load,
 * or the toggle would need a restart to take effect.
 */
const HERMES_CHAT_KEY = 'jkai.chat.hermes_enabled';

export async function isHermesChatEnabled(envDefault: boolean): Promise<boolean> {
  const v = await getSetting<boolean | null>(HERMES_CHAT_KEY);
  return typeof v === 'boolean' ? v : envDefault;
}

export async function setHermesChatEnabled(enabled: boolean): Promise<void> {
  await setSetting(HERMES_CHAT_KEY, enabled);
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
  const v = await getSetting<{ value?: string }>('openrouter.api_key');
  if (v?.value) return v.value;
  return loadKeys().openrouterApiKey;
}

/**
 * Base URL of the local Codex bridge (packages/jkai-codex-bridge), which puts
 * an OpenAI-compatible face on the Codex CLI so the site's existing OpenAI SDK
 * clients can reach John's ChatGPT Pro subscription.
 *
 * Loopback by default and NOT settable from the admin UI on purpose: this URL
 * is where prompts (some containing user content) get sent, and an operator
 * typo that pointed it off-box would exfiltrate them. Override with the
 * CODEX_BRIDGE_URL env var, which only someone with shell access can set.
 */
export function getCodexBridgeUrl(): string {
  return process.env.CODEX_BRIDGE_URL || 'http://127.0.0.1:5207';
}

/**
 * Whether Codex models may be selected at all. Off unless explicitly enabled,
 * so a host with no `codex login` doesn't offer models that will fail at call
 * time. The admin panel at /admin/ai/models flips this after a successful
 * health probe.
 */
export async function isCodexEnabled(): Promise<boolean> {
  const v = await getSetting<{ enabled?: boolean } | null>('codex.enabled');
  return v?.enabled === true;
}

export async function setCodexEnabled(enabled: boolean): Promise<void> {
  await setSetting('codex.enabled', { enabled });
}
