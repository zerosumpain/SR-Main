import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setSetting } from '$lib/server/models/settings';
import { SETTINGS_ENABLED_KEY, SETTINGS_TOPICS_KEY } from '$lib/briefing/types';
import { normaliseBriefingProfile, SETTINGS_PROFILE_KEY } from '$lib/constants/briefing';

// Owner-gated by hooks. Set the briefing kill-switch and/or the topics list.
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  try {
    if (typeof body.enabled === 'boolean') await setSetting(SETTINGS_ENABLED_KEY, body.enabled);
    if (Array.isArray(body.topics)) {
      const topics = body.topics.filter((t: unknown): t is string => typeof t === 'string').map((t: string) => t.trim()).filter(Boolean);
      await setSetting(SETTINGS_TOPICS_KEY, topics);
    }
    if (body.profile && typeof body.profile === 'object') {
      await setSetting(SETTINGS_PROFILE_KEY, normaliseBriefingProfile(body.profile));
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'config failed' }, { status: 500 });
  }
};
