/**
 * D4 — Webhook hardening: per-workflow shared secret.
 *
 * A webhook-triggered workflow must carry a secret in its `workflows.trigger`
 * jsonb (no schema change). External callers sign `<unix-seconds>.<raw-body>`
 * with HMAC-SHA256. Missing secrets fail closed.
 *
 * Pure and DB-free so the accept/reject matrix is unit-testable in isolation;
 * the route wires `isWebhookSignatureAuthorized` into its 401 branch.
 */

import { createHmac } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';

export { secretsMatch } from '$lib/server/secrets';

/** Legacy raw-secret header, retained only for callers importing the constant.
 *  The route no longer accepts it as authentication. */
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';
export const WEBHOOK_MAX_SKEW_SECONDS = 300;

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
 * `''` when none is configured (which the gate treats as disabled).
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
 * Legacy raw-secret comparator. Missing configuration fails closed. New HTTP
 * callers must use the timestamped HMAC helpers below instead.
 */
export function isWebhookAuthorized(
  trigger: TriggerLike | null | undefined,
  headerValue: string | null | undefined,
): boolean {
  const configured = getWebhookSecret(trigger);
  if (!configured) return false;
  return secretsMatch(configured, headerValue ?? null);
}

export function webhookSignature(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
}

export function isWebhookSignatureAuthorized(
  trigger: TriggerLike | null | undefined,
  timestamp: string | null | undefined,
  signature: string | null | undefined,
  rawBody: string,
  nowMs = Date.now(),
): boolean {
  const configured = getWebhookSecret(trigger);
  if (!configured || !timestamp || !signature) return false;
  if (!/^\d{10}$/.test(timestamp)) return false;
  const sentMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(sentMs) || Math.abs(nowMs - sentMs) > WEBHOOK_MAX_SKEW_SECONDS * 1000) {
    return false;
  }
  return secretsMatch(webhookSignature(configured, timestamp, rawBody), signature);
}
