// The SR app's photo search in Drive, as Main relays it.
//
// SR-Drive owns the Immich connection (faces with the names John gave them,
// CLIP smart search, OCR, places) and answers its owner-only /api/photos/*
// over the service lane. jkai's photo tools already relay those reads
// (`$lib/owner-data/photos.server`); this module reuses the same query
// builder (`searchPath`, `peoplePath`) and the same classified client
// (`askDrive`), and only reshapes the answer for the phone:
//
//  - every image path is a NATIVE one the phone's credential can open
//    (`api/native/drive/photos/thumb/<uuid>`), built here from the asset's
//    UUID and never copied from Drive's answer;
//  - photos that Immich does not know about still appear: the owner's Drive
//    file index (captions and OCR of images, `searchSpace`'s `semantic`) is
//    asked the same "what's in it" question, its image hits are kept, and any
//    file Immich already returned is dropped so a picture shows once;
//  - each hit says where it came from (`photos` | `drive`).
//
// Owner only, like the jkai tools: Drive's photo lane answers the owner and
// nobody else, so a member's phone (or the owner viewing as one) is refused
// here with a 403 before Drive is asked.

import { error } from '@sveltejs/kit';
import { askDrive } from '$lib/owner-data/photos.server';
import { PhotoArgError, peoplePath, placeName, searchPath, type WireAsset, type WirePerson } from '$lib/owner-data/photos';
import { requestExtracted } from '$lib/server/extracted-app';
import { searchSpace, type AppDriveCaller, type NativeDriveFile } from './native-drive';
import type { NativeRole } from '$lib/server/native-handler';

export const OWNER_ONLY_PHOTOS = 'Photos are the owner’s only.';

/** The photo lane is the owner's own phone only — never a member, nor the owner viewing as one. */
export function requirePhotoOwner(role: NativeRole): void {
  if (role !== 'owner') throw error(403, OWNER_ONLY_PHOTOS);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Immich ids (assets and people) are UUIDs; anything else never reaches Drive. */
export function parsePhotoId(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return UUID.test(v) ? v.toLowerCase() : null;
}

export const nativeThumbPath = (id: string) => `api/native/drive/photos/thumb/${id.toLowerCase()}`;
export const nativePreviewPath = (id: string) => `${nativeThumbPath(id)}?size=preview`;
export const nativeFacePath = (id: string) => `api/native/drive/photos/face/${id.toLowerCase()}`;
/** A Drive file's own bytes, for a hit Immich does not know: the phone downsamples it. */
const nativeFilePath = (id: string) => `api/native/drive/files/${encodeURIComponent(id)}`;

// ---------------------------------------------------------------- the query

/**
 * The phone's query string as the jkai tool's arguments, so `searchPath`
 * builds Drive's query exactly as photo_search does: `person` (repeated or a
 * comma list), `text`, `ocr`, `place`, `from`, `to`, `type`, `limit`, `page`.
 */
export function searchArgs(params: URLSearchParams): Record<string, unknown> {
  const people = params.getAll('person').flatMap((v) => v.split(','));
  const arg = (k: string) => params.get(k) ?? undefined;
  return {
    people,
    text: arg('text'),
    text_in_image: arg('ocr'),
    place: arg('place'),
    from: arg('from'),
    to: arg('to'),
    type: arg('type'),
    limit: arg('limit'),
    page: arg('page'),
  };
}

const trimmed = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

/** The deepest page Drive walks to (SR-Drive `MAX_PAGE`): "more" stops there. */
export const MAX_PAGE = 20;

/**
 * What to ask Drive's file index, or null when it cannot answer the search
 * faithfully. The index knows what an image shows and says (its caption and
 * OCR) but not who is in it, where or when it was taken, and it holds no
 * videos — so it joins only a "what's in it" / "words in it" search with none
 * of those filters, and only on the first page (its hits are not paged).
 */
export function driveIndexQuery(args: Record<string, unknown>): string | null {
  const page = Number(args.page ?? 1);
  if (Number.isFinite(page) && page > 1) return null;
  const people = Array.isArray(args.people) ? args.people.filter((p) => trimmed(p)) : [];
  if (people.length || trimmed(args.place) || trimmed(args.from) || trimmed(args.to) || args.type === 'video') return null;
  const q = [trimmed(args.text), trimmed(args.text_in_image)].filter(Boolean).join(' ').slice(0, 200).trim();
  return q || null;
}

// ---------------------------------------------------------------- the answer

export interface NativePhotoHit {
  /** Unique across both sources: `photos:<uuid>` or `drive:<file id>`. */
  key: string;
  source: 'photos' | 'drive';
  /** The Immich asset, for a `photos` hit. */
  assetId: string | null;
  type: 'photo' | 'video';
  takenAt: string | null;
  timeZone: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  place: string | null;
  people: { id: string; name: string | null }[];
  /** Native paths the phone's credential opens. */
  thumbPath: string;
  previewPath: string;
  /** The Drive file it is, when Drive has one: open it with `files/<id>/meta`. */
  driveFile: { id: string; name: string } | null;
  /** The whole file as the phone's `DriveFile` decodes it — `drive` hits only. */
  file: NativeDriveFile | null;
  /** Why a `drive` hit matched: the index's passage and its score. */
  passage?: string;
  score?: number;
}

export interface NativePhotoSearch {
  connected: boolean;
  reason?: string;
  /** Immich's count of matches, when it has one (smart search has none). */
  total: number | null;
  page: number;
  /** Whether asking for `page + 1` can bring more. */
  hasMore: boolean;
  results: NativePhotoHit[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One Immich asset as the phone draws it, or null for one without a usable id. */
export function photoHit(a: WireAsset): NativePhotoHit | null {
  const id = parsePhotoId(a?.id);
  if (!id) return null;
  const type = a.type === 'video' ? 'video' : 'photo';
  const f = a.driveFile;
  return {
    key: `photos:${id}`,
    source: 'photos',
    assetId: id,
    type,
    takenAt: typeof a.takenAt === 'string' ? a.takenAt : null,
    timeZone: typeof a.timeZone === 'string' ? a.timeZone : null,
    durationSec: type === 'video' && num(a.durationSec) !== null ? Math.round(a.durationSec as number) : null,
    width: num(a.width),
    height: num(a.height),
    place: placeName(a.location),
    people: (Array.isArray(a.people) ? a.people : [])
      .filter((p) => typeof p?.id === 'string')
      .map((p) => ({ id: p.id, name: p.name?.trim() || null })),
    thumbPath: nativeThumbPath(id),
    previewPath: nativePreviewPath(id),
    driveFile: f && typeof f.id === 'string' && f.id && typeof f.name === 'string' ? { id: f.id, name: f.name.slice(0, 255) } : null,
    file: null,
  };
}

/** An image the Drive index matched, as a hit; null for anything but an image. */
export function driveHit(s: { file: NativeDriveFile; score: number; passage: string }): NativePhotoHit | null {
  const f = s.file;
  if (!f || typeof f.id !== 'string' || !f.id || !String(f.mimeType ?? '').toLowerCase().startsWith('image/')) return null;
  const path = nativeFilePath(f.id);
  return {
    key: `drive:${f.id}`,
    source: 'drive',
    assetId: null,
    type: 'photo',
    takenAt: null,
    timeZone: null,
    durationSec: null,
    width: null,
    height: null,
    place: null,
    people: [],
    thumbPath: path,
    previewPath: path,
    driveFile: { id: f.id, name: f.name },
    file: f,
    passage: String(s.passage ?? '').slice(0, 300),
    score: num(s.score) ?? 0,
  };
}

/**
 * Below this the index's likeness is a guess, not a match. Drive's own floor
 * is 0.2 for any passage of any file; a photo search should return only what
 * fits, so its image hits must clear a higher bar.
 */
export const DRIVE_MIN_SCORE = 0.3;

/**
 * The index's image hits beside Immich's: each Drive file once, best score
 * first, none that Immich already returned (by `driveFile.id`).
 */
export function mergeHits(photos: NativePhotoHit[], drive: NativePhotoHit[], minScore = DRIVE_MIN_SCORE): NativePhotoHit[] {
  const seen = new Set(photos.flatMap((p) => (p.driveFile ? [p.driveFile.id] : [])));
  const extra: NativePhotoHit[] = [];
  for (const d of [...drive].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    if (!d.driveFile || seen.has(d.driveFile.id) || (d.score ?? 0) < minScore) continue;
    seen.add(d.driveFile.id);
    extra.push(d);
  }
  return [...photos, ...extra];
}

/** The index's image hits for a query; nothing (never a failure) when it cannot say. */
async function driveIndexHits(caller: AppDriveCaller, q: string | null): Promise<NativePhotoHit[]> {
  if (!q) return [];
  try {
    const found = await searchSpace(caller, 'mine', q);
    return (found.semantic ?? []).map(driveHit).filter((h): h is NativePhotoHit => !!h);
  } catch (err) {
    console.warn('[native-photos] Drive index search failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

const OWNER: AppDriveCaller = { kind: 'owner', email: '' };

/**
 * GET photos/search — Immich's matches (paged) and, on the first page of a
 * "what's in it" search, the Drive index's image hits Immich does not have.
 * A 400 for a bad argument (Drive's or the builder's sentence); otherwise
 * always 200, with `connected:false` and the reason when Immich cannot answer.
 */
export async function searchPhotos(params: URLSearchParams): Promise<NativePhotoSearch> {
  const args = searchArgs(params);
  let path: string;
  try {
    path = searchPath(args);
  } catch (err) {
    if (err instanceof PhotoArgError) throw error(400, err.message);
    throw err;
  }
  const page = Math.max(1, Math.min(1000, Math.round(Number(args.page ?? 1)) || 1));
  const limit = Math.max(1, Math.min(100, Math.round(Number(args.limit ?? 25)) || 25));
  // The owner's own phone sends no `x-sr-app-for`, so `searchSpace` asks as the owner.
  const [answer, drive] = await Promise.all([askDrive(path), driveIndexHits(OWNER, driveIndexQuery(args))]);
  if (answer.kind === 'failed') throw error(400, answer.error);
  if (answer.kind === 'not_connected') {
    return { connected: false, reason: answer.reason, total: null, page, hasMore: false, results: mergeHits([], drive) };
  }
  const wire = Array.isArray(answer.body.assets) ? (answer.body.assets as WireAsset[]) : [];
  const photos = wire.map(photoHit).filter((h): h is NativePhotoHit => !!h);
  return {
    connected: true,
    total: num(answer.body.total),
    page: num(answer.body.page) ?? page,
    // A full page may have more behind it; Drive walks no deeper than MAX_PAGE.
    hasMore: wire.length >= limit && page < MAX_PAGE,
    results: mergeHits(photos, drive),
  };
}

export interface NativePerson {
  id: string;
  name: string | null;
  photos: number | null;
  facePath: string;
}

/** GET photos/people — the face clusters for a picker, each with its native face crop. */
export async function photoPeople(params: URLSearchParams): Promise<{ connected: boolean; reason?: string; people: NativePerson[] }> {
  const path = peoplePath({ filter: params.get('filter') ?? 'all', name: params.get('q') ?? undefined, limit: params.get('limit') ?? 200 });
  const answer = await askDrive(path);
  if (answer.kind === 'failed') throw error(400, answer.error);
  if (answer.kind === 'not_connected') return { connected: false, reason: answer.reason, people: [] };
  const wire = Array.isArray(answer.body.people) ? (answer.body.people as WirePerson[]) : [];
  const people = wire.flatMap((p) => {
    const id = parsePhotoId(p?.id);
    // A hidden face is one John chose not to see: never offered to pick.
    if (!id || p.isHidden) return [];
    return [{ id, name: p.name?.trim() || null, photos: num(p.assetCount), facePath: nativeFacePath(id) }];
  });
  return { connected: true, people };
}

const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i;

/**
 * GET photos/thumb/<uuid> and photos/face/<uuid> — Drive's owner-only image
 * proxy, relayed as bytes with its cache lifetime. Only an image type passes;
 * a refusal is `{error}` with a status the phone does not mistake for sign-out.
 */
export async function photoImage(kind: 'thumb' | 'face', rawId: string, size: string | null): Promise<Response> {
  const id = parsePhotoId(rawId);
  if (!id) throw error(404, 'Not found in the photo library.');
  const path = kind === 'thumb' ? `/api/photos/thumb/${id}${size === 'preview' ? '?size=preview' : ''}` : `/api/photos/face/${id}`;
  let res;
  try {
    res = await requestExtracted('drive', 'GET', path, {
      headers: { accept: 'image/*' },
      timeoutMs: 20_000,
      maxBytes: 8 * 1024 * 1024,
    });
  } catch (err) {
    console.error('[native-photos] Drive unreachable:', err instanceof Error ? err.message : String(err));
    throw error(502, 'The photo library did not answer.');
  }
  const header = (name: string) => {
    const v = res.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  if (res.status === 404 || res.status === 400) throw error(404, 'Not found in the photo library.');
  // Not linked (503), Drive's lane refused (401/403) or Immich in trouble: none
  // is the phone's to fix, and a 401 would sign it out.
  if (res.status === 503) throw error(503, 'The photo library is not connected.');
  const type = (header('content-type') ?? '').split(';')[0].trim();
  if (res.status !== 200 || !IMAGE_TYPE.test(type)) throw error(502, 'The photo library did not send an image.');
  const cache = header('cache-control');
  return new Response(new Uint8Array(res.body), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(res.body.byteLength),
      // Drive's own lifetime (a day for a thumbnail, an hour for a face, which a
      // merge can change), kept private; an hour when it sent none.
      'Cache-Control': cache && /^private\b/.test(cache) ? cache : 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
