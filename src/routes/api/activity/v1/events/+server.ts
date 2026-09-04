import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { activityErrorResponse } from '$lib/activity/http.server';
import { EVIDENCE_MODES, type EvidenceMode } from '$lib/activity/contracts';
import { listActivityEvents } from '$lib/activity/store/events.server';

function list(value: string | null): string[] | undefined {
  const items = value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  return items.length ? [...new Set(items)] : undefined;
}

export const GET: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const requestedEvidence = list(event.url.searchParams.get('evidence'));
    const evidenceModes = requestedEvidence?.filter((mode): mode is EvidenceMode =>
      EVIDENCE_MODES.includes(mode as EvidenceMode),
    );
    const events = await listActivityEvents(principal.id, {
      connectionIds: list(event.url.searchParams.get('connection')),
      categories: list(event.url.searchParams.get('category')),
      evidenceModes,
      from: event.url.searchParams.get('from') ?? undefined,
      to: event.url.searchParams.get('to') ?? undefined,
      cursor: event.url.searchParams.get('cursor') ?? undefined,
      limit: event.url.searchParams.has('limit')
        ? Number(event.url.searchParams.get('limit'))
        : undefined,
    });
    return json({ events, nextCursor: null });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
