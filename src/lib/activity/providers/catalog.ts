import type { ActivityProviderAdapter, ProviderManifest } from '../contracts';
import { fixtureActivityProvider } from './fixture/adapter';
import { registerActivityProvider, listActivityProviders, getActivityProvider } from './registry';
import { steamActivityProvider } from './steam/adapter.server';
import { appleMusicActivityProvider } from './apple-music/adapter.server';
import { googleTakeoutActivityProvider } from './google-takeout/adapter.server';

function catalogOnly(manifest: ProviderManifest): ActivityProviderAdapter {
  return { manifest };
}

const catalogueProviders: ActivityProviderAdapter[] = [
  steamActivityProvider,
  appleMusicActivityProvider,
  googleTakeoutActivityProvider,
  catalogOnly({
    id: 'apple_podcasts',
    name: 'Apple Podcasts',
    category: 'music_podcasts',
    description: 'Podcast listening evidence from a verified archive or future device bridge.',
    availability: 'planned',
    availabilityNote: 'A usable import depends on what a real Apple privacy export contains.',
    modes: ['import', 'device'],
    evidenceModes: ['archive_import', 'device_observation'],
    eventTypes: ['podcast.episode.played', 'podcast.episode.recently_seen'],
    dataClasses: ['metadata', 'activity'],
    scopes: [],
    supportsIncrementalSync: false,
    supportsBackfill: true,
    supportsWebhooks: false,
    requiredSecrets: [],
    policyGate: 'Do not enable import until an owner export fixture proves playback fields.',
  }),
  catalogOnly({
    id: 'github',
    name: 'GitHub',
    category: 'work',
    description: 'Account events and contribution activity.',
    availability: 'planned',
    availabilityNote: 'GitHub App connection follows the first gaming and media sources.',
    modes: ['oauth'],
    evidenceModes: ['provider_event'],
    eventTypes: ['code.event.observed'],
    dataClasses: ['metadata', 'activity', 'raw_content'],
    scopes: [],
    supportsIncrementalSync: true,
    supportsBackfill: true,
    supportsWebhooks: true,
    requiredSecrets: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
  }),
  catalogOnly({
    id: 'reddit_archive',
    name: 'Reddit',
    category: 'social',
    description: 'Posts, comments, votes and saved items from your account archive.',
    availability: 'planned',
    availabilityNote: 'Archive import first; a live connection requires Reddit approval.',
    modes: ['import'],
    evidenceModes: ['archive_import'],
    eventTypes: [
      'social.post.created',
      'social.comment.created',
      'social.vote.recorded',
      'social.saved.changed',
    ],
    dataClasses: ['metadata', 'activity', 'raw_content'],
    scopes: [],
    supportsIncrementalSync: false,
    supportsBackfill: true,
    supportsWebhooks: false,
    requiredSecrets: [],
    policyGate: 'Live OAuth remains disabled until Reddit grants API access.',
  }),
];

export function ensureActivityProvidersRegistered(options: { includeFixture?: boolean } = {}): void {
  for (const provider of catalogueProviders) {
    if (!getActivityProvider(provider.manifest.id)) registerActivityProvider(provider);
  }
  if (options.includeFixture && !getActivityProvider(fixtureActivityProvider.manifest.id)) {
    registerActivityProvider(fixtureActivityProvider);
  }
}

export function getCatalogProvider(id: string): ActivityProviderAdapter | null {
  ensureActivityProvidersRegistered({ includeFixture: id === fixtureActivityProvider.manifest.id });
  return getActivityProvider(id);
}

export function listCatalogProviders(): ProviderManifest[] {
  ensureActivityProvidersRegistered();
  return listActivityProviders().filter((manifest) => !manifest.hidden);
}
