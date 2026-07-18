import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting, clearSettingsCache } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { loadKeys } from '$lib/deepdive/keys';
import { DEFAULT_CHAT_MODEL_ID, DEFAULT_AGENTIC_MODEL_ID } from '$lib/constants/default-models';

export const GET: RequestHandler = async () => {
  const [chatDefault, alt, builder, orKey] = await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    getSetting<ModelContext>('jkai.builder.default_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
  ]);
  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return json({
    chat: {
      defaultModelId: chatDefault?.modelId ?? DEFAULT_CHAT_MODEL_ID,
      altOpenRouterModelId: alt?.modelId ?? null,
    },
    builder: builder ?? { provider: 'openrouter', modelId: DEFAULT_AGENTIC_MODEL_ID },
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
    await setSetting('jkai.chat.default_model', { provider: 'openrouter', modelId: body.chatDefaultModelId });
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

  if (body.builder !== undefined) {
    if (!isValidContext(body.builder)) throw error(400, 'invalid builder context');
    await setSetting('jkai.builder.default_model', body.builder);
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

function isValidContext(v: unknown): v is ModelContext {
  return !!v && typeof v === 'object'
    && (v as any).provider === 'openrouter'
    && isValidOpenRouterId((v as any).modelId);
}

function maskKey(k: string): string {
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
