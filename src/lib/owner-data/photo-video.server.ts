// photo_analyse_video: the relay to SR-Drive's on-request video analysis.
//
// Drive owns the analyser (one video at a time, faces and on-screen text in
// 10-second blocks, one record per person and per text per video) and answers
// GET | POST | DELETE /api/photos/videos/<id> on its owner-only photo lane.
// `askDrive` in `./photos.server` is GET-only and stays so; `sendDrive` here is
// its sibling for the one lane that queues and cancels work, and reads the
// JSON body of the two refusals that are answers rather than failures: 409
// needsConfirm (a long video: ask John first) and 413 (over the hard cap).
//
// Same rules as the reads: no `x-sr-app-for`, ever (owner only); nothing throws
// into chat; Drive not connected, unreachable or without the analyser reads as
// "not connected" with the reason.

import { requestExtracted } from '$lib/server/extracted-app';
import { askDrive, type PhotoResult } from './photos.server';
import {
  NOT_CONNECTED,
  PhotoArgError,
  VIDEO_ACTIONS,
  compactAsset,
  compactEstimate,
  compactVideoState,
  formatOffset,
  videoPath,
  videoResolverPath,
  type VideoAction,
  type WireAsset,
  type WireVideoState,
} from './photos';

const NAME = 'photo_analyse_video';

export type SendAnswer =
  | { kind: 'ok'; status: number; body: Record<string, unknown> }
  | { kind: 'not_connected'; reason: string }
  | { kind: 'failed'; error: string }
  | { kind: 'refused'; status: 409 | 413; body: Record<string, unknown> };

function parse(body: Buffer): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body.toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const sentence = (b: Record<string, unknown> | null): string | null => {
  const s = b && (typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : '');
  return s ? s.slice(0, 200) : null;
};

/** One call to Drive's video lane, any method, JSON in and out, classified. Never throws. */
export async function sendDrive(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>, timeoutMs = 20_000): Promise<SendAnswer> {
  let res;
  try {
    res = await requestExtracted('drive', method, path, {
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: Buffer.from(JSON.stringify(body)) } : {}),
      timeoutMs,
      maxBytes: 4 * 1024 * 1024,
    });
  } catch (err) {
    console.error('[photos] Drive unreachable:', err instanceof Error ? err.message : String(err));
    return { kind: 'not_connected', reason: 'SR-Drive is not answering' };
  }
  const b = parse(res.body);
  if (res.status >= 200 && res.status < 300) {
    if (!b) return { kind: 'not_connected', reason: 'SR-Drive sent something unreadable (an older Drive without video analysis?)' };
    if (b.connected === false || b.analyser === false) {
      const reason = typeof b.reason === 'string' ? b.reason.slice(0, 200) : b.connected === false ? 'no photo library is linked to SR-Drive' : 'the video analyser is not set up on SR-Drive';
      return { kind: 'not_connected', reason };
    }
    return { kind: 'ok', status: res.status, body: b };
  }
  const said = sentence(b);
  if (res.status === 409 && b?.needsConfirm === true) return { kind: 'refused', status: 409, body: b };
  if (res.status === 413) return { kind: 'refused', status: 413, body: b ?? {} };
  // A 404 with no sentence is a Drive without the video routes, not a missing video.
  if (res.status === 404 && !said) return { kind: 'not_connected', reason: 'SR-Drive has no video analysis yet (404)' };
  if (res.status === 400 || res.status === 404 || res.status === 409) return { kind: 'failed', error: said ?? 'Drive refused the request' };
  return { kind: 'not_connected', reason: `SR-Drive answered ${res.status}${said ? `: ${said}` : ''}` };
}

const ok = (data: Record<string, unknown>): PhotoResult => ({ success: true, data });
const fail = (error: string): PhotoResult => ({ success: false, error: `${NAME}: ${error}`.slice(0, 300) });
const notConnected = (reason: string): PhotoResult => ok({ connected: false, reason, answer: NOT_CONNECTED });

const FOLLOW_UP = "Analysis runs one video at a time and takes minutes. Tell John it is under way; check later with action 'status' (or photo_detail), do not wait in this turn.";

/** What the model should say about the state Drive returned. */
function answerFor(action: VideoAction, v: ReturnType<typeof compactVideoState>, force: boolean): string {
  switch (v.status) {
    case 'queued':
      return `Queued${'position' in v ? ` (position ${v.position})` : ''}. ${FOLLOW_UP}`;
    case 'running':
      return `Running${'progress' in v ? `, ${v.progress} done` : ''}. ${FOLLOW_UP}`;
    case 'done':
      return action === 'start' && !force
        ? 'Already analysed: the results are below (each person and each text once, with the time ranges they appear). To re-analyse, call again with force true.'
        : 'Done: the results are below (each person and each text once, with the time ranges they appear). Give John the times and links.';
    case 'failed':
      return `The analysis failed${'error' in v ? `: ${v.error}` : ''}. Tell John; it can be retried with action 'start' and force true.`;
    case 'cancelled':
      return action === 'cancel' ? 'Cancelled; nothing more will run for this video.' : "Cancelled earlier; action 'start' queues it again.";
    default:
      return "Not analysed. Action 'start' queues it.";
  }
}

/** Short enough to choose between: when, where, how long, who. */
function candidate(a: WireAsset) {
  const c = compactAsset(a);
  return {
    id: c.id,
    takenAt: c.takenAt,
    ...(c.place ? { place: c.place } : {}),
    ...(typeof a.durationSec === 'number' ? { length: formatOffset(a.durationSec) } : {}),
    ...(c.people?.length ? { people: c.people } : {}),
  };
}

export async function photoAnalyseVideoTool(args: Record<string, unknown>): Promise<PhotoResult> {
  const rawAction = typeof args.action === 'string' && args.action.trim() ? args.action.trim().toLowerCase() : 'start';
  if (!(VIDEO_ACTIONS as readonly string[]).includes(rawAction)) return fail(`action must be one of ${VIDEO_ACTIONS.join(', ')}; got "${rawAction.slice(0, 40)}"`);
  const action = rawAction as VideoAction;
  const confirm = args.confirm === true;
  const force = args.force === true;

  // Which video: the id given, or the one video the description finds.
  let path: string;
  const hasId = typeof args.id === 'string' && args.id.trim() !== '';
  try {
    if (hasId) {
      path = videoPath(args.id);
    } else {
      const search = await askDrive(videoResolverPath(args));
      if (search.kind === 'not_connected') return notConnected(search.reason);
      if (search.kind === 'failed') return fail(search.error);
      const videos = (Array.isArray(search.body.assets) ? (search.body.assets as WireAsset[]) : []).filter((a) => a && typeof a.id === 'string' && a.type === 'video');
      if (!videos.length) {
        return ok({ connected: true, found: 0, answer: 'No video matches that description, so nothing was started. Tell John, or try photo_search with type "video" and other words.' });
      }
      if (videos.length > 1) {
        const total = typeof search.body.total === 'number' ? search.body.total : videos.length;
        return ok({
          connected: true,
          found: total,
          candidates: videos.map(candidate),
          answer: `${total > videos.length ? `${total} videos match (the first ${videos.length} are listed)` : `${videos.length} videos match`}, so nothing was started. Ask John which one (by when, where, how long or who is in it), then call again with its id.`,
        });
      }
      path = videoPath(videos[0]!.id);
    }
  } catch (err) {
    if (err instanceof PhotoArgError) return fail(err.message);
    throw err;
  }
  const assetId = path.slice(path.lastIndexOf('/') + 1);

  const answer =
    action === 'start'
      ? await sendDrive('POST', path, { ...(confirm ? { confirm: true } : {}), ...(force ? { force: true } : {}) })
      : await sendDrive(action === 'cancel' ? 'DELETE' : 'GET', path);

  if (answer.kind === 'not_connected') return notConnected(answer.reason);
  if (answer.kind === 'failed') return fail(answer.error);
  if (answer.kind === 'refused') {
    const estimate = compactEstimate(answer.body.estimate as Parameters<typeof compactEstimate>[0]);
    const said = sentence(answer.body);
    if (answer.status === 409) {
      const maxMinutes = typeof answer.body.maxMinutes === 'number' ? answer.body.maxMinutes : null;
      return ok({
        connected: true,
        id: assetId,
        started: false,
        needsConfirm: true,
        ...(estimate ? { estimate } : {}),
        ...(maxMinutes !== null ? { noConfirmLimitMinutes: maxMinutes } : {}),
        ...(said ? { drive: said } : {}),
        answer: `This video is long${estimate?.videoLength ? ` (${estimate.videoLength})` : ''}, so it needs John's yes first${estimate?.cpuMinutes ? `: analysing it takes about ${estimate.cpuMinutes} minutes of processing` : ''}. Nothing was started. Ask John; only if he agrees, call again with confirm true.`,
      });
    }
    return ok({
      connected: true,
      id: assetId,
      started: false,
      tooLong: true,
      ...(said ? { drive: said } : {}),
      answer: `This video is longer than SR-Drive will analyse${said ? ` (${said})` : ''}, so it cannot be analysed and nothing was started. Tell John plainly.`,
    });
  }

  const v = answer.body.video;
  if (!v || typeof v !== 'object') return fail("Drive's answer had no video state");
  const video = compactVideoState(v as WireVideoState, assetId);
  return ok({ connected: true, action, video, answer: answerFor(action, video, force) });
}
