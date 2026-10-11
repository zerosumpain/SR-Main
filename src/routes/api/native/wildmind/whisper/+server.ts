import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { rateLimit } from '$lib/server/rate-limit';
import { idempotencyKey, parseWhisperBody } from '$lib/wildmind/owner';
import { ownerLaneOpen, whisperToJkai } from '$lib/wildmind/owner.server';

/** Every whisper wakes a paid model call: three a minute per phone, on top of the native lane's own limit. */
const PER_DEVICE = { capacity: 3, refillPerSecond: 3 / 60 };

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
 * 429 `{ error: 'slow-down' }` with retry-after (this phone's limit or Wildmind's),
 * 503 `{ error: 'offline' }` when the lane is closed or Wildmind does not answer.
 */
export const POST: RequestHandler = withDevice(async ({ request }, identity) => {
  if (!ownerLaneOpen()) return json({ error: 'offline' }, { status: 503 });
  const key = idempotencyKey(request.headers.get('idempotency-key'));
  if (!key) return json({ error: 'idempotency-key' }, { status: 400 });
  const body = parseWhisperBody(await request.json().catch(() => null));
  if ('error' in body) return json({ error: body.error }, { status: 400 });

  const limit = rateLimit(`wildmind-whisper:${identity.id}`, PER_DEVICE);
  if (!limit.allowed) {
    return json(
      { error: 'slow-down' },
      { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) } },
    );
  }

  const out = await whisperToJkai(body.text, key);
  const headers = 'retryAfter' in out && out.retryAfter ? { 'retry-after': String(out.retryAfter) } : undefined;
  return json(out.body, { status: out.status, headers });
});
