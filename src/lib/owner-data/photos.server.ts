// The owner's photo library for jkai chat: the relay to SR-Drive.
//
// Drive owns the Immich connection and its key; Main never talks to Immich.
// These reads go over the same service lane Main already uses for Drive's
// owner-only /api/files/app/* (`$lib/drive/native-drive`): DRIVE_SERVICE_TOKEN
// on 127.0.0.1, `accept: application/json` so a refusal comes back as JSON
// rather than an HTML page. No `x-sr-app-for`, ever: the photo lane answers the
// owner only, and Drive refuses a call that names a member.
//
// Nothing here throws into chat. Drive saying `connected: false`, a closed or
// unreachable lane, or Drive refusing the service lane are all answered as
// "photos are not connected" with the reason; a bad argument or an unknown
// photo is a plain failed tool call with Drive's own sentence.

import { requestExtracted } from '$lib/server/extracted-app';
import {
  NOT_CONNECTED,
  PHOTOS_PAGE,
  PhotoArgError,
  STATS_PATH,
  compactAsset,
  compactPerson,
  detailPath,
  peoplePath,
  placeName,
  searchPath,
  summarise,
  type WireAsset,
  type WirePerson,
} from './photos';

type Ok = { success: true; data: Record<string, unknown> };
type Fail = { success: false; error: string };
export type PhotoResult = Ok | Fail;

type DriveAnswer =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'not_connected'; reason: string }
  | { kind: 'failed'; error: string };

function driveSentence(body: Buffer): string | null {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { message?: string; error?: string };
    return (parsed.message || parsed.error || '').slice(0, 200) || null;
  } catch {
    return null;
  }
}

/** One GET to Drive's photo lane, classified. Never throws. */
export async function askDrive(path: string, timeoutMs = 20_000): Promise<DriveAnswer> {
  let res;
  try {
    res = await requestExtracted('drive', 'GET', path, { headers: { accept: 'application/json' }, timeoutMs, maxBytes: 4 * 1024 * 1024 });
  } catch (err) {
    console.error('[photos] Drive unreachable:', err instanceof Error ? err.message : String(err));
    return { kind: 'not_connected', reason: 'SR-Drive is not answering' };
  }
  if (res.status >= 200 && res.status < 300) {
    let body: unknown;
    try {
      body = JSON.parse(res.body.toString('utf8'));
    } catch {
      return { kind: 'not_connected', reason: 'SR-Drive sent something unreadable (an older Drive without the photo lane?)' };
    }
    if (!body || typeof body !== 'object') return { kind: 'not_connected', reason: 'SR-Drive sent something unreadable' };
    const b = body as Record<string, unknown>;
    if (b.connected === false) return { kind: 'not_connected', reason: typeof b.reason === 'string' ? b.reason.slice(0, 200) : 'no photo library is linked to SR-Drive' };
    return { kind: 'ok', body: b };
  }
  const said = driveSentence(res.body);
  if (res.status === 400 || res.status === 404) return { kind: 'failed', error: said ?? (res.status === 404 ? 'not found' : 'Drive refused the request') };
  // 401/403 is about the service lane, 404 on a Drive without the routes is
  // handled above, 5xx is Drive's own trouble: none of them is John's to fix
  // by rephrasing, so all read as "not connected", with the reason.
  return { kind: 'not_connected', reason: `SR-Drive answered ${res.status}${said ? `: ${said}` : ''}` };
}

const notConnected = (reason: string): Ok => ({ success: true, data: { connected: false, reason, answer: NOT_CONNECTED } });

async function read(name: string, path: () => string, shape: (body: Record<string, unknown>) => Record<string, unknown>): Promise<PhotoResult> {
  let p: string;
  try {
    p = path();
  } catch (err) {
    if (err instanceof PhotoArgError) return { success: false, error: `${name}: ${err.message}` };
    throw err;
  }
  const answer = await askDrive(p);
  if (answer.kind === 'not_connected') return notConnected(answer.reason);
  if (answer.kind === 'failed') return { success: false, error: `${name}: ${answer.error}` };
  try {
    return { success: true, data: { connected: true, ...shape(answer.body) } };
  } catch (err) {
    return { success: false, error: `${name}: Drive's answer could not be read (${err instanceof Error ? err.message : String(err)})`.slice(0, 300) };
  }
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function photoPeopleTool(args: Record<string, unknown>): Promise<PhotoResult> {
  return read('photo_people', () => peoplePath(args), (b) => {
    const people = list<WirePerson>(b.people).map(compactPerson);
    return { count: people.length, unnamed: people.filter((p) => !p.name).length, people, url: PHOTOS_PAGE };
  });
}

export function photoSearchTool(args: Record<string, unknown>): Promise<PhotoResult> {
  return read('photo_search', () => searchPath(args), (b) => {
    const assets = list<WireAsset>(b.assets).map(compactAsset);
    return {
      total: typeof b.total === 'number' ? b.total : null,
      page: typeof b.page === 'number' ? b.page : 1,
      returned: assets.length,
      ...summarise(assets),
      assets,
    };
  });
}

export function photoDetailTool(args: Record<string, unknown>): Promise<PhotoResult> {
  return read('photo_detail', () => detailPath(args), (b) => {
    const a = b.asset as WireAsset | undefined;
    if (!a || typeof a !== 'object' || typeof a.id !== 'string') throw new Error('no asset in the answer');
    const ocr = typeof a.ocrText === 'string' ? a.ocrText.trim() : '';
    return {
      asset: {
        ...compactAsset(a),
        ...(a.location?.state && a.location.city ? { region: a.location.state } : {}),
        ...(a.camera?.lens ? { lens: a.camera.lens } : {}),
        ...(a.width && a.height ? { size: `${a.width}x${a.height}` } : {}),
        // Words read off the image: what's written in it, not anyone's message.
        ...(ocr ? { textInImage: ocr.slice(0, 2000), ...(ocr.length > 2000 ? { textInImageTruncated: true } : {}) } : {}),
        faces: list<{ personId?: string | null; name?: string | null }>(a.faces).map((f) => ({
          personId: f.personId ?? null,
          name: f.name?.trim() || null,
        })),
        ...(a.thumbnailPath ? { thumbnail: a.thumbnailPath } : {}),
      },
    };
  });
}

export function photoStatsTool(args: Record<string, unknown>): Promise<PhotoResult> {
  const top = typeof args.top_places === 'number' && Number.isFinite(args.top_places) ? Math.min(30, Math.max(1, Math.round(args.top_places))) : 10;
  return read('photo_stats', () => STATS_PATH, (b) => {
    const places = list<{ place?: string; count?: number; city?: string; country?: string }>(b.topPlaces)
      .map((p) => ({ place: p.place ?? placeName(p) ?? 'unknown', count: p.count ?? 0 }))
      .slice(0, top);
    const processing = b.processing && typeof b.processing === 'object' ? (b.processing as Record<string, { active?: number; waiting?: number }>) : null;
    const busy = processing
      ? Object.fromEntries(Object.entries(processing).filter(([, j]) => (j?.active ?? 0) + (j?.waiting ?? 0) > 0))
      : null;
    return {
      totals: b.totals ?? null,
      people: b.people ?? null,
      dateRange: b.dateRange ?? null,
      topPlaces: places,
      // Only the jobs with work left; an empty object means Immich has caught up.
      processing: busy,
      ...(busy && Object.keys(busy).length ? { note: 'Immich is still processing: counts, faces and places may be incomplete.' } : {}),
      url: PHOTOS_PAGE,
    };
  });
}
