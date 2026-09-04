import type {
  ActivityConnectionContext,
  ActivityEventV1,
  ActivityProviderAdapter,
  ProviderPage,
} from '../../contracts';

export const fixtureManifest: ActivityProviderAdapter['manifest'] = {
  id: 'fixture',
  name: 'Activity fixture',
  category: 'games',
  description: 'Deterministic local records used to prove the activity fabric.',
  availability: 'available',
  availabilityNote: 'Test and local development only.',
  modes: ['api_key', 'import'],
  evidenceModes: [
    'provider_event',
    'provider_snapshot',
    'inferred_delta',
    'archive_import',
    'device_observation',
  ],
  eventTypes: [
    'fixture.event.observed',
    'fixture.snapshot.observed',
    'fixture.delta.observed',
    'fixture.archive.observed',
    'fixture.device.observed',
  ],
  dataClasses: ['metadata', 'activity', 'raw_content'],
  scopes: [],
  supportsIncrementalSync: true,
  supportsBackfill: true,
  supportsWebhooks: false,
  requiredSecrets: [],
  hidden: true,
};

function event(
  context: ActivityConnectionContext,
  index: number,
  evidenceMode: ActivityEventV1['evidenceMode'],
  type: string,
): ActivityEventV1 {
  const hasOccurrence = evidenceMode !== 'provider_snapshot';
  return {
    id: `fixture:${context.connectionId}:${index}`,
    schemaVersion: 1,
    principalId: context.principalId,
    connectionId: context.connectionId,
    source: 'fixture',
    type,
    category: 'testing',
    subjectKey: context.principalId,
    occurredAt: hasOccurrence ? new Date(Date.parse(context.observedAt) - index * 60_000).toISOString() : null,
    observedAt: context.observedAt,
    evidenceMode,
    actor: { providerId: 'fixture-owner', label: 'Fixture owner' },
    object: { providerId: `object-${index}`, kind: 'fixture_item', label: `Fixture ${index}` },
    measures: { sequence: index },
    provenance: {
      providerObjectId: `object-${index}`,
      providerRevision: '1',
      adapterVersion: 'fixture-v1',
    },
  };
}

const FIXTURE_EVENTS: Array<[ActivityEventV1['evidenceMode'], string]> = [
  ['provider_event', 'fixture.event.observed'],
  ['provider_snapshot', 'fixture.snapshot.observed'],
  ['inferred_delta', 'fixture.delta.observed'],
  ['archive_import', 'fixture.archive.observed'],
  ['device_observation', 'fixture.device.observed'],
];

export const fixtureActivityProvider: ActivityProviderAdapter = {
  manifest: fixtureManifest,
  async testConnection() {
    return { status: 'healthy', message: 'Fixture provider is ready' };
  },
  async *sync(context): AsyncIterable<ProviderPage> {
    const start = Number(context.cursor?.offset ?? 0);
    const pageSize = 2;
    for (let offset = start; offset < FIXTURE_EVENTS.length; offset += pageSize) {
      const slice = FIXTURE_EVENTS.slice(offset, offset + pageSize);
      const nextOffset = offset + slice.length;
      yield {
        events: slice.map(([mode, type], index) => event(context, offset + index, mode, type)),
        nextCursor: { offset: nextOffset },
        hasMore: nextOffset < FIXTURE_EVENTS.length,
      };
    }
  },
};
