// src/lib/secrets/pending-updates.ts
//
// The server-authored half of a credential UPDATE.
//
// On the create path the browser posts `{provider, value}` and every binding
// fact is looked up from the code table in `credential-requests.ts`, so the page
// cannot choose where a credential lands. An update has no such table to look
// up: the whole point is that it targets an existing row, and a binding change
// carries a host list that started life as a model suggestion.
//
// Rather than let the browser echo that host list back on the POST — which would
// put "which host may hold this key" on the wire in a request the server would
// have to trust — the gate registers the plan it AUTHORED here, keyed by the
// request id it just published. The browser then posts only `{requestId, value
// or fields, confirmedHosts}`. The endpoint reads the binding from this map, so:
//
//   * a host that was never in the published plan cannot be written, whatever
//     the page sends;
//   * the plan is single-use — a replayed POST finds nothing;
//   * and it expires with the form, so an abandoned modal leaves no way in.
//
// `confirmedHosts` is the one thing the browser genuinely contributes, and it is
// checked AGAINST the plan rather than trusted: the owner has to have typed each
// newly-added hostname exactly. A prompt-injected model proposing
// `evil.example` therefore needs the owner to type `evil.example` — the
// suggestion alone gets it nowhere.
//
// In-memory and per-process, exactly like the job-store waiters this sits
// beside: the gate that writes and the endpoint that reads are the same
// SvelteKit process, and a plan that does not survive a restart just means the
// owner is asked again.

import type { SecretBinding } from './registry';

export interface PendingSecretUpdate {
  requestId: string;
  handle: string;
  mode: 'rotate' | 'amend' | 'rebind';
  /** Field keys the modal may send on an `amend`. Anything else is rejected. */
  allowedFieldKeys: string[];
  /** The exact binding to write on a `rebind`. Absent for value-only modes. */
  binding?: SecretBinding;
  /** Newly-reachable hostnames the owner must retype before this may be saved. */
  requiresTypedHosts: string[];
  expiresAt: number;
}

const pending = new Map<string, PendingSecretUpdate>();

function sweep(now: number): void {
  for (const [id, plan] of pending) if (plan.expiresAt <= now) pending.delete(id);
}

export function registerPendingUpdate(plan: Omit<PendingSecretUpdate, 'expiresAt'>, ttlMs: number): void {
  const now = Date.now();
  sweep(now);
  pending.set(plan.requestId, { ...plan, expiresAt: now + ttlMs });
}

/**
 * Take the plan for `requestId`, removing it. Single-use by construction: a
 * second POST with the same id gets `null` rather than a second write.
 */
export function consumePendingUpdate(requestId: string): PendingSecretUpdate | null {
  const now = Date.now();
  sweep(now);
  const plan = pending.get(String(requestId ?? ''));
  if (!plan) return null;
  pending.delete(plan.requestId);
  return plan.expiresAt > now ? plan : null;
}

/** Drop a plan whose form was dismissed, so a declined request cannot be replayed. */
export function discardPendingUpdate(requestId: string): void {
  pending.delete(String(requestId ?? ''));
}

const normHost = (h: unknown) => String(h ?? '').trim().toLowerCase().replace(/\.+$/, '');

/**
 * The binding to actually write, given which hostnames the owner typed.
 *
 * Both directions fail towards LESS reach:
 *
 *   * a host the plan never proposed cannot be added by typing it — the result
 *     is built from `plan.binding`, and `confirmed` only ever filters it;
 *   * a proposed host the owner did NOT type is dropped, so a half-confirmed
 *     proposal lands as the part they agreed to instead of all of it.
 *
 * Hosts the credential could already reach are untouched: they are not in
 * `requiresTypedHosts`, so no amount of typing (or not typing) affects them.
 */
export function bindingAfterConfirmation(
  plan: PendingSecretUpdate,
  confirmedHosts: unknown,
): SecretBinding {
  const binding = plan.binding;
  if (!binding) throw new Error('bindingAfterConfirmation called on a value-only plan');

  const typed = new Set((Array.isArray(confirmedHosts) ? confirmedHosts : []).map(normHost));
  const unconfirmed = plan.requiresTypedHosts.filter((h) => !typed.has(normHost(h)));

  return {
    ...binding,
    allowedHosts: binding.allowedHosts.filter((h) => !unconfirmed.some((u) => normHost(u) === normHost(h))),
  };
}

/** Test helper — reset state between unit tests. */
export function _resetPendingUpdatesForTests(): void {
  pending.clear();
}
