import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { listMonitors } from '$lib/monitors/monitors.server';
import { BRIEFINGS_COLLECTION, briefingDateLabel } from '$lib/briefing/types';

/**
 * Lightweight live-status for the JKAI launcher badges. Owner-gated by hooks.
 * Best-effort — any branch that fails just omits its badge.
 */
export const GET: RequestHandler = async () => {
  let monitors = { active: 0, total: 0 };
  try {
    const list = await listMonitors();
    monitors = { active: list.filter((m) => m.enabled).length, total: list.length };
  } catch {
    /* omit */
  }

  let briefing: { latest: string | null } = { latest: null };
  try {
    if (await getCollectionBySlug(BRIEFINGS_COLLECTION)) {
      const { records } = await queryRecords(BRIEFINGS_COLLECTION, { sort: { field: 'createdAt', dir: 'desc' }, limit: 1 }, 'owner');
      const first = records[0]?.data as { startedAt?: string; status?: string } | undefined;
      if (first?.startedAt) briefing = { latest: briefingDateLabel(new Date(first.startedAt)) };
    }
  } catch {
    /* omit */
  }

  return json({ monitors, briefing });
};
