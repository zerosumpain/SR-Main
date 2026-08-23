import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { normaliseLocationHistory, type HAHistoryRow } from '$lib/family-location-history';
import { getHomeAssistantService, initHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { eq } from 'drizzle-orm';

const PEOPLE = ['john', 'katie', 'fintan', 'jemima', 'rory'] as const;
const ENTITY_IDS = PEOPLE.map((person) => `person.${person}`);

function unavailablePeople(error: string) {
  return Object.fromEntries(
    PEOPLE.map((person) => [
      person,
      {
        entityId: `person.${person}`,
        status: 'unavailable' as const,
        error,
        transitions: [],
        visits: [],
        summary: { awaySeconds: 0, outings: 0, latestState: 'unknown' as const },
      },
    ]),
  );
}

function historyByEntity(data: unknown): Map<string, HAHistoryRow[]> {
  const histories = Array.isArray(data) ? data : [];
  const byEntity = new Map<string, HAHistoryRow[]>();
  for (const history of histories) {
    if (!Array.isArray(history)) continue;
    const entityId = history.find(
      (row): row is HAHistoryRow =>
        !!row && typeof row === 'object' && typeof (row as HAHistoryRow).entity_id === 'string',
    )?.entity_id;
    if (typeof entityId === 'string') byEntity.set(entityId, history as HAHistoryRow[]);
  }
  return byEntity;
}

export const GET: RequestHandler = async () => {
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 24 * 60 * 60 * 1000);
  const range = { start: start.toISOString(), end: end.toISOString() };
  const generatedAt = new Date().toISOString();

  let service = getHomeAssistantService();
  if (!service.isConfigured()) {
    const [config] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    if (!config?.token) {
      return json(
        { requestedRange: range, generatedAt, people: unavailablePeople('Home Assistant is not configured') },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    service = initHomeAssistantService(config.url, config.token);
  }

  const result = await service.getHistory(ENTITY_IDS.join(','), range.start, range.end);
  if (!result.success) {
    return json(
      {
        requestedRange: range,
        generatedAt,
        people: unavailablePeople(result.error || 'Home Assistant history is unavailable'),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const histories = historyByEntity(result.data);
  const people = Object.fromEntries(
    PEOPLE.map((person) => {
      const entityId = `person.${person}`;
      const rows = histories.get(entityId) ?? [];
      const history = normaliseLocationHistory(rows, range);
      return [
        person,
        {
          entityId,
          status: history.transitions.length ? ('ok' as const) : ('no_data' as const),
          ...history,
        },
      ];
    }),
  );

  return json({ requestedRange: range, generatedAt, people }, { headers: { 'Cache-Control': 'no-store' } });
};
