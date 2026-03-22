import type { PageServerLoad, Actions } from './$types';
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

export const actions: Actions = {
  save: async ({ request }) => {
    const formData = await request.formData();
    const key = formData.get('key') as string;
    const value = formData.get('value') as string;

    if (!key) return { success: false, error: 'key is required' };

    await db
      .insert(agentSettings)
      .values({ key, value: value ?? '', updatedAt: new Date() })
      .onConflictDoUpdate({
        target: agentSettings.key,
        set: { value: value ?? '', updatedAt: new Date() },
      });

    return { success: true };
  },
};
