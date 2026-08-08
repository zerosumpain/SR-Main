import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting, clearSettingsCache } from '$lib/server/models/settings';
import { loadKeys } from '$lib/deepdive/keys';
import { DEFAULT_CHAT_MODEL_ID, coerceModelContext } from '$lib/constants/default-models';

export const GET: RequestHandler = async () => {
  const [chatDefault, alt, orKey] = await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
  ]);
  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return json({
    chat: {
      defaultModelId: chatDefault?.modelId ?? DEFAULT_CHAT_MODEL_ID,
      altOpenRouterModelId: alt?.modelId ?? null,
    },
    openrouterKey: {
      configured: dbHasKey || keysJsonHasKey,
      source: dbHasKey ? 'db' : (keysJsonHasKey ? 'keys.json' : 'none'),
      masked: dbHasKey
        ? maskKey(orKey!.value!)
        : (keysJsonHasKey ? maskKey(loadKeys().openrouterApiKey!) : ''),
    },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  let changed = false;

  if (body.chatDefaultModelId !== undefined) {
    if (!isValidOpenRouterId(body.chatDefaultModelId)) {
      throw error(400, 'invalid chatDefaultModelId — must be a full OpenRouter slug (vendor/model)');
    }
    // coerceModelContext, not a hardcoded provider — a `codex/*` id saved here
    // must persist as a Codex context, not an OpenRouter one that only happens
    // to be recovered correctly on read.
    await setSetting('jkai.chat.default_model', coerceModelContext({ modelId: body.chatDefaultModelId }));
    changed = true;
  }

  if (body.chatAltOpenRouterModelId !== undefined) {
    if (body.chatAltOpenRouterModelId === null) {
      await setSetting('jkai.chat.alt_openrouter_model', null);
    } else if (isValidOpenRouterId(body.chatAltOpenRouterModelId)) {
      await setSetting('jkai.chat.alt_openrouter_model', { modelId: body.chatAltOpenRouterModelId });
    } else {
      throw error(400, 'invalid chatAltOpenRouterModelId');
    }
    changed = true;
  }

  if (body.openrouterApiKey !== undefined) {
    if (typeof body.openrouterApiKey !== 'string') throw error(400, 'invalid openrouterApiKey');
    await setSetting('openrouter.api_key', { value: body.openrouterApiKey });
    changed = true;
  }

  if (changed) clearSettingsCache();
  return json({ ok: true });
};

/** OpenRouter model ids are always vendor/slug — a bare id would 400 at call
 *  time, so reject it at save time. */
function isValidOpenRouterId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.includes('/');
}

function maskKey(k: string): string {
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
