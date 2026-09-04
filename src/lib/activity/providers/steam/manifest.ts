import type { ProviderManifest } from '../../contracts';

export const steamManifest: ProviderManifest = {
  id: 'steam',
  name: 'Steam',
  category: 'games',
  description: 'Games, achievements and playtime changes.',
  availability: 'beta',
  availabilityNote:
    'Playtime is a cumulative snapshot. JKAI can infer a change between syncs, not an exact game session.',
  modes: ['openid'],
  evidenceModes: ['provider_event', 'provider_snapshot', 'inferred_delta'],
  eventTypes: ['game.playtime.changed', 'game.achievement.unlocked', 'game.library.observed'],
  dataClasses: ['metadata', 'activity'],
  scopes: [],
  supportsIncrementalSync: true,
  supportsBackfill: true,
  supportsWebhooks: false,
  requiredSecrets: ['STEAM_WEB_API_KEY'],
};
