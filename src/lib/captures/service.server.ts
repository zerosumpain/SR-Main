// The operations the routes call, one per verb, so each route file is the
// wrapper, the parse and one line. Every operation takes the recorder's space
// and finds the capture IN it; a capture elsewhere is `null` → 404.

import type { Capture, CaptureAction } from '$lib/db/schema';
import { startCaptureAnalysis } from './analyse.server';
import { runApprovedAction } from './actions.server';
import { queueCaptureExtract } from './graph.server';
import { deleteCaptureMedia, storeCaptureMedia, CaptureMediaError } from './media.server';
import { findPersonEntity } from './search.server';
import {
  claimAction,
  deleteCaptureRows,
  getAction,
  getCapture,
  listActions,
  recorderPrincipalId,
  updateAction,
  updateCapture,
} from './store.server';
import { validateActionParams, type CapturePatch, type DecisionBody } from './validate';
import { screenOf, speakersOf } from './view';
import type { CaptureActionKind } from './types';

export { CaptureMediaError };

export type Refusal = { refused: true; status: 400 | 404 | 409; error: string };
const refuse = (status: Refusal['status'], error: string): Refusal => ({ refused: true, status, error });
const notFound: Refusal = refuse(404, 'No such capture.');

export function isRefusal(v: unknown): v is Refusal {
  return !!v && typeof v === 'object' && (v as { refused?: unknown }).refused === true;
}

/** PUT …/audio and …/screen. Replaces an earlier upload (a retry), removing its bytes. */
export async function attachMedia(
  spaceId: string,
  id: string,
  which: 'audio' | 'screen',
  buf: Buffer,
  declaredType: string | null,
): Promise<Refusal | null> {
  const c = await getCapture(id, spaceId);
  if (!c) return notFound;
  if (which === 'screen' && screenOf(c)?.denied) return refuse(409, 'That screenshot was on the deny list; it is not kept.');
  const stored = await storeCaptureMedia(buf, declaredType, which === 'audio' ? 'audio' : 'image', recorderPrincipalId(), c.id);
  const previous = which === 'audio' ? c.audioUploadId : c.screenUploadId;
  const next = await updateCapture(c.id, which === 'audio' ? { audioUploadId: stored.id } : { screenUploadId: stored.id });
  if (previous && previous !== stored.id) await deleteCaptureMedia([previous]).catch(() => {});
  if (which === 'audio' && next) {
    // Analysis waits for the screenshot only if one is coming and has not
    // arrived; the screen PUT starts it otherwise.
    if (!screenPending(next)) startCaptureAnalysis(next.id);
  } else if (which === 'screen' && next) {
    if (!audioPending(next) && next.status === 'received') startCaptureAnalysis(next.id);
  }
  return null;
}

function audioPending(c: Capture): boolean {
  return (c.intake as { audio?: boolean })?.audio !== false && !c.audioUploadId;
}
function screenPending(c: Capture): boolean {
  return (c.intake as { screenshot?: boolean })?.screenshot === true && !c.screenUploadId;
}

/**
 * Start straight after the POST when nothing is coming: `audio:false` and no
 * screenshot. With a screenshot coming, its PUT starts it.
 */
export function startIfComplete(c: Capture): void {
  if (!audioPending(c) && !screenPending(c)) startCaptureAnalysis(c.id);
}

export async function patchCapture(spaceId: string, id: string, patch: CapturePatch): Promise<Capture | Refusal> {
  const c = await getCapture(id, spaceId);
  if (!c) return notFound;
  const set: Partial<Capture> = {};
  let graphChanged = false;
  if (patch.title !== undefined) {
    set.title = patch.title;
    graphChanged = true;
  }
  if (patch.speakers) {
    const speakers = speakersOf(c);
    for (const s of patch.speakers) {
      const one = speakers.find((x) => x.label === s.label);
      if (!one) return refuse(400, `There is no speaker ${s.label} in this capture.`);
      if (s.confirmed) {
        // The re-link: the phone may name the entity; else find the one person
        // of that name in the recorder's graph. Ambiguous stays unlinked.
        const entityId = s.confirmed.entityId ?? (await findPersonEntity(spaceId, s.confirmed.name).catch(() => null));
        one.confirmed = entityId ? { name: s.confirmed.name, entityId } : { name: s.confirmed.name };
      } else {
        one.confirmed = null;
      }
    }
    set.speakers = speakers;
    graphChanged = true;
  }
  if (patch.screenApp !== undefined) {
    const screen = screenOf(c) ?? { app: null, summary: '', ocrText: '' };
    set.screen = { ...screen, corrected: patch.screenApp } as unknown as Record<string, unknown>;
    graphChanged = true;
  }
  const next = (await updateCapture(c.id, set)) ?? c;
  // The graph text names the speakers and the app, so its hash moves and Core
  // re-extracts — that is how a confirmation reaches the entity.
  if (graphChanged && next.status === 'ready') await queueCaptureExtract(next).catch(() => {});
  return next;
}

export async function deleteCapture(spaceId: string, id: string): Promise<Refusal | null> {
  const c = await getCapture(id, spaceId);
  if (!c) return notFound;
  const { uploadIds } = await deleteCaptureRows(c);
  await deleteCaptureMedia(uploadIds).catch((err) => console.warn('[captures] media not removed:', err instanceof Error ? err.message : err));
  return null;
}

export async function decideAction(
  spaceId: string,
  captureId: string,
  actionId: string,
  body: DecisionBody,
): Promise<CaptureAction | Refusal> {
  const c = await getCapture(captureId, spaceId);
  if (!c) return notFound;
  const a = await getAction(captureId, actionId, spaceId);
  if (!a) return refuse(404, 'No such follow-up.');
  if (a.state !== 'proposed') return refuse(409, `That follow-up is already ${a.state}.`);

  if (body.decision === 'dismiss') {
    return (await claimAction(a.id, 'dismissed')) ?? refuse(409, 'That follow-up was already decided.');
  }

  // The owner may edit the params before approving; the edit goes through the
  // same validator as the model's proposal.
  let params = a.params as Record<string, unknown>;
  if (body.params) {
    const v = validateActionParams(a.kind as CaptureActionKind, { ...params, ...body.params });
    if (!v.ok) return refuse(400, v.error);
    params = v.value as Record<string, unknown>;
  } else {
    // Re-check what is stored: a row written by an older build must not run unchecked.
    const v = validateActionParams(a.kind as CaptureActionKind, params);
    if (!v.ok) {
      await updateAction(a.id, { state: 'refused', error: v.error, decidedAt: new Date() });
      return refuse(400, v.error);
    }
  }
  if (body.params) await updateAction(a.id, { params });
  const claimed = await claimAction(a.id, 'approved');
  if (!claimed) return refuse(409, 'That follow-up was already decided.');
  return runApprovedAction(claimed, c);
}

export async function captureWithActions(spaceId: string, id: string): Promise<{ c: Capture; actions: CaptureAction[] } | null> {
  const c = await getCapture(id, spaceId);
  if (!c) return null;
  return { c, actions: await listActions(c.id) };
}
