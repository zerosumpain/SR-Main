// src/lib/daydream/feed-client.ts
//
// The browser's one way of acting on a thought: POST `/api/daydream/thoughts`.
// Pure fetch, no `$lib/db`, so it is safe in a component — the page modules
// that reach the database fail the BUILD, not the type-check.

export interface ThoughtActionResult<T = Record<string, unknown>> {
  ok: boolean;
  out: T & { error?: string };
  error: string | null;
}

export async function postThought<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<ThoughtActionResult<T>> {
  try {
    const res = await fetch('/api/daydream/thoughts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok || out.error) return { ok: false, out, error: out.error ?? `HTTP ${res.status}` };
    return { ok: true, out, error: null };
  } catch (err) {
    return { ok: false, out: {} as T & { error?: string }, error: err instanceof Error ? err.message : 'that did not work' };
  }
}

/** The steps of the relevance dial and what each means. The card read-out is
 *  TERSE; the sentence rides in `title` and is printed in full in the drill. */
export const RELEVANCE_STEPS = [1, 2, 3, 4, 5] as const;
export const RELEVANCE_HINT: Record<number, string> = {
  1: 'Not my concern — push this kind of subject down',
  2: 'Marginal',
  3: 'Ordinary — no opinion either way',
  4: 'Worth my attention',
  5: 'This is what I care about — push this kind of subject up',
};
export const RELEVANCE_TERSE: Record<number, string> = {
  1: 'not my concern',
  2: 'marginal',
  3: 'ordinary',
  4: 'worth attention',
  5: 'what I care about',
};

/** Statuses that mean "this reached him". Only these can be rated. */
export const SHOWN_STATUSES = ['delivered', 'seen', 'actioned'];

export function reviewWord(verdict: string | null): string {
  return verdict === 'verified'
    ? 'checked · holds up'
    : verdict === 'refuted'
      ? 'checked · does not hold'
      : verdict
        ? 'checked · cannot tell'
        : '';
}

export { ago, stamp, pct, when } from './format';
