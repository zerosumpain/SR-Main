import type { ActivityConnectionContext, ActivityEventV1 } from '../../contracts';
import { stableActivityId } from '../../store/ids';

export interface AppleMusicResource {
  id: string;
  type: string;
  href?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    url?: string;
  };
}

export interface AppleMusicCursor {
  generation?: number;
  recentIds?: string[];
  observedAt?: string;
}

export function normaliseAppleMusicRecent(input: {
  context: ActivityConnectionContext;
  resources: AppleMusicResource[];
  previous?: AppleMusicCursor | null;
}): { events: ActivityEventV1[]; cursor: AppleMusicCursor } {
  const unique = input.resources.filter(
    (resource, index, all) =>
      typeof resource.id === 'string' &&
      resource.id.length > 0 &&
      all.findIndex((candidate) => candidate.id === resource.id) === index,
  );
  const recentIds = unique.map((resource) => resource.id);
  const previousIds = new Set(input.previous?.recentIds ?? []);
  const changed = recentIds.join('\u0000') !== (input.previous?.recentIds ?? []).join('\u0000');
  const generation = changed ? (input.previous?.generation ?? 0) + 1 : (input.previous?.generation ?? 0);
  const events = unique.flatMap((resource, index): ActivityEventV1[] => {
    if (previousIds.has(resource.id)) return [];
    const attributes = resource.attributes ?? {};
    return [
      {
        id: stableActivityId('aevt', [
          input.context.connectionId,
          'apple-music-recent',
          generation,
          resource.id,
        ]),
        schemaVersion: 1,
        principalId: input.context.principalId,
        connectionId: input.context.connectionId,
        source: 'apple_music',
        type: 'media.track.recently_seen',
        category: 'music',
        subjectKey: input.context.principalId,
        // The API returns list order, not a per-play timestamp.
        occurredAt: null,
        observedAt: input.context.observedAt,
        evidenceMode: 'provider_snapshot',
        actor: { providerId: input.context.providerAccountId ?? undefined },
        object: {
          providerId: resource.id,
          kind: resource.type || 'song',
          label: attributes.name || `Apple Music item ${resource.id}`,
          url: attributes.url,
        },
        measures: {
          recent_rank: index + 1,
          artist_name: attributes.artistName ?? null,
          album_name: attributes.albumName ?? null,
          catalog_duration_ms:
            typeof attributes.durationInMillis === 'number'
              ? Math.max(0, Math.floor(attributes.durationInMillis))
              : null,
        },
        provenance: {
          providerObjectId: resource.id,
          providerRevision: String(generation),
          adapterVersion: 'apple-music-v1',
        },
      },
    ];
  });
  return {
    events,
    cursor: { generation, recentIds, observedAt: input.context.observedAt },
  };
}
