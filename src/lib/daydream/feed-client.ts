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

export { ago, stamp, pct, when } from './format';
