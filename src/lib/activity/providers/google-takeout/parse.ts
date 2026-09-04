import type { ActivityConnectionContext, ActivityEventV1 } from '../../contracts';
import { stableActivityId } from '../../store/ids';

interface TakeoutSubtitle {
  name?: unknown;
  url?: unknown;
}

interface TakeoutHistoryItem {
  header?: unknown;
  title?: unknown;
  titleUrl?: unknown;
  subtitles?: unknown;
  time?: unknown;
  products?: unknown;
}

export interface TakeoutParseReport {
  events: ActivityEventV1[];
  rejected: Array<{ index: number; reason: string }>;
  dateRange: { from: string; to: string } | null;
  musicRecords: number;
  videoRecords: number;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function videoId(urlValue: string | null): string | null {
  if (!urlValue) return null;
  try {
    const url = new URL(urlValue);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
    if (url.hostname.endsWith('youtube.com')) return url.searchParams.get('v');
  } catch {
    return null;
  }
  return null;
}

function isExplicitYouTubeMusic(item: TakeoutHistoryItem): boolean {
  const products = Array.isArray(item.products)
    ? item.products.filter((value): value is string => typeof value === 'string')
    : [];
  return [text(item.header), ...products]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase() === 'youtube music');
}

function cleanTitle(value: string): string {
  return value.replace(/^(watched|listened to)\s+/i, '').trim() || value;
}

function subtitleName(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value as TakeoutSubtitle[]) {
    const name = text(candidate?.name);
    if (name) return name;
  }
  return null;
}

export function parseYouTubeTakeoutHistory(input: {
  value: unknown;
  context: ActivityConnectionContext;
  importId: string;
}): TakeoutParseReport {
  if (!Array.isArray(input.value)) throw new Error('YouTube Takeout watch history must be a JSON array');
  const events: ActivityEventV1[] = [];
  const rejected: TakeoutParseReport['rejected'] = [];
  const duplicateOrdinals = new Map<string, number>();
  let musicRecords = 0;
  let videoRecords = 0;

  for (const [index, raw] of input.value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      rejected.push({ index, reason: 'record is not an object' });
      continue;
    }
    const item = raw as TakeoutHistoryItem;
    const title = text(item.title);
    const occurredAt = text(item.time);
    if (!title || !occurredAt || !Number.isFinite(Date.parse(occurredAt))) {
      rejected.push({ index, reason: 'record has no usable title/time' });
      continue;
    }
    const titleUrl = text(item.titleUrl);
    const providerId = videoId(titleUrl) ?? titleUrl ?? `${title}:${occurredAt}`;
    const fingerprint = stableActivityId('ytfp', [providerId, occurredAt, title]);
    const ordinal = duplicateOrdinals.get(fingerprint) ?? 0;
    duplicateOrdinals.set(fingerprint, ordinal + 1);
    const music = isExplicitYouTubeMusic(item);
    if (music) musicRecords++;
    else videoRecords++;

    events.push({
      id: stableActivityId('aevt', [input.context.connectionId, input.importId, fingerprint, ordinal]),
      schemaVersion: 1,
      principalId: input.context.principalId,
      connectionId: input.context.connectionId,
      source: 'youtube_takeout',
      // Never classify from the title, channel or URL. Only an explicit
      // product/header marker may turn a generic video view into music.
      type: music ? 'media.track.listened' : 'media.video.watched',
      category: music ? 'music' : 'video',
      subjectKey: input.context.principalId,
      occurredAt: new Date(occurredAt).toISOString(),
      observedAt: input.context.observedAt,
      evidenceMode: 'archive_import',
      actor: { providerId: input.context.providerAccountId ?? undefined },
      object: {
        providerId,
        kind: music ? 'track_or_music_video' : 'video',
        label: cleanTitle(title),
        url: titleUrl ?? undefined,
      },
      measures: {
        service_product: music ? 'youtube_music' : 'youtube',
        channel_name: subtitleName(item.subtitles),
      },
      provenance: {
        providerObjectId: providerId,
        importId: input.importId,
        adapterVersion: 'google-takeout-v1',
      },
    });
  }

  const times = events.map((event) => event.occurredAt!).sort();
  return {
    events,
    rejected,
    dateRange: times.length ? { from: times[0], to: times[times.length - 1] } : null,
    musicRecords,
    videoRecords,
  };
}
