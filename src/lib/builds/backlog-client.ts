// src/lib/builds/backlog-client.ts
//
// The browser's one way of acting on the build backlog: POST `/api/jkai/backlog`.
// Pure fetch, no `$lib/db`, so it is safe in a component. Same result shape the
// daydream feed's `postThought` has, because the board was written against it.

export interface BacklogActionResult<T = Record<string, unknown>> {
  ok: boolean;
  out: T & { error?: string };
  error: string | null;
}

export async function postBacklog<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<BacklogActionResult<T>> {
  try {
    const res = await fetch('/api/jkai/backlog', {
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
