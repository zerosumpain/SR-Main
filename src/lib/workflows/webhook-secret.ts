/**
 * D4 — Webhook hardening: per-workflow shared secret.
 *
 * A webhook-triggered workflow may carry an optional secret in its
 * `workflows.trigger` jsonb (no schema change). When present, `POST
 * /api/workflows/webhook/[id]` requires an `X-Webhook-Secret` header whose value
 * matches, using a timing-safe comparison. When absent, the endpoint keeps its
 * historical open behaviour (backwards compatible).
 *
 * Pure and DB-free so the accept/reject matrix is unit-testable in isolation;
 * the route just wires `isWebhookAuthorized` into its 401 branch.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** The HTTP header carrying the caller's secret. Lower-cased for direct use
 *  with `Headers.get()` (case-insensitive, but we keep the canonical form). */
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

/** Loose shape of the `workflows.trigger` jsonb we read a secret out of. The
 *  secret can live at the top level (written by the trigger PUT route, matching
 *  its cron/eventType convention) or nested under `config` (written by the
 *  generator's `deriveTriggerShape`, whose webhook branch keeps `config: cfg`).
 *  We tolerate both so either author path is enforced identically. */
export interface TriggerLike {
  type?: unknown;
  secret?: unknown;
  config?: unknown;
  [k: string]: unknown;
}

/**
 * Extract the configured webhook secret from a workflow's trigger jsonb. Returns
 * `''` when none is configured (which the gate treats as "open").
 */
export function getWebhookSecret(trigger: TriggerLike | null | undefined): string {
  if (!trigger || typeof trigger !== 'object') return '';
  if (typeof trigger.secret === 'string' && trigger.secret) return trigger.secret;
  const cfg = trigger.config;
  if (cfg && typeof cfg === 'object') {
    const nested = (cfg as { secret?: unknown }).secret;
    if (typeof nested === 'string' && nested) return nested;
  }
  return '';
}

/**
 * Timing-safe, length-independent comparison of two secrets. Both sides are
 * hashed to a fixed 32-byte digest before comparison so `timingSafeEqual` never
 * throws on a length mismatch and the comparison leaks neither value nor length.
 */
export function secretsMatch(configured: string, provided: string | null | undefined): boolean {
  if (!configured) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = createHash('sha256').update(configured, 'utf8').digest();
  const b = createHash('sha256').update(provided, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * Combined gate. Returns `true` (authorised) when no secret is configured
 * (back-compat) or when the supplied header value matches the configured secret.
 * Returns `false` only when a secret is configured and the header is
 * missing/wrong.
 */
export function isWebhookAuthorized(
  trigger: TriggerLike | null | undefined,
  headerValue: string | null | undefined,
): boolean {
  const configured = getWebhookSecret(trigger);
  if (!configured) return true; // no secret ⇒ open (backwards compatible)
  return secretsMatch(configured, headerValue ?? null);
}
