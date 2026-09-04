import type {
  ActivityConnectionContext,
  ActivityProviderAdapter,
  ProviderPage,
} from '../../contracts';
import { ActivitySyncError } from '../../sync/errors';
import { steamManifest } from './manifest';
import {
  normaliseSteamSnapshot,
  type SteamAchievementSnapshot,
  type SteamCursor,
  type SteamGameSnapshot,
} from './normalise';

const API_ROOT = 'https://api.steampowered.com';
const PAGE_SIZE = 100;
const ACHIEVEMENT_GAME_LIMIT = 8;

interface SteamOwnedResponse {
  response?: { game_count?: number; games?: SteamGameSnapshot[] };
}

interface SteamRecentResponse {
  response?: { total_count?: number; games?: SteamGameSnapshot[] };
}

interface SteamSummaryResponse {
  response?: { players?: Array<{ steamid?: string; personaname?: string }> };
}

interface SteamAchievementsResponse {
  playerstats?: {
    success?: boolean;
    achievements?: SteamAchievementSnapshot[];
  };
}

async function steamGet<T>(
  path: string,
  params: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const key = process.env.STEAM_WEB_API_KEY;
  if (!key) throw new ActivitySyncError('credential', 'Steam Web API key is not configured');
  const url = new URL(path, API_ROOT);
  url.searchParams.set('key', key);
  url.searchParams.set('format', 'json');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ActivitySyncError(
      'temporary_provider',
      `Steam request did not complete: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new ActivitySyncError('credential', `Steam rejected the server credential (HTTP ${response.status})`);
  }
  if (response.status === 429) {
    const retrySeconds = Number(response.headers.get('retry-after'));
    throw new ActivitySyncError(
      'rate_limited',
      'Steam rate limited the activity sync',
      Number.isFinite(retrySeconds) ? new Date(Date.now() + retrySeconds * 1_000) : undefined,
    );
  }
  if (!response.ok) {
    throw new ActivitySyncError('temporary_provider', `Steam returned HTTP ${response.status}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ActivitySyncError('invalid_payload', 'Steam returned invalid JSON');
  }
}

async function readSteamSnapshot(context: ActivityConnectionContext) {
  const steamId = context.providerAccountId;
  if (!steamId || !/^\d{17}$/.test(steamId)) {
    throw new ActivitySyncError('credential', 'Steam account identity is missing');
  }
  const [owned, recent, summary] = await Promise.all([
    steamGet<SteamOwnedResponse>('/IPlayerService/GetOwnedGames/v0001/', {
      steamid: steamId,
      include_appinfo: '1',
      include_played_free_games: '1',
    }),
    steamGet<SteamRecentResponse>('/IPlayerService/GetRecentlyPlayedGames/v0001/', {
      steamid: steamId,
      count: '50',
    }),
    steamGet<SteamSummaryResponse>('/ISteamUser/GetPlayerSummaries/v0002/', {
      steamids: steamId,
    }),
  ]);
  if (owned.response?.game_count === undefined) {
    throw new ActivitySyncError('private_source', 'Steam game details are private or unavailable');
  }
  const games = Array.isArray(owned.response.games) ? owned.response.games : [];
  const recentGames = Array.isArray(recent.response?.games) ? recent.response.games : [];
  const recentRanks = new Map(recentGames.map((game, index) => [game.appid, index + 1]));
  const accountLabel = summary.response?.players?.[0]?.personaname;

  const achievementGroups: Array<{ appid: number; values: SteamAchievementSnapshot[] }> = [];
  for (const game of recentGames.slice(0, ACHIEVEMENT_GAME_LIMIT)) {
    try {
      const response = await steamGet<SteamAchievementsResponse>(
        '/ISteamUserStats/GetPlayerAchievements/v0001/',
        { steamid: steamId, appid: String(game.appid), l: 'english' },
      );
      if (response.playerstats?.success && Array.isArray(response.playerstats.achievements)) {
        achievementGroups.push({ appid: game.appid, values: response.playerstats.achievements });
      }
    } catch (error) {
      // A game without public achievement stats must not fail the account sync.
      if (error instanceof ActivitySyncError && error.kind === 'rate_limited') throw error;
    }
  }
  return { games, achievementGroups, recentRanks, accountLabel };
}

async function* syncSteam(context: ActivityConnectionContext): AsyncIterable<ProviderPage> {
  const snapshot = await readSteamSnapshot(context);
  const normalized = normaliseSteamSnapshot({
    context,
    games: snapshot.games,
    achievements: snapshot.achievementGroups,
    previous: (context.cursor ?? null) as SteamCursor | null,
    recentRanks: snapshot.recentRanks,
    accountLabel: snapshot.accountLabel,
  });

  if (normalized.events.length === 0) {
    yield {
      events: [],
      nextCursor: normalized.cursor as unknown as Record<string, unknown>,
      hasMore: false,
      warnings: normalized.warnings,
    };
    return;
  }
  for (let offset = 0; offset < normalized.events.length; offset += PAGE_SIZE) {
    const events = normalized.events.slice(offset, offset + PAGE_SIZE);
    const final = offset + events.length >= normalized.events.length;
    yield {
      events,
      nextCursor: final ? (normalized.cursor as unknown as Record<string, unknown>) : undefined,
      hasMore: !final,
      warnings: final ? normalized.warnings : undefined,
    };
  }
}

export const steamActivityProvider: ActivityProviderAdapter = {
  manifest: steamManifest,
  async testConnection(context) {
    try {
      await readSteamSnapshot(context);
      return { status: 'healthy', message: 'Steam game details are available' };
    } catch (error) {
      if (error instanceof ActivitySyncError) {
        if (error.kind === 'private_source') return { status: 'private', message: error.message };
        if (error.kind === 'rate_limited') {
          return { status: 'rate_limited', message: error.message, retryAt: error.retryAt?.toISOString() };
        }
        if (error.kind === 'credential') return { status: 'credential_error', message: error.message };
      }
      return { status: 'provider_error', message: error instanceof Error ? error.message : 'Steam check failed' };
    }
  },
  sync: syncSteam,
};
