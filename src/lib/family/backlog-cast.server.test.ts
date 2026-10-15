import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BacklogRecord } from './backlog';

const h = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));

const { castFile, evict, prepareCast, resetCastState } = await import('./backlog-cast.server');
const { verifyCastTicket, ticketFromSegment, CAST_CACHE_SECONDS } = await import('./backlog-cast');

const ID = '0b6f3c1e-8f4a-4c2b-9d7e-1a2b3c4d5e6f';
const SECRET = 'x'.repeat(48);

function item(over: Partial<BacklogRecord> = {}): BacklogRecord {
  const at = new Date('2026-10-15T18:00:00Z');
  return {
    id: ID, kind: 'video', url: 'https://www.tiktok.com/@a/video/1', canonicalUrl: 'tiktok:1', provider: 'tiktok',
    title: 'A dog on a skateboard', siteName: 'TikTok', thumbnailUrl: 'https://example.test/t.jpg', note: null,
    forEmail: null, addedByEmail: 'kid@example.test', status: 'new', doneByEmail: null, doneAt: null, taskId: null,
    createdAt: at, updatedAt: at, ...over,
  };
}

let dir: string;

/** A stand-in yt-dlp: writes a small file where `-o` says and prints its path — or fails like the real one. */
async function fakeYtDlp(behaviour: 'ok' | 'login' | 'filtered') {
  const script = join(dir, 'yt-dlp');
  const body = {
    ok: `out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
f=$(printf '%s' "$out" | sed 's/%(ext)s/mp4/'); printf 'not really a video' > "$f"; echo "$f"`,
    login: `echo "ERROR: [TikTok] 1: This post requires login; use --cookies" >&2; exit 1`,
    filtered: `exit 0`,
  }[behaviour];
  await writeFile(script, `#!/bin/sh\n${body}\n`);
  await chmod(script, 0o755);
  h.env.YT_DLP_PATH = script;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cast-test-'));
  h.env.CAST_CACHE_DIR = join(dir, 'cache');
  h.env.AUTH_SECRET = SECRET;
  resetCastState();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('prepareCast', () => {
  it('fetches a TikTok and answers with a link the TV can open', async () => {
    await fakeYtDlp('ok');
    const r = await prepareCast(item(), 'https://strangeramblings.com');
    expect(r).toMatchObject({ state: 'ready', contentType: 'video/mp4', title: 'A dog on a skateboard', posterUrl: 'https://example.test/t.jpg' });
    if (r.state !== 'ready') return;
    expect(r.mediaUrl.startsWith('https://strangeramblings.com/cast/')).toBe(true);
    expect(verifyCastTicket(ticketFromSegment(r.mediaUrl.split('/').pop()!), SECRET)).toBe(ID);
    expect(await castFile(ID)).toMatchObject({ size: 18 });
    // The scratch directory does not outlive the fetch.
    expect((await readdir(h.env.CAST_CACHE_DIR!)).sort()).toEqual([`${ID}.json`, `${ID}.mp4`]);
  });

  it('falls back to mirroring when the fetch needs a login, and does not retry at once', async () => {
    await fakeYtDlp('login');
    const r = await prepareCast(item(), 'https://x.test');
    expect(r).toMatchObject({ state: 'fallback', fallback: 'mirror', reason: expect.stringMatching(/login/) });
    await fakeYtDlp('ok');
    expect(await prepareCast(item(), 'https://x.test')).toMatchObject({ state: 'fallback' });
  });

  it('sends a YouTube failure to the YouTube app, which casts by itself', async () => {
    await fakeYtDlp('login');
    const r = await prepareCast(item({ provider: 'youtube', url: 'https://youtu.be/abc' }), 'https://x.test');
    expect(r).toMatchObject({ state: 'fallback', fallback: 'youtube_app', url: 'https://youtu.be/abc' });
  });

  it('says so when a video is filtered out as too long', async () => {
    await fakeYtDlp('filtered');
    expect(await prepareCast(item(), 'https://x.test')).toMatchObject({ state: 'fallback', reason: expect.stringMatching(/too long/) });
  });

  it('says so when yt-dlp is not installed', async () => {
    h.env.YT_DLP_PATH = join(dir, 'missing');
    expect(await prepareCast(item(), 'https://x.test')).toMatchObject({ state: 'fallback', reason: expect.stringMatching(/not installed/) });
  });

  it('never runs yt-dlp for a web page', async () => {
    h.env.YT_DLP_PATH = join(dir, 'missing');
    const r = await prepareCast(item({ kind: 'page', provider: 'web', url: 'https://example.test/a' }), 'https://x.test');
    expect(r).toMatchObject({ state: 'fallback', fallback: 'mirror', reason: expect.stringMatching(/web page/) });
  });
});

describe('evict', () => {
  it('removes files nobody has asked for in six hours', async () => {
    await fakeYtDlp('ok');
    await prepareCast(item(), 'https://x.test');
    const old = new Date(Date.now() - (CAST_CACHE_SECONDS + 60) * 1000);
    await utimes(join(h.env.CAST_CACHE_DIR!, `${ID}.mp4`), old, old);
    await evict();
    expect(await readdir(h.env.CAST_CACHE_DIR!)).toEqual([]);
  });
});
