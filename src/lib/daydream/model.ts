import { coerceModelContext } from '$lib/constants/default-models';
import { getSetting } from '$lib/server/models/settings';
import { resolveChatTurnModel } from '$lib/server/models/workload-settings';

export const DAYDREAM_MODEL_KEY = 'jkai.daydream.model';

/** Explicit background override, otherwise the default used for new JKAI chats. */
export async function resolveDaydreamModel() {
  const pin = await getSetting<{ modelId?: string } | null>(DAYDREAM_MODEL_KEY);
  return pin?.modelId ? coerceModelContext({ modelId: pin.modelId }) : resolveChatTurnModel();
}
