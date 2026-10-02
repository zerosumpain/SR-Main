import { inArray, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { loadCatalogue } from '$lib/llm/model-source';
import {
  MODEL_SERVICE_CONTRACT,
  isSecretSettingKey,
  type ModelConfigSnapshot,
  type ResolvedModel,
} from '$lib/llm/model-service-contract';
import { SITE_WORKLOADS } from '$lib/models/workloads';
import {
  SETTINGS_ASSIGNMENTS_KEY,
  SETTINGS_CONFIG_KEY,
  SETTINGS_ENABLED_KEY,
  SETTINGS_OVERRIDES_KEY,
} from '$lib/routing/types';
import { isCodexEnabled, resolveDefaultModel } from './settings';
import { resolveWorkloadModel } from './workload-settings';

/**
 * The model configuration an extracted application needs, without secrets.
 *
 * Served at `GET /api/platform/models/config`. The applications used to read
 * `app_settings` and `openrouter_models` in Main's database directly; this is
 * the same information, chosen by Main, over a credentialled lane.
 *
 * `settings` carries the model-selection keys exactly as stored, because each
 * application keeps its own resolvers (a session pin, a routing assignment, a
 * workload fallback) and they must keep resolving the same way. It is an
 * ALLOW-list: the fixed keys below, every workload key in Main's registry, and
 * any `jkai.*model` key (an application can lag Main's registry by a release).
 * `isSecretSettingKey` is applied on top, so `openrouter.api_key` cannot be
 * served even if a pattern ever grew to match it.
 */
export const SERVED_SETTING_KEYS: readonly string[] = [
  'jkai.chat.default_model',
  'jkai.builder.thinking_model',
  'jkai.chat.alt_openrouter_model',
  'jkai.chat.thinking_level',
  'jkai.approval_ui',
  'codex.enabled',
  SETTINGS_ENABLED_KEY,
  SETTINGS_ASSIGNMENTS_KEY,
  SETTINGS_CONFIG_KEY,
  SETTINGS_OVERRIDES_KEY,
  ...SITE_WORKLOADS.map((w) => w.key),
];

const MODEL_KEY = /^jkai\.[a-z0-9_.]+model$/;

export function isServedSettingKey(key: string): boolean {
  if (isSecretSettingKey(key)) return false;
  return SERVED_SETTING_KEYS.includes(key) || MODEL_KEY.test(key);
}

function plain(ctx: { provider: string; modelId: string }): ResolvedModel {
  return { provider: ctx.provider, modelId: ctx.modelId };
}

export async function buildModelConfigSnapshot(now = new Date()): Promise<ModelConfigSnapshot> {
  const keys = SERVED_SETTING_KEYS.filter((k) => !isSecretSettingKey(k));
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(or(inArray(appSettings.key, [...keys]), sql`${appSettings.key} ~ ${MODEL_KEY.source}`));

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    // Re-checked here, so the SQL pattern is never the only guard.
    if (isServedSettingKey(row.key)) settings[row.key] = row.value;
  }

  const [defaultModel, codexEnabled, catalogue] = await Promise.all([
    resolveDefaultModel(),
    isCodexEnabled(),
    loadCatalogue(),
  ]);

  const workloads: Record<string, ResolvedModel> = {};
  for (const def of SITE_WORKLOADS) {
    try {
      workloads[def.id] = plain(await resolveWorkloadModel(def));
    } catch (err) {
      // One role that cannot resolve must not take the whole document down;
      // the application falls back to its own resolver for that role.
      console.warn(`[model-service] could not resolve workload ${def.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return {
    contract: MODEL_SERVICE_CONTRACT,
    generatedAt: now.toISOString(),
    settings,
    resolved: { defaultModel: plain(defaultModel), codexEnabled, workloads },
    catalogue,
  };
}
