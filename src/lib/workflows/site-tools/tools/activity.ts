/**
 * The `activity` toolset — jkai's read-only window onto the personal activity
 * fabric (Steam, archives, and whatever connects next).
 *
 * Four provider-neutral tools, per the fabric spec (M5.1). The model never
 * receives a provider token, a raw payload, or a tool per provider. Every
 * response carries `coverage`, so "I found no activity" is never mistaken for
 * "there was no activity": a source the owner has not granted to jkai reads
 * as `unavailable`, not as empty.
 *
 * Principal resolution is fixed to the owner (phase one) and is never a tool
 * argument.
 */
import { register } from '../registry-internal';
import { optionalString } from '../tool-args';

const CATEGORY = 'Personal data';
const TOOLSET = 'activity';
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

function daysArg(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.floor(n));
}

function stringArg(args: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = optionalString(args, name);
    if (value) return value;
  }
  return null;
}

async function loadSources() {
  const [{ ensureOwnerActivityPrincipal }, { listActivityConnections }, { consumerGrantMap, consumerMayRead }, { getCatalogProvider }, { connectionCoverage, overallCoverage }] =
    await Promise.all([
      import('$lib/activity/store/principals.server'),
      import('$lib/activity/store/connections.server'),
      import('$lib/activity/policy/consumer-access.server'),
      import('$lib/activity/providers/catalog'),
      import('$lib/activity/policy/coverage'),
    ]);
  const principal = await ensureOwnerActivityPrincipal();
  const [connections, grants] = await Promise.all([
    listActivityConnections(principal.id),
    consumerGrantMap(principal.id, 'jkai'),
  ]);
  const now = new Date();
  const sources = connections.map((connection) => {
    const manifest = getCatalogProvider(connection.provider)?.manifest;
    const readsActivity = consumerMayRead(grants, connection.id, 'activity');
    const readsMetadata = consumerMayRead(grants, connection.id, 'metadata');
    return {
      id: connection.id,
      provider: connection.provider,
      providerName: manifest?.name ?? connection.provider,
      label: connection.label,
      category: manifest?.category ?? null,
      mode: connection.mode,
      status: connection.status,
      health: connection.healthStatus,
      healthMessage: connection.healthMessage,
      lastSyncSucceededAt: connection.lastSyncSucceededAt,
      evidenceModes: manifest?.evidenceModes ?? [],
      grants: { activity: readsActivity, metadata: readsMetadata },
      coverage: connectionCoverage(
        {
          status: connection.status,
          mode: connection.mode,
          evidenceModes: manifest?.evidenceModes ?? [],
          lastSyncSucceededAt: connection.lastSyncSucceededAt,
          readable: readsActivity,
        },
        now,
      ),
    };
  });
  return {
    principalId: principal.id,
    grants,
    sources,
    overall: overallCoverage(sources.map((source) => source.coverage)),
  };
}

register({
  name: 'activity_sources',
  description:
    'List the personal activity sources (Steam, archives, music) connected on /jkai/sources: status, freshness, which data classes jkai may read, and a coverage word. Call this first when asked about games played, listening, or "my activity" — an empty list means nothing is connected, not that nothing happened.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: CATEGORY,
  toolset: TOOLSET,
  handler: async () => {
    const { sources, overall } = await loadSources();
    return {
      success: true,
      data: {
        coverage: overall,
        sources,
        note:
          sources.length === 0
            ? 'No activity sources are connected. The owner adds one at /jkai/sources.'
            : sources.some((source) => !source.grants.activity)
              ? 'Some sources are not granted to jkai; their activity is unavailable, not absent. The owner changes this at /jkai/settings/data-access.'
              : undefined,
      },
    };
  },
});

register({
  name: 'activity_summary',
  description:
    'Aggregate the activity jkai may read over a window: counts by source, category and event type, the evidence mix (provider event / snapshot / inferred / archive), and the objects that recur most (game titles, tracks). Snapshot evidence records recency, never duration. Defaults to the last 30 days.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Window length ending now, 1–366. Default 30.' },
      connectionId: { type: 'string', description: 'Restrict to one source id from activity_sources.' },
    },
    required: [],
  },
  category: CATEGORY,
  toolset: TOOLSET,
  handler: async (args) => {
    const [{ summariseActivityEvents, topActivityObjects }, { consumerMayRead }] = await Promise.all([
      import('$lib/activity/store/summary.server'),
      import('$lib/activity/policy/consumer-access.server'),
    ]);
    const { principalId, grants, sources, overall } = await loadSources();
    const days = daysArg(args.days);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const only = stringArg(args, 'connectionId', 'connection_id', 'sourceId', 'source_id');
    const readable = sources.filter(
      (source) => source.grants.activity && (!only || source.id === only),
    );
    if (only && !sources.some((source) => source.id === only)) {
      return { success: false, error: `No activity source with id ${only}. Call activity_sources for the list.` };
    }
    const ids = readable.map((source) => source.id);
    const metadataIds = ids.filter((id) => consumerMayRead(grants, id, 'metadata'));
    const [rows, top] = await Promise.all([
      summariseActivityEvents(principalId, { connectionIds: ids, from, to }),
      topActivityObjects(principalId, { connectionIds: metadataIds, from, to, limit: 15 }),
    ]);
    const byId = new Map(sources.map((source) => [source.id, source]));
    const evidenceMix: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const row of rows) {
      evidenceMix[row.evidenceMode] = (evidenceMix[row.evidenceMode] ?? 0) + row.count;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + row.count;
    }
    return {
      success: true,
      data: {
        window: { from: from.toISOString(), to: to.toISOString(), days },
        coverage: only ? (byId.get(only)?.coverage ?? 'unavailable') : overall,
        sources: readable.map((source) => ({
          id: source.id,
          providerName: source.providerName,
          label: source.label,
          coverage: source.coverage,
          lastSyncSucceededAt: source.lastSyncSucceededAt,
          events: rows
            .filter((row) => row.connectionId === source.id)
            .map(({ connectionId: _connectionId, ...rest }) => rest),
        })),
        byCategory,
        evidenceMix,
        topObjects: top.map((item) => ({
          source: byId.get(item.connectionId)?.label ?? item.connectionId,
          kind: item.kind,
          label: item.label,
          count: item.count,
          lastAt: item.lastAt,
        })),
        unavailable: sources
          .filter((source) => !source.grants.activity)
          .map((source) => ({ id: source.id, label: source.label, reason: 'not granted to jkai' })),
        caveats: [
          'A count is a count of evidence records, not of sessions or minutes.',
          'provider_snapshot and inferred_delta describe order and change between syncs, not exact times.',
        ],
      },
    };
  },
});

register({
  name: 'activity_search',
  description:
    'Search activity event metadata (titles and event types) across the sources jkai may read. Returns at most 25 rows, newest first, with evidence mode and provenance ids — never raw provider payloads.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Substring to match against object labels and event types.' },
      limit: { type: 'number', description: 'Rows to return, 1–25. Default 25.' },
      connectionId: { type: 'string', description: 'Restrict to one source id.' },
    },
    required: ['query'],
  },
  category: CATEGORY,
  toolset: TOOLSET,
  handler: async (args) => {
    const query = stringArg(args, 'query', 'q', 'text');
    if (!query) return { success: false, error: 'query is required' };
    const { searchActivityEvents } = await import('$lib/activity/store/summary.server');
    const { principalId, sources, overall } = await loadSources();
    const only = stringArg(args, 'connectionId', 'connection_id', 'sourceId', 'source_id');
    const ids = sources
      .filter((source) => source.grants.activity && source.grants.metadata && (!only || source.id === only))
      .map((source) => source.id);
    const rows = await searchActivityEvents(principalId, {
      connectionIds: ids,
      query,
      limit: Number(args.limit) || undefined,
    });
    const byId = new Map(sources.map((source) => [source.id, source]));
    return {
      success: true,
      data: {
        coverage: overall,
        query,
        results: rows.map((row) => ({
          id: row.id,
          source: byId.get(row.connectionId)?.label ?? row.source,
          type: row.type,
          category: row.category,
          occurredAt: row.occurredAt,
          observedAt: row.observedAt,
          evidenceMode: row.evidenceMode,
          object: {
            kind: row.object.kind ?? null,
            label: row.object.label ?? null,
            url: row.object.url ?? null,
          },
          measures: row.measures,
        })),
        searchedSources: ids.length,
      },
    };
  },
});

register({
  name: 'activity_get',
  description:
    'Fetch one activity event by id with its provenance (provider object id, revision, adapter version, import id). Use after activity_search when the owner asks where a record came from.',
  parameters: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'Event id from activity_search or activity_summary.' },
    },
    required: ['eventId'],
  },
  category: CATEGORY,
  toolset: TOOLSET,
  handler: async (args) => {
    const eventId = stringArg(args, 'eventId', 'event_id', 'id');
    if (!eventId) return { success: false, error: 'eventId is required' };
    const [{ getActivityEvent }, { consumerMayRead }] = await Promise.all([
      import('$lib/activity/store/events.server'),
      import('$lib/activity/policy/consumer-access.server'),
    ]);
    const { principalId, grants, sources } = await loadSources();
    const row = await getActivityEvent(principalId, eventId);
    if (!row || row.tombstonedAt || row.hiddenAt || !row.isCurrent) {
      return { success: false, error: 'No current activity event with that id' };
    }
    if (!consumerMayRead(grants, row.connectionId, 'activity')) {
      return {
        success: false,
        error: 'That event belongs to a source the owner has not granted to jkai (coverage: unavailable).',
      };
    }
    const metadata = consumerMayRead(grants, row.connectionId, 'metadata');
    const source = sources.find((item) => item.id === row.connectionId);
    return {
      success: true,
      data: {
        id: row.id,
        source: source?.label ?? row.source,
        type: row.type,
        category: row.category,
        occurredAt: row.occurredAt,
        observedAt: row.observedAt,
        evidenceMode: row.evidenceMode,
        object: metadata
          ? { kind: row.object.kind ?? null, label: row.object.label ?? null, url: row.object.url ?? null }
          : { kind: row.object.kind ?? null },
        measures: row.measures,
        provenance: row.provenance,
        revision: row.revision,
        supersedesEventId: row.supersedesEventId,
      },
    };
  },
});
