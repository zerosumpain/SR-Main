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
import type { SecretRequestOutcome } from '$lib/jkai/tool-step-bus';

/** Clock skew allowance when comparing the secret's updatedAt to the request. */
const SKEW_MS = 5_000;

export async function requireSecret(
  jobId: string,
  spec: CredentialRequestSpec,
  reason: string,
): Promise<SecretRequestOutcome> {
  const requestId = crypto.randomUUID();
  const openedAt = Date.now();

  publishJobEvent(jobId, {
    type: 'secret_request',
    requestId,
    provider: spec.provider,
    title: spec.title,
    // Quoted verbatim to the owner as the model's stated purpose. The modal
    // renders it as quoted text, never as instruction.
    reason: String(reason ?? '').slice(0, 200),
    helpUrl: spec.helpUrl,
    fields: spec.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      placeholder: f.placeholder,
      help: f.help,
    })),
    destination: {
      handle: spec.binding.handle,
      store: 'api_secrets',
      hosts: spec.binding.allowedHosts,
      methods: spec.binding.allowedMethods,
      storeOnly: spec.binding.injection.kind === 'none',
    },
    companions: (spec.companions ?? []).map((c) => ({
      handle: c.handle,
      hosts: c.allowedHosts,
      methods: c.allowedMethods,
    })),
    assemble: spec.assemble,
  });

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
    return { status: 'declined' };
  }

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
