// src/lib/workflows/chat/secret-gate.ts
//
// The server half of the credential-request round trip. Sibling of
// confirmation-gate.ts, with one important difference: the thing being
// collected must never come back through here.
//
// Flow:
//   1. publish a `secret_request` event onto the job's SSE stream. Every field
//      is server-authored from CREDENTIAL_REQUEST_SPECS; the model supplied
//      only a provider key (already validated) and a reason string.
//   2. wait for the browser to PATCH `secret_ack`.
//   3. RE-VERIFY server-side that the secret now exists and was written during
//      this request. The ack is a hint, not a proof — it arrives over the same
//      channel as everything else and must not be the thing that decides
//      whether the tool reports success.
//
// Nothing here ever holds, logs, or returns a credential value.

import { publishJobEvent, createWaiter, getJob } from './job-store';
import { notifyAllSubscribers } from '$lib/server/push';
import { getSecretMeta } from '$lib/secrets/registry';
import type { CredentialRequestSpec } from '$lib/secrets/credential-requests';
import { buildCreatePlan, buildUpdatePlan } from '$lib/secrets/credential-requests';
import { registerPendingUpdate, discardPendingUpdate } from '$lib/secrets/pending-updates';
import { registerPendingCreate, discardPendingCreate } from '$lib/secrets/pending-creates';
import type { SecretRequestOutcome, SecretUpdateRequest } from '$lib/jkai/tool-step-bus';
import { SECRET_REQUEST_TIMEOUT_MS } from '$lib/jkai/tool-step-bus';

/** Clock skew allowance when comparing the secret's updatedAt to the request. */
const SKEW_MS = 5_000;

export async function requireSecret(
  jobId: string,
  spec: CredentialRequestSpec,
  reason: string,
): Promise<SecretRequestOutcome> {
  const requestId = crypto.randomUUID();
  const openedAt = Date.now();

  // Author the write BEFORE the form is shown and park it under the request id,
  // exactly as the update path does. The browser then posts only what the owner
  // typed; the handle, source, injection, methods and path scoping all come from
  // here. See $lib/secrets/pending-creates.
  const { event, write } = buildCreatePlan({ requestId, spec, reason });
  registerPendingCreate({ requestId, ...write }, SECRET_REQUEST_TIMEOUT_MS);

  publishJobEvent(jobId, { type: 'secret_request', ...event });

  try {
    const conversationId = getJob(jobId)?.scope.conversationId ?? null;
    void notifyAllSubscribers({
      title: 'Credential needed',
      body: `${spec.title} — jkai needs a credential to continue`,
      url: conversationId ? `/jkai?c=${conversationId}` : '/jkai',
    }).catch((e) => console.warn('[jkai-pwa] credential push failed', e));
  } catch (e) {
    console.warn('[jkai-pwa] credential push failed', e);
  }

  const { awaitResponse } = createWaiter<{ stored: boolean; handle?: string }>(
    jobId,
    `secret:${requestId}`,
  );

  let ack: { stored: boolean; handle?: string };
  try {
    ack = await awaitResponse();
  } catch {
    // Job cancelled or reaped while the modal was open.
    discardPendingCreate(requestId);
    return { status: 'declined' };
  }

  // Whatever the answer, the plan is spent. A declined form must not leave a
  // usable write sitting in memory for the rest of its TTL.
  discardPendingCreate(requestId);
  if (!ack?.stored) return { status: 'declined' };

  // Independent verification. `getSecretMeta` returns SecretMeta, which has no
  // value field by construction, so this cannot become a read-back path.
  const handle = spec.binding.handle;
  const meta = await getSecretMeta(handle);
  if (!meta) return { status: 'declined' };

  const updatedAt = meta.updatedAt ? Date.parse(meta.updatedAt) : NaN;
  if (Number.isFinite(updatedAt) && updatedAt < openedAt - SKEW_MS) {
    // The row exists but predates this request — the browser claimed a write
    // that did not happen. Report as declined rather than success.
    return { status: 'declined' };
  }

  return { status: 'stored', handle };
}

const lower = (xs: string[]) => Array.from(new Set((xs ?? []).map((x) => String(x).toLowerCase()))).sort();

/** Order-insensitive set equality. */
function sameSet(a: string[], b: string[]): boolean {
  const [x, y] = [lower(a), lower(b)];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Is every member of `a` present in `b`? Used where the owner is allowed to
 *  land LESS than was proposed but never more. */
function subsetOf(a: string[], b: string[]): boolean {
  const big = new Set(lower(b));
  return lower(a).every((v) => big.has(v));
}

/**
 * The update sibling of `requireSecret`. Same three-step shape — publish, wait,
 * re-verify — with two differences that matter:
 *
 *  * The plan is registered server-side under the request id BEFORE the form is
 *    shown, so the endpoint writes the binding THIS function authored rather
 *    than one the browser sends back. See $lib/secrets/pending-updates.
 *
 *  * Verification checks the RESULT, not the acknowledgement. For a value change
 *    that means the row's `updatedAt` moved; for a rebind it means the stored
 *    binding now equals the approved one. An ack that claims a rebind which did
 *    not land reports as declined, so the model is never told it may use a host
 *    the row is not actually bound to.
 */
export async function requireSecretUpdate(
  jobId: string,
  req: SecretUpdateRequest,
  reason: string,
): Promise<SecretRequestOutcome> {
  const requestId = crypto.randomUUID();
  const openedAt = Date.now();

  const before = await getSecretMeta(req.handle);
  if (!before) return { status: 'declined' };

  const { event, write } = buildUpdatePlan({
    requestId,
    existing: {
      handle: before.handle,
      label: before.label,
      source: before.source,
      refKey: before.refKey,
      injectionKind: before.injection.kind,
      allowedHosts: before.allowedHosts,
      allowedMethods: before.allowedMethods,
      allowedPathPrefixes: before.allowedPathPrefixes,
    },
    change: req.change,
    reason,
    delta: req.delta,
  });

  registerPendingUpdate({ requestId, ...write }, SECRET_REQUEST_TIMEOUT_MS);

  publishJobEvent(jobId, { type: 'secret_request', ...event });

  try {
    const conversationId = getJob(jobId)?.scope.conversationId ?? null;
    void notifyAllSubscribers({
      title: 'Credential change needed',
      body: `${event.title} — jkai needs you to confirm a change`,
      url: conversationId ? `/jkai?c=${conversationId}` : '/jkai',
    }).catch((e) => console.warn('[jkai-pwa] credential update push failed', e));
  } catch (e) {
    console.warn('[jkai-pwa] credential update push failed', e);
  }

  const { awaitResponse } = createWaiter<{ stored: boolean; handle?: string }>(
    jobId,
    `secret:${requestId}`,
  );

  let ack: { stored: boolean; handle?: string };
  try {
    ack = await awaitResponse();
  } catch {
    discardPendingUpdate(requestId);
    return { status: 'declined' };
  }

  // Whatever the answer, the plan is spent. A declined form must not leave a
  // usable write sitting in memory for the rest of its TTL.
  discardPendingUpdate(requestId);
  if (!ack?.stored) return { status: 'declined' };

  const after = await getSecretMeta(before.handle);
  if (!after) return { status: 'declined' };

  if (write.mode === 'rebind') {
    const b = write.binding!;
    // Hosts may land as a SUBSET of the proposal: the endpoint drops any newly-
    // reachable host the owner declined to type. Never a superset — a row bound
    // to a host that was not in the approved plan means something other than
    // this form wrote it, and the model must not be told it may use that host.
    // Methods and paths are not owner-editable in the form, so they must match.
    const landed =
      subsetOf(after.allowedHosts, b.allowedHosts) &&
      sameSet(after.allowedMethods, b.allowedMethods) &&
      sameSet(after.allowedPathPrefixes, b.allowedPathPrefixes);
    if (!landed) return { status: 'declined' };
    return { status: 'stored', handle: after.handle };
  }

  const updatedAt = after.updatedAt ? Date.parse(after.updatedAt) : NaN;
  if (Number.isFinite(updatedAt) && updatedAt < openedAt - SKEW_MS) return { status: 'declined' };
  return { status: 'stored', handle: after.handle };
}
