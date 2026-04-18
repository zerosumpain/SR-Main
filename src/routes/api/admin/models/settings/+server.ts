import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting, clearSettingsCache } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { loadKeys } from '$lib/deepdive/keys';
import { GLM_MODELS, DEFAULT_GLM_MODEL_ID } from '$lib/constants/glm-models';

const KNOWN_GLM_IDS = new Set(GLM_MODELS.map((m) => m.id));

export const GET: RequestHandler = async () => {
  const [glm, alt, builder, orKey] = await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_glm_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    getSetting<ModelContext>('jkai.builder.default_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
  ]);
  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return json({
    chat: {
      glmModelId: glm?.modelId ?? DEFAULT_GLM_MODEL_ID,
      altOpenRouterModelId: alt?.modelId ?? null,
    },
    builder: builder ?? { provider: 'zai', modelId: 'glm-5.1' },
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

  if (body.chatGlmModelId !== undefined) {
    if (typeof body.chatGlmModelId !== 'string' || !KNOWN_GLM_IDS.has(body.chatGlmModelId)) {
      throw error(400, 'invalid chatGlmModelId');
    }
    await setSetting('jkai.chat.default_glm_model', { modelId: body.chatGlmModelId });
    changed = true;
  }

  if (body.chatAltOpenRouterModelId !== undefined) {
    if (body.chatAltOpenRouterModelId === null) {
      await setSetting('jkai.chat.alt_openrouter_model', null);
    } else if (typeof body.chatAltOpenRouterModelId === 'string' && body.chatAltOpenRouterModelId.length > 0) {
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

function isValidContext(v: unknown): v is ModelContext {
  return !!v && typeof v === 'object'
    && ((v as any).provider === 'zai' || (v as any).provider === 'openrouter')
    && typeof (v as any).modelId === 'string'
    && (v as any).modelId.length > 0;
}

function maskKey(k: string): string {
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
