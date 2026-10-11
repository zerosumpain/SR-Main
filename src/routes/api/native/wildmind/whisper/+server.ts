import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { rateLimit } from '$lib/server/rate-limit';
import { idempotencyKey, parseWhisperBody } from '$lib/wildmind/owner';
import { ownerLaneOpen, whisperToJkai } from '$lib/wildmind/owner.server';

/** Every whisper wakes a paid model call: three a minute per phone, on top of the native lane's own limit. */
const PER_DEVICE = { capacity: 3, refillPerSecond: 3 / 60 };

/**
 * Keys this phone has already been charged for. The limit is charged once per
 * Idempotency-Key, not per request: a retry of the same whisper (say after our
 * 5 s deadline passed while Wildmind had in fact taken it) must always reach
 * Wildmind's replay of its first answer, never our own slow-down. Ten minutes,
 * like Wildmind's own memory of keys.
 */
const KEY_TTL_MS = 10 * 60 * 1000;
const KEYS_MAX = 500;
const chargedKeys = new Map<string, number>();

function alreadyCharged(id: string, now: number): boolean {
  const seen = chargedKeys.get(id);
  return seen !== undefined && now - seen < KEY_TTL_MS;
}

function rememberCharged(id: string, now: number): void {
  for (const [k, at] of chargedKeys) if (now - at >= KEY_TTL_MS) chargedKeys.delete(k);
  while (chargedKeys.size >= KEYS_MAX) chargedKeys.delete(chargedKeys.keys().next().value as string);
  chargedKeys.set(id, now);
}

/**
 * POST /api/native/wildmind/whisper — a thought for JKai. Owner only; refused
 * while "View as" is on (withDevice, like every native write).
 *
 * Body `{ text }` (1..240 characters once trimmed; `to` is always JKai) and an
 * `Idempotency-Key: <uuid>` header, which is forwarded so the phone's retry of
 * the same message is answered once. Never retried here.
 *
 * 202 Wildmind's `{ v, ok, logId, when, pending, dropped, asleep, modelAvailable }`.
 * 400 `{ error: 'idempotency-key' | 'bad-request' | 'empty' | 'too-long' }`,
 * 403 `{ error: 'only-jkai' }`, 409 `{ error: 'dead' | 'halted' | 'between-lives' }`,
 * 422 `{ error: 'key-reused' }` (the same key sent again with different words),
 * 429 `{ error: 'slow-down' }` with retry-after (this phone's limit, charged once per
 *     key so a retry always reaches Wildmind's replay, or Wildmind's own),
 * 503 `{ error: 'offline' }` when the lane is closed or Wildmind does not answer.
 */
export const POST: RequestHandler = withDevice(async ({ request }, identity) => {
  if (!ownerLaneOpen()) return json({ error: 'offline' }, { status: 503 });
  const key = idempotencyKey(request.headers.get('idempotency-key'));
  if (!key) return json({ error: 'idempotency-key' }, { status: 400 });
  const body = parseWhisperBody(await request.json().catch(() => null));
  if ('error' in body) return json({ error: body.error }, { status: 400 });

  const now = Date.now();
  const charge = `${identity.id}:${key}`;
  if (!alreadyCharged(charge, now)) {
    const limit = rateLimit(`wildmind-whisper:${identity.id}`, PER_DEVICE);
    if (!limit.allowed) {
      return json(
        { error: 'slow-down' },
        { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) } },
      );
    }
    rememberCharged(charge, now);
  }

  const out = await whisperToJkai(body.text, key);
  const headers = 'retryAfter' in out && out.retryAfter ? { 'retry-after': String(out.retryAfter) } : undefined;
  return json(out.body, { status: out.status, headers });
});
