import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { agentSettings } from '$lib/db/schema';

export const load: PageServerLoad = async () => {
  const settings = await db.select().from(agentSettings);
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));

  return {
    systemPrompt: settingsMap['system_prompt'] ?? '',
    memory: settingsMap['memory'] ?? '',
  };
};
