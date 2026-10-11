// owner.server.ts — the VPS's client for Wildmind's token-gated OWNER lane.
//
// PROSE HERE IS OWNER-ONLY (see ./owner.ts). This is the only code that talks
// to the owner listener, and only the `withDevice` routes under
// /api/native/wildmind/* call it. It has no memo and shares nothing with the
// landing page's public read ($lib/landing/wildmind.server), so an owner
// answer can never be served to a visitor.
//
// The lane is WILDMIND_OWNER_URL (e.g. http://100.83.68.108:5393, porkserv on
// the tailnet) and WILDMIND_OWNER_TOKEN (the bearer Wildmind checks; at least
// 32 characters). Either unset, or a short token, and the lane is closed: the
// reads answer `{ state: 'offline' }` and a whisper 503s, without a request.
// There is no default address and no fallback to the public snapshot URL.
//
// The token is sent as a header and nowhere else: never in a URL, a log line,
// an error or a response. Requests are fixed GETs and one POST built here from
// validated values; redirects are refused, every call has a 5 s deadline, the
// body is capped before it is parsed, and every answer is re-validated by the
// schemas in ./owner.ts. A whisper is NEVER retried here: the phone retries,
// with the same Idempotency-Key, and Wildmind replays its first answer.

import { env } from '$env/dynamic/private';
import type { z } from 'zod';
import { cappedText } from './http.server';
import { WhisperAcceptedSchema, type OwnerWhisperAccepted } from './owner';

const TIMEOUT_MS = 5000;
/** A full talk page or a long life's timeline is a few hundred KB; far above that is wrong. */
const MAX_BYTES = 1024 * 1024;
const PREFIX = '/api/owner/v1';
const TOKEN_MIN = 32;

interface Lane {
  base: string;
  token: string;
}

let warned = false;

/** The configured lane, or null when it is closed. */
function lane(): Lane | null {
  const raw = env.WILDMIND_OWNER_URL?.trim();
  const token = env.WILDMIND_OWNER_TOKEN?.trim();
  if (!raw || !token) return null;
  if (token.length < TOKEN_MIN) {
    if (!warned) console.warn(`[wildmind-owner] WILDMIND_OWNER_TOKEN is shorter than ${TOKEN_MIN} characters; the lane stays closed.`);
    warned = true;
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    if (!warned) console.warn('[wildmind-owner] WILDMIND_OWNER_URL is not a URL; the lane stays closed.');
    warned = true;
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return { base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, token };
}

export function ownerLaneOpen(): boolean {
  return lane() !== null;
}

type Route = 'talk' | 'chronicle' | 'inventions' | 'whispers';

export type OwnerRead<T> = ({ state: 'live' } & T) | { state: 'offline' } | { state: 'not-found' };

/**
 * One GET of the owner lane, parsed by `schema`. Any failure — lane closed,
 * no answer, a refusal, a body that is too big or not the contract — is
 * `offline`; a 404 from Wildmind (a person the valley does not have) is
 * `not-found`. Never throws.
 */
export async function readOwner<S extends z.ZodType>(
  route: Route,
  query: URLSearchParams,
  schema: S,
): Promise<OwnerRead<z.output<S>>> {
  const l = lane();
  if (!l) return { state: 'offline' };
  try {
    const qs = query.toString();
    const res = await fetch(`${l.base}${PREFIX}/${route}${qs ? `?${qs}` : ''}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${l.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 404 && route === 'chronicle') return { state: 'not-found' };
      console.warn(`[wildmind-owner] ${route}: status ${res.status}`);
      return { state: 'offline' };
    }
    const parsed = schema.safeParse(JSON.parse(await cappedText(res, MAX_BYTES)));
    if (!parsed.success) {
      console.warn(`[wildmind-owner] ${route}: not the owner contract`);
      return { state: 'offline' };
    }
    return { state: 'live', ...(parsed.data as object) } as OwnerRead<z.output<S>>;
  } catch (err) {
    console.warn(`[wildmind-owner] ${route}: ${err instanceof Error ? err.name : 'failed'}`);
    return { state: 'offline' };
  }
}

/** The fixed error strings a whisper can come back with, by status. */
const WHISPER_ERRORS: Record<number, readonly string[]> = {
  400: ['empty', 'too-long'],
  403: ['only-jkai'],
  409: ['dead', 'halted', 'between-lives'],
  // The same Idempotency-Key sent again with different words.
  422: ['key-reused'],
  429: ['slow-down'],
};
const WHISPER_FALLBACK: Record<number, string> = { 400: 'bad-request', 403: 'only-jkai', 409: 'unavailable', 422: 'key-reused', 429: 'slow-down' };

export type WhisperOutcome =
  | { status: 202; body: OwnerWhisperAccepted }
  | { status: 400 | 403 | 409 | 422 | 429 | 503; body: { error: string }; retryAfter?: number };

const OFFLINE = { status: 503, body: { error: 'offline' } } as const;

function retryAfter(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.ceil(n), 3600) : 20;
}

/**
 * POST one whisper to JKai. `to` is always "main". Wildmind's refusals keep
 * their status and come back as one of its fixed strings (anything else it
 * says is replaced, never forwarded); anything else at all — closed lane, no
 * answer, a timeout, an unexpected status or body — is 503 `offline`. One
 * attempt only.
 */
export async function whisperToJkai(text: string, key: string): Promise<WhisperOutcome> {
  const l = lane();
  if (!l) return OFFLINE;
  try {
    const res = await fetch(`${l.base}${PREFIX}/whisper`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${l.token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify({ to: 'main', text }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await cappedText(res, 64 * 1024).catch(() => '');
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (res.status === 202 || res.status === 200) {
      const parsed = WhisperAcceptedSchema.safeParse(body);
      if (parsed.success) return { status: 202, body: parsed.data };
      console.warn('[wildmind-owner] whisper: accepted, but not the owner contract');
      return OFFLINE;
    }
    const allowed = WHISPER_ERRORS[res.status];
    if (allowed) {
      const said = (body as { error?: unknown } | null)?.error;
      const error = typeof said === 'string' && allowed.includes(said) ? said : WHISPER_FALLBACK[res.status];
      const status = res.status as 400 | 403 | 409 | 422 | 429;
      return status === 429
        ? { status, body: { error }, retryAfter: retryAfter(res.headers.get('retry-after')) }
        : { status, body: { error } };
    }
    console.warn(`[wildmind-owner] whisper: status ${res.status}`);
    return OFFLINE;
  } catch (err) {
    console.warn(`[wildmind-owner] whisper: ${err instanceof Error ? err.name : 'failed'}`);
    return OFFLINE;
  }
}
