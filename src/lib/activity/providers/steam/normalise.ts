import type { ActivityConnectionContext, ActivityEventV1 } from '../../contracts';
import { stableActivityId } from '../../store/ids';

export interface SteamGameSnapshot {
  appid: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
}

export interface SteamAchievementSnapshot {
  apiname: string;
  achieved: number;
  unlocktime: number;
  name?: string;
  description?: string;
}

export interface SteamCursor {
  observedAt?: string;
  games?: Record<string, { playtimeForever: number; lastPlayedAt: number }>;
  achievements?: Record<string, number>;
}

function baseEvent(
  context: ActivityConnectionContext,
  input: Pick<ActivityEventV1, 'id' | 'type' | 'category' | 'occurredAt' | 'evidenceMode' | 'object' | 'measures'>,
  accountLabel?: string,
): ActivityEventV1 {
  return {
    ...input,
    schemaVersion: 1,
    principalId: context.principalId,
    connectionId: context.connectionId,
    source: 'steam',
    subjectKey: context.principalId,
    observedAt: context.observedAt,
    actor: {
      providerId: context.providerAccountId ?? undefined,
      label: accountLabel,
    },
    provenance: {
      providerObjectId: input.object.providerId,
      adapterVersion: 'steam-v1',
    },
  };
}

export function normaliseSteamSnapshot(input: {
  context: ActivityConnectionContext;
  games: SteamGameSnapshot[];
  achievements: Array<{ appid: number; values: SteamAchievementSnapshot[] }>;
  previous?: SteamCursor | null;
  recentRanks?: Map<number, number>;
  accountLabel?: string;
}): { events: ActivityEventV1[]; cursor: SteamCursor; warnings: string[] } {
  const events: ActivityEventV1[] = [];
  const warnings: string[] = [];
  const previousGames = input.previous?.games ?? {};
  const previousAchievements = input.previous?.achievements ?? {};
  const games: NonNullable<SteamCursor['games']> = {};
  const achievements: NonNullable<SteamCursor['achievements']> = { ...previousAchievements };

  for (const game of input.games) {
    if (!Number.isInteger(game.appid) || game.appid <= 0) continue;
    const appid = String(game.appid);
    const playtimeForever = Math.max(0, Math.floor(game.playtime_forever ?? 0));
    const lastPlayedAt = Math.max(0, Math.floor(game.rtime_last_played ?? 0));
    games[appid] = { playtimeForever, lastPlayedAt };
    const previous = previousGames[appid];
    const recentRank = input.recentRanks?.get(game.appid);

    if (
      !previous ||
      previous.playtimeForever !== playtimeForever ||
      previous.lastPlayedAt !== lastPlayedAt
    ) {
      events.push(
        baseEvent(
          input.context,
          {
            id: stableActivityId('aevt', [
              input.context.connectionId,
              'library',
              game.appid,
              playtimeForever,
              lastPlayedAt,
            ]),
            type: 'game.library.observed',
            category: 'gaming',
            occurredAt: null,
            evidenceMode: 'provider_snapshot',
            object: {
              providerId: appid,
              kind: 'game',
              label: game.name || `Steam app ${appid}`,
              url: `https://store.steampowered.com/app/${appid}`,
            },
            measures: {
              playtime_forever_minutes: playtimeForever,
              playtime_2weeks_minutes: Math.max(0, Math.floor(game.playtime_2weeks ?? 0)),
              recent_rank: recentRank ?? null,
              last_played_at_epoch: lastPlayedAt || null,
            },
          },
          input.accountLabel,
        ),
      );
    }

    if (previous && playtimeForever > previous.playtimeForever) {
      const delta = playtimeForever - previous.playtimeForever;
      events.push(
        baseEvent(
          input.context,
          {
            id: stableActivityId('aevt', [
              input.context.connectionId,
              'playtime',
              game.appid,
              playtimeForever,
            ]),
            type: 'game.playtime.changed',
            category: 'gaming',
            occurredAt: lastPlayedAt > 0 ? new Date(lastPlayedAt * 1_000).toISOString() : null,
            evidenceMode: 'inferred_delta',
            object: {
              providerId: appid,
              kind: 'game',
              label: game.name || `Steam app ${appid}`,
              url: `https://store.steampowered.com/app/${appid}`,
            },
            measures: {
              delta_minutes: delta,
              previous_total_minutes: previous.playtimeForever,
              current_total_minutes: playtimeForever,
              interval_start: input.previous?.observedAt ?? null,
              interval_end: input.context.observedAt,
            },
          },
          input.accountLabel,
        ),
      );
    } else if (previous && playtimeForever < previous.playtimeForever) {
      warnings.push(`Playtime total decreased for app ${appid}; no negative activity emitted`);
    }
  }

  for (const group of input.achievements) {
    for (const achievement of group.values) {
      if (achievement.achieved !== 1 || achievement.unlocktime <= 0) continue;
      const key = `${group.appid}:${achievement.apiname}`;
      const unlocktime = Math.floor(achievement.unlocktime);
      if (previousAchievements[key] === unlocktime) continue;
      achievements[key] = unlocktime;
      events.push(
        baseEvent(
          input.context,
          {
            id: stableActivityId('aevt', [
              input.context.connectionId,
              'achievement',
              group.appid,
              achievement.apiname,
              unlocktime,
            ]),
            type: 'game.achievement.unlocked',
            category: 'gaming',
            occurredAt: new Date(unlocktime * 1_000).toISOString(),
            evidenceMode: 'provider_event',
            object: {
              providerId: `${group.appid}:${achievement.apiname}`,
              kind: 'achievement',
              label: achievement.name || achievement.apiname,
              url: `https://steamcommunity.com/stats/${group.appid}/achievements`,
            },
            measures: { appid: group.appid },
          },
          input.accountLabel,
        ),
      );
    }
  }

  return {
    events,
    cursor: { observedAt: input.context.observedAt, games, achievements },
    warnings,
  };
}
