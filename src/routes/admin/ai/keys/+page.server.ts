import type { PageServerLoad } from './$types';
import { getKeysStatus, loadKeys } from '$lib/llm/keys';
import { getSetting } from '$lib/server/models/settings';
import { BRAVE_KEY_SETTING, getBraveApiKey } from '$lib/deepdive/brave';

export const load: PageServerLoad = async () => {
  const status = await getKeysStatus();
  const dbOpenrouter = await getSetting<{ value?: string }>('openrouter.api_key');
  const keysJsonHasOpenrouter = !!loadKeys().openrouterApiKey;
  const dbHasOpenrouter = !!dbOpenrouter?.value;
  const [braveKey, dbBrave] = await Promise.all([getBraveApiKey(), getSetting<{ value?: string }>(BRAVE_KEY_SETTING)]);

  return {
    keys: {
      ...status,
      // `openrouterConfigured` is already right — this page only adds WHICH of
      // the two stores answered, which is the thing worth seeing when one of
      // them is empty.
      openrouterSource: (dbHasOpenrouter ? 'db' : keysJsonHasOpenrouter ? 'keys.json' : 'none') as 'db' | 'keys.json' | 'none',
      braveConfigured: !!braveKey,
      braveSource: (dbBrave?.value ? 'db' : braveKey ? 'env' : 'none') as 'db' | 'env' | 'none',
    },
  };
};
