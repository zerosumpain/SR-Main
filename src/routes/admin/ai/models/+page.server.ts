import type { PageServerLoad } from './$types';
import { getSetting } from '$lib/server/models/settings';
import { loadKeys } from '$lib/llm/keys';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import { DEFAULT_CHAT_MODEL_ID } from '$lib/constants/default-models';
import { CODEX_MODELS } from '$lib/server/models/codex-catalogue';
import { getCodexBridgeUrl, isCodexEnabled } from '$lib/server/models/settings';

interface CodexBridgeHealth {
  reachable: boolean;
  ok: boolean;
  loggedIn: boolean;
  authMode: string | null;
  codexVersion: string | null;
  error: string | null;
}

/** Probe the bridge for the status panel. Short timeout and never throws — the
 *  models page must still render when the bridge is down, since "the bridge is
 *  down" is precisely what the operator opened this page to find out. */
async function probeCodexBridge(): Promise<CodexBridgeHealth> {
  try {
    const res = await fetch(`${getCodexBridgeUrl()}/health`, { signal: AbortSignal.timeout(3_000) });
    const body = (await res.json()) as Partial<CodexBridgeHealth>;
    return {
      reachable: true,
      ok: body.ok === true,
      loggedIn: body.loggedIn === true,
      authMode: body.authMode ?? null,
      codexVersion: body.codexVersion ?? null,
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      ok: false,
      loggedIn: false,
      authMode: null,
      codexVersion: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const load: PageServerLoad = async () => {
  const [chatDefault, alt, orKey, lastRefreshed, [{ count }], codexEnabled, codexHealth] =
    await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
    getSetting<string>('openrouter.last_refreshed_at'),
    db.select({ count: sql<number>`count(*)::int` }).from(openrouterModels),
    isCodexEnabled(),
    probeCodexBridge(),
  ]);

  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return {
    chat: {
      defaultModelId: chatDefault?.modelId ?? DEFAULT_CHAT_MODEL_ID,
      altOpenRouterModelId: alt?.modelId ?? null,
    },
    openrouterKey: {
      configured: dbHasKey || keysJsonHasKey,
      source: dbHasKey ? 'db' : (keysJsonHasKey ? 'keys.json' : 'none'),
    },
    modelCount: count,
    lastRefreshed,
    codex: {
      enabled: codexEnabled,
      health: codexHealth,
      modelCount: CODEX_MODELS.length,
    },
  };
};
