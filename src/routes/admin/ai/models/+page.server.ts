import type { PageServerLoad } from './$types';
import { getSetting } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { loadKeys } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import { DEFAULT_GLM_MODEL_ID } from '$lib/constants/glm-models';

export const load: PageServerLoad = async () => {
  const [glm, alt, builder, orKey, lastRefreshed, [{ count }]] = await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_glm_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    getSetting<ModelContext>('jkai.builder.default_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
    getSetting<string>('openrouter.last_refreshed_at'),
    db.select({ count: sql<number>`count(*)::int` }).from(openrouterModels),
  ]);

  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return {
    chat: {
      glmModelId: glm?.modelId ?? DEFAULT_GLM_MODEL_ID,
      altOpenRouterModelId: alt?.modelId ?? null,
    },
    builder: builder ?? { provider: 'zai', modelId: 'glm-5-turbo' } as ModelContext,
    openrouterKey: {
      configured: dbHasKey || keysJsonHasKey,
      source: dbHasKey ? 'db' : (keysJsonHasKey ? 'keys.json' : 'none'),
    },
    modelCount: count,
    lastRefreshed,
  };
};
