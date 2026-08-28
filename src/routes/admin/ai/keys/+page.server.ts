import type { PageServerLoad } from './$types';
import { getKeysStatus, loadKeys } from '$lib/llm/keys';
import { getSetting } from '$lib/server/models/settings';

export const load: PageServerLoad = async () => {
  const fileStatus = getKeysStatus();
  const dbOpenrouter = await getSetting<{ value?: string }>('openrouter.api_key');
  const keysJsonHasOpenrouter = !!loadKeys().openrouterApiKey;
  const dbHasOpenrouter = !!dbOpenrouter?.value;

  return {
    keys: {
      ...fileStatus,
      // Override openrouter status: prefer DB-stored key (primary), fall back to keys.json
      openrouterConfigured: dbHasOpenrouter || keysJsonHasOpenrouter,
      openrouterSource: (dbHasOpenrouter ? 'db' : keysJsonHasOpenrouter ? 'keys.json' : 'none') as 'db' | 'keys.json' | 'none',
    },
  };
};
