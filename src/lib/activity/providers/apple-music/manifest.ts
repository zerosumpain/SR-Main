import type { ProviderManifest } from '../../contracts';

export const appleMusicManifest: ProviderManifest = {
  id: 'apple_music',
  name: 'Apple Music',
  category: 'music_podcasts',
  description: 'Recently played music through MusicKit.',
  // The adapter is implemented, but the launch gate stays closed until its
  // authorization and response semantics are exercised with the owner account.
  availability: 'planned',
  availabilityNote:
    'Live snapshot: recent items do not include a reliable time or duration for each play.',
  modes: ['oauth'],
  evidenceModes: ['provider_snapshot'],
  eventTypes: ['media.track.recently_seen'],
  dataClasses: ['metadata', 'activity'],
  scopes: [
    {
      id: 'music_user_token',
      label: 'Apple Music account',
      description: 'Read the recent tracks MusicKit makes available.',
      dataClasses: ['metadata', 'activity'],
      required: true,
    },
  ],
  supportsIncrementalSync: true,
  supportsBackfill: false,
  supportsWebhooks: false,
  requiredSecrets: ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID', 'APPLE_MUSIC_PRIVATE_KEY'],
  policyGate: 'Enable only after a live owner-account fixture confirms MusicKit behavior.',
};
