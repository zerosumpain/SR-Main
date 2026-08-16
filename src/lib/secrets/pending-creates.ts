// src/lib/secrets/pending-creates.ts
//
// The server-authored half of a credential CREATE. Sibling of pending-updates.ts,
// and it exists for the same reason: the browser should post the values the
// owner typed and nothing else.
//
// Before this, the create path rebuilt the spec from `{provider, label,
// suggestedHost, suggestedHandle}` on the POST body — fields the modal never
// sent. A catalogued provider survived that (its binding is a code constant),
// but every `custom` credential arrived with an empty host list and was refused
// by `validateHosts` with "a secret must be bound to at least one allowed host".
// The generic path, in other words, could not store anything at all.
//
// Parking the plan fixes both halves at once:
//
//   * the binding comes from the plan the gate authored, so nothing the page
//     sends can move a credential to another host;
//   * the plan carries the field list, so a multi-field credential set is
//     assembled server-side from exactly the keys the catalogue declared;
//   * it is single-use and expires with the form, so an abandoned modal leaves
//     no way in and a replayed POST writes nothing.
//
// The owner's genuine contribution is the hostname, on the paths where the plan
// says so: `hostEditable` (a model-suggested host they confirm or correct) and
// `hostFromField` (a broker they were issued, which no code table could know).
// Both are typed by the owner; neither can be supplied by the model.
//
// In-memory and per-process, exactly like pending-updates and the job-store
// waiters: the gate that writes and the endpoint that reads are the same
// SvelteKit process, and a plan that does not survive a restart just means the
// owner is asked again.

import { CredentialSpecError, hostFromEndpoint, type CreateWrite } from './credential-requests';

export interface PendingSecretCreate extends CreateWrite {
  requestId: string;
  expiresAt: number;
}

const pending = new Map<string, PendingSecretCreate>();

function sweep(now: number): void {
  for (const [id, plan] of pending) if (plan.expiresAt <= now) pending.delete(id);
}

export function registerPendingCreate(
  plan: CreateWrite & { requestId: string },
  ttlMs: number,
): void {
  const now = Date.now();
  sweep(now);
  pending.set(plan.requestId, { ...plan, expiresAt: now + ttlMs });
}

/**
 * Take the plan for `requestId`, removing it. Single-use by construction: a
 * second POST with the same id gets `null` rather than a second write.
 */
export function consumePendingCreate(requestId: string): PendingSecretCreate | null {
  const now = Date.now();
  sweep(now);
  const plan = pending.get(String(requestId ?? ''));
  if (!plan) return null;
  pending.delete(plan.requestId);
  return plan.expiresAt > now ? plan : null;
}

/** Drop a plan whose form was dismissed, so a declined request cannot be replayed. */
export function discardPendingCreate(requestId: string): void {
  pending.delete(String(requestId ?? ''));
}

/** Test helper — reset state between unit tests. */
export function _resetPendingCreatesForTests(): void {
  pending.clear();
}

/**
 * Turn what the owner typed into the value and host binding to write.
 *
 * Pure, so the two decisions that matter — which keys make it into a stored
 * credential set, and where the resulting row may be sent — are testable without
 * a database, in the same way `bindingAfterConfirmation` is on the update side.
 *
 * Throws `CredentialSpecError` for anything the owner can fix by typing more;
 * the endpoint reports those as a 400 with the message unchanged.
 */
export function resolveCreateInput(
  plan: CreateWrite,
  body: { value?: unknown; fields?: unknown; host?: unknown },
): { value: string; allowedHosts: string[] } {
  const rawFields = (body.fields ?? {}) as Record<string, unknown>;

  // Only keys the catalogue declared. The page cannot add a field to a stored
  // credential set, and it cannot rename one.
  const typed: Record<string, string> = {};
  for (const key of plan.fieldKeys) {
    const v = String(rawFields[key] ?? '').trim();
    if (v) typed[key] = v;
  }

  let value: string;
  if (plan.assemble === 'json') {
    const missing = plan.requiredFieldKeys.filter((k) => !typed[k]);
    if (missing.length) throw new CredentialSpecError(`these are still empty: ${missing.join(', ')}`);
    value = JSON.stringify(typed);
  } else {
    // A single-value credential may arrive either way — as `value`, or as the
    // one field the catalogue declared.
    const single = typeof body.value === 'string' ? body.value.trim() : '';
    value = single || typed[plan.fieldKeys[0]] || '';
    if (!value) throw new CredentialSpecError('value is required');
    if (plan.fieldKeys[0]) typed[plan.fieldKeys[0]] = value;
  }

  let allowedHosts = plan.allowedHosts;
  if (plan.hostFromField) {
    // A credential that names its own endpoint (a Kafka broker issued per
    // subscription). The binding is read out of what the owner pasted.
    const host = hostFromEndpoint(typed[plan.hostFromField]);
    if (!host) {
      throw new CredentialSpecError(
        `the credential is bound to the host in "${plan.hostFromField}", and nothing host-shaped was entered there. ` +
          `Paste the endpoint exactly as the vendor shows it.`,
      );
    }
    allowedHosts = [host];
  } else if (plan.hostEditable) {
    // The `custom` path: jkai suggested a host, the owner confirmed or corrected
    // it in the form. Blank is refused rather than defaulted — an unbound
    // credential is exactly what `validateHosts` exists to prevent.
    const host = hostFromEndpoint(body.host);
    if (!host) {
      throw new CredentialSpecError(
        'the API hostname is required — it is what stops the credential being sent anywhere else',
      );
    }
    allowedHosts = [host];
  }

  return { value, allowedHosts };
}
