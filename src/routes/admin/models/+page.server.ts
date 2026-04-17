import type { PageServerLoad } from './$types';
import { getSetting } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { loadKeys } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { sql } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const [chat, builder, orKey, lastRefreshed, [{ count }]] = await Promise.all([
    getSetting<ModelContext>('jkai.chat.default_model'),
    getSetting<ModelContext>('jkai.builder.default_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
    getSetting<string>('openrouter.last_refreshed_at'),
    db.select({ count: sql<number>`count(*)::int` }).from(openrouterModels),
  ]);

  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return {
    chat: chat ?? { provider: 'zai', modelId: 'glm-5.1' },
    builder: builder ?? { provider: 'zai', modelId: 'glm-5.1' },
    openrouterKey: {
      configured: dbHasKey || keysJsonHasKey,
      source: dbHasKey ? 'db' : (keysJsonHasKey ? 'keys.json' : 'none'),
    },
    modelCount: count,
    lastRefreshed,
  };
};
