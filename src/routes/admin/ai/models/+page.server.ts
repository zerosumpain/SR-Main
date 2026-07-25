import type { PageServerLoad } from './$types';
import { getSetting } from '$lib/server/models/settings';
import { loadKeys } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import { DEFAULT_CHAT_MODEL_ID } from '$lib/constants/default-models';

export const load: PageServerLoad = async () => {
  const [chatDefault, alt, orKey, lastRefreshed, [{ count }]] = await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
    getSetting<string>('openrouter.last_refreshed_at'),
    db.select({ count: sql<number>`count(*)::int` }).from(openrouterModels),
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
  };
};
