import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting, clearSettingsCache } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { loadKeys } from '$lib/deepdive/keys';

export const GET: RequestHandler = async () => {
  const [chat, builder, orKey] = await Promise.all([
    getSetting<ModelContext>('jkai.chat.default_model'),
    getSetting<ModelContext>('jkai.builder.default_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
  ]);
  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return json({
    chat: chat ?? { provider: 'zai', modelId: 'glm-5.1' },
    builder: builder ?? { provider: 'zai', modelId: 'glm-5.1' },
    openrouterKey: {
      configured: dbHasKey || keysJsonHasKey,
      source: dbHasKey ? 'db' : (keysJsonHasKey ? 'keys.json' : 'none'),
      masked: dbHasKey ? maskKey(orKey!.value!) : (keysJsonHasKey ? maskKey(loadKeys().openrouterApiKey!) : ''),
    },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();

  if (body.chat) {
    if (!isValidContext(body.chat)) throw error(400, 'invalid chat context');
    await setSetting('jkai.chat.default_model', body.chat);
  }
  if (body.builder) {
    if (!isValidContext(body.builder)) throw error(400, 'invalid builder context');
    await setSetting('jkai.builder.default_model', body.builder);
  }
  if (typeof body.openrouterApiKey === 'string') {
    await setSetting('openrouter.api_key', { value: body.openrouterApiKey });
  }

  clearSettingsCache();
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
