import type { ProviderManifest } from '../../contracts';

export const googleTakeoutManifest: ProviderManifest = {
  id: 'youtube_takeout',
  name: 'YouTube Music',
  category: 'music_podcasts',
  description: 'YouTube and YouTube Music history from an archive you export.',
  availability: 'planned',
  availabilityNote: 'Import only: the YouTube API does not expose watch history.',
  modes: ['import'],
  evidenceModes: ['archive_import'],
  eventTypes: ['media.video.watched', 'media.track.listened'],
  dataClasses: ['metadata', 'activity'],
  scopes: [],
  supportsIncrementalSync: false,
  supportsBackfill: true,
  supportsWebhooks: false,
  requiredSecrets: [],
  policyGate:
    'Enable only after an owner fixture confirms format; cross-source projections require policy review.',
};
