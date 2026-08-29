import type { PageServerLoad } from './$types';
import { getKeysStatus, loadKeys } from '$lib/llm/keys';
import { getSetting } from '$lib/server/models/settings';

export const load: PageServerLoad = async () => {
  const status = await getKeysStatus();
  const dbOpenrouter = await getSetting<{ value?: string }>('openrouter.api_key');
  const keysJsonHasOpenrouter = !!loadKeys().openrouterApiKey;
  const dbHasOpenrouter = !!dbOpenrouter?.value;

  return {
    keys: {
      ...status,
      // `openrouterConfigured` is already right — this page only adds WHICH of
      // the two stores answered, which is the thing worth seeing when one of
      // them is empty.
      openrouterSource: (dbHasOpenrouter ? 'db' : keysJsonHasOpenrouter ? 'keys.json' : 'none') as 'db' | 'keys.json' | 'none',
    },
  };
};
