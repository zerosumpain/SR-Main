import { getCredential } from '$lib/integrations/credentials';
import type { ActivityConnectionContext, ActivityProviderAdapter, ProviderPage } from '../../contracts';
import { ActivitySyncError } from '../../sync/errors';
import { appleMusicManifest } from './manifest';
import { createAppleMusicDeveloperToken, loadAppleMusicDeveloperTokenConfig } from './developer-token.server';
import {
  normaliseAppleMusicRecent,
  type AppleMusicCursor,
  type AppleMusicResource,
} from './normalise';

interface AppleMusicResponse {
  data?: AppleMusicResource[];
  errors?: Array<{ title?: string; detail?: string; status?: string }>;
}

async function readMusicUserToken(context: ActivityConnectionContext): Promise<string> {
  if (!context.credentialId) throw new ActivitySyncError('credential', 'Apple Music authorization is missing');
  const credential = await getCredential<'apikey'>(context.credentialId);
  if (!credential || credential.integrationType !== 'apple_music' || credential.kind !== 'apikey') {
    throw new ActivitySyncError('credential', 'Apple Music authorization is invalid');
  }
  return credential.payload.key;
}

async function fetchRecentTracks(
  context: ActivityConnectionContext,
  fetchFn: typeof fetch = fetch,
): Promise<AppleMusicResource[]> {
  const userToken = await readMusicUserToken(context);
  let developerToken: string;
  try {
    developerToken = createAppleMusicDeveloperToken(loadAppleMusicDeveloperTokenConfig()).token;
  } catch (error) {
    throw new ActivitySyncError(
      'credential',
      error instanceof Error ? error.message : 'Apple Music developer credentials are invalid',
    );
  }
  let response: Response;
  try {
    response = await fetchFn('https://api.music.apple.com/v1/me/recent/played/tracks?limit=30', {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${developerToken}`,
        'music-user-token': userToken,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ActivitySyncError(
      'temporary_provider',
      `Apple Music request did not complete: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new ActivitySyncError('credential', 'Apple Music authorization has expired or was revoked');
  }
  if (response.status === 429) {
    const retrySeconds = Number(response.headers.get('retry-after'));
    throw new ActivitySyncError(
      'rate_limited',
      'Apple Music rate limited the activity sync',
      Number.isFinite(retrySeconds) ? new Date(Date.now() + retrySeconds * 1_000) : undefined,
    );
  }
  if (!response.ok) {
    throw new ActivitySyncError('temporary_provider', `Apple Music returned HTTP ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as AppleMusicResponse | null;
  if (!payload || !Array.isArray(payload.data)) {
    throw new ActivitySyncError('invalid_payload', 'Apple Music returned an invalid recent-tracks response');
  }
  return payload.data;
}

async function* syncAppleMusic(context: ActivityConnectionContext): AsyncIterable<ProviderPage> {
  const resources = await fetchRecentTracks(context);
  const normalized = normaliseAppleMusicRecent({
    context,
    resources,
    previous: (context.cursor ?? null) as AppleMusicCursor | null,
  });
  yield {
    events: normalized.events,
    nextCursor: normalized.cursor as unknown as Record<string, unknown>,
    hasMore: false,
  };
}

export const appleMusicActivityProvider: ActivityProviderAdapter = {
  manifest: appleMusicManifest,
  async testConnection(context) {
    try {
      await fetchRecentTracks(context);
      return { status: 'healthy', message: 'Apple Music recent tracks are available' };
    } catch (error) {
      if (error instanceof ActivitySyncError) {
        if (error.kind === 'credential') return { status: 'credential_error', message: error.message };
        if (error.kind === 'rate_limited') {
          return { status: 'rate_limited', message: error.message, retryAt: error.retryAt?.toISOString() };
        }
      }
      return { status: 'provider_error', message: error instanceof Error ? error.message : 'Apple Music check failed' };
    }
  },
  sync: syncAppleMusic,
};
