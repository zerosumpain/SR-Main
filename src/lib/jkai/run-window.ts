// src/lib/jkai/run-window.ts
// Hands a code block off to the detached runner window at /jkai/run.
//
// The payload travels through localStorage under a one-shot id rather than the
// query string: a snippet is routinely longer than a URL can carry, and putting
// source into the address bar would also drop it into history and any proxy log
// on the way. Same origin, so the runner reads it straight back out.
//
// The entry is deliberately NOT deleted on read — reloading the runner window is
// the obvious way to re-run something, and a consumed key would turn that into
// "snippet expired". Stale entries are swept on the next open instead.

import type { RunLane } from '$lib/jkai/code-blocks';

export type RunPayload = {
  code: string;
  lang: string;
  lane: RunLane;
  /** Epoch ms, used only by the sweep. */
  at: number;
};

const KEY_PREFIX = 'jkai:run:';
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h — long enough to survive a lunch break
const MAX_CODE_CHARS = 400_000;

/** One window, reused. Repeat clicks replace its contents rather than tiling
 *  the desktop with runners. */
const WINDOW_NAME = 'jkai-runner';

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Drop runner payloads older than MAX_AGE_MS so the quota can't creep. */
function sweepStale(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(KEY_PREFIX)) continue;
      try {
        const { at } = JSON.parse(localStorage.getItem(k) ?? '{}') as { at?: number };
        if (!at || Date.now() - at > MAX_AGE_MS) doomed.push(k);
      } catch {
        doomed.push(k); // unparseable is stale by definition
      }
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* private mode / quota — the open below still works, it just won't tidy */
  }
}

export function readRunPayload(id: string): RunPayload | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + id);
    if (!raw) return null;
    const p = JSON.parse(raw) as RunPayload;
    return typeof p?.code === 'string' ? p : null;
  } catch {
    return null;
  }
}

export type OpenResult = { ok: true } | { ok: false; reason: 'blocked' | 'too-big' | 'storage' };

/**
 * Open the runner. Called straight from a click handler so the popup blocker
 * treats it as user-initiated — move this behind an await and browsers will
 * start refusing it.
 */
export function openRunnerWindow(code: string, lang: string, lane: RunLane): OpenResult {
  if (code.length > MAX_CODE_CHARS) return { ok: false, reason: 'too-big' };

  const id = newId();
  sweepStale();
  try {
    localStorage.setItem(KEY_PREFIX + id, JSON.stringify({ code, lang, lane, at: Date.now() }));
  } catch {
    return { ok: false, reason: 'storage' };
  }

  const w = window.open(
    `/jkai/run#${id}`,
    WINDOW_NAME,
    'width=820,height=760,menubar=no,toolbar=no,location=no,status=no',
  );
  if (!w) {
    localStorage.removeItem(KEY_PREFIX + id);
    return { ok: false, reason: 'blocked' };
  }
  try {
    w.focus();
  } catch {
    /* focus is a courtesy, not a requirement */
  }
  return { ok: true };
}
