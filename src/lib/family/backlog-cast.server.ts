// Playing a family backlog item on a TV — the half with a disk, a clock and a
// child process. The rules and the ticket are ./backlog-cast.
//
// One process serves the site, so the jobs live in memory: asking again for an
// item already being fetched joins that fetch. The cache is a directory of
// `<item id>.mp4` files with a `.json` beside each; a file's mtime is when it
// was last asked for, and the oldest go first when the cache is over its cap.
// The VPS disk filling up has taken Postgres down before, so a fetch never
// starts without room to spare and never outlives its own ceiling.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readdir, readFile, rename, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises';
import { env } from '$env/dynamic/private';
import { pushName, type BacklogRecord } from './backlog';
import {
  CAST_CACHE_BYTES,
  CAST_CACHE_SECONDS,
  CAST_MIN_FREE_BYTES,
  CAST_RETRY_SECONDS,
  castMediaPath,
  castRoute,
  failureReason,
  fallback,
  issueCastTicket,
  ytDlpArgs,
  type CastWire,
} from './backlog-cast';

const exec = promisify(execFile);
/** One fetch, start to finish, including the merge. */
const FETCH_TIMEOUT_MS = 10 * 60_000;
/** Fetches at once; the rest wait their turn (and the phone keeps polling). */
const CONCURRENT = 2;
/** How long one request waits for a fetch before answering "preparing". A TikTok is usually done by then. */
const WAIT_MS = 8_000;

interface Meta {
  durationSeconds: number | null;
}

const jobs = new Map<string, Promise<void>>();
const failures = new Map<string, { reason: string; at: number }>();
let running = 0;
const waiting: Array<() => void> = [];

/** On disk, not /tmp: newer Debian mounts /tmp in RAM, and this holds up to 2 GB. */
export function cacheDir(): string {
  return env.CAST_CACHE_DIR || join(homedir(), '.cache', 'sr-backlog-cast');
}

function mediaFile(id: string) {
  return join(cacheDir(), `${id}.mp4`);
}

/** The cached file for an item, for the TV route — or null when it was evicted. */
export async function castFile(id: string): Promise<{ path: string; size: number } | null> {
  try {
    const s = await stat(mediaFile(id));
    return s.isFile() ? { path: mediaFile(id), size: s.size } : null;
  } catch {
    return null;
  }
}

/**
 * What the phone should do with this item now: play a link, ask again shortly,
 * or fall back to the phone. Starts the fetch when nothing has yet.
 */
export async function prepareCast(item: BacklogRecord, origin: string, nowMs = Date.now()): Promise<CastWire> {
  const route = castRoute(item);
  if (!route.fetch) return route.fallback;

  const ready = await readyWire(item, origin, nowMs);
  if (ready) return ready;

  const failed = failures.get(item.id);
  if (failed && nowMs - failed.at < CAST_RETRY_SECONDS * 1000) return fallback(item, failed.reason);
  failures.delete(item.id);

  let job = jobs.get(item.id);
  if (!job) {
    job = fetchItem(item).finally(() => jobs.delete(item.id));
    jobs.set(item.id, job);
  }
  await Promise.race([job, new Promise((r) => setTimeout(r, WAIT_MS))]);

  const after = await readyWire(item, origin, Date.now());
  if (after) return after;
  const nowFailed = failures.get(item.id);
  if (nowFailed) return fallback(item, nowFailed.reason);
  return { state: 'preparing', retryAfterSeconds: 3 };
}

async function readyWire(item: BacklogRecord, origin: string, nowMs: number): Promise<CastWire | null> {
  const file = await castFile(item.id);
  if (!file) return null;
  // Asked for again: it is fresh for another six hours.
  const now = new Date(nowMs);
  await utimes(file.path, now, now).catch(() => {});
  const meta = await readMeta(item.id);
  const { ticket, expiresAt } = issueCastTicket(item.id, env.AUTH_SECRET ?? '', nowMs);
  return {
    state: 'ready',
    mediaUrl: `${origin}${castMediaPath(ticket)}`,
    contentType: 'video/mp4',
    title: item.title ?? pushName(item),
    posterUrl: item.thumbnailUrl,
    durationSeconds: meta?.durationSeconds ?? null,
    expiresAt: expiresAt.toISOString(),
  };
}

async function readMeta(id: string): Promise<Meta | null> {
  try {
    return JSON.parse(await readFile(join(cacheDir(), `${id}.json`), 'utf8')) as Meta;
  } catch {
    return null;
  }
}

async function turn(): Promise<() => void> {
  if (running >= CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  running++;
  return () => {
    running--;
    waiting.shift()?.();
  };
}

async function fetchItem(item: BacklogRecord): Promise<void> {
  const release = await turn();
  const dir = cacheDir();
  const work = join(dir, `.partial-${item.id}`);
  try {
    await mkdir(dir, { recursive: true });
    await evict();
    const disk = await statfs(dir);
    if (disk.bavail * disk.bsize < CAST_MIN_FREE_BYTES) {
      throw new CastFailure('The server is short of disk space, so it cannot fetch videos just now.');
    }
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    let printed: string;
    try {
      const { stdout } = await exec(env.YT_DLP_PATH || 'yt-dlp', ytDlpArgs(item.url!, join(work, 'video.%(ext)s')), {
        timeout: FETCH_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      printed = stdout.trim().split('\n').pop() ?? '';
    } catch (err) {
      const e = err as { code?: string; stderr?: string };
      if (e.code === 'ENOENT') throw new CastFailure('The server cannot fetch videos yet (yt-dlp is not installed).');
      console.warn('[backlog-cast] yt-dlp failed', item.id, (e.stderr ?? String(err)).slice(0, 500));
      throw new CastFailure(failureReason(e.stderr ?? ''));
    }
    // Nothing printed and no error: the match filter turned it away.
    if (!printed.endsWith('.mp4')) throw new CastFailure('That video is too long (or live), so it is not fetched for the TV.');
    const durationSeconds = await probeDuration(printed);
    await writeFile(join(dir, `${item.id}.json`), JSON.stringify({ durationSeconds } satisfies Meta));
    await rename(printed, mediaFile(item.id));
  } catch (err) {
    const reason = err instanceof CastFailure ? err.message : 'The video could not be fetched for the TV.';
    if (!(err instanceof CastFailure)) console.warn('[backlog-cast] fetch failed', item.id, err);
    failures.set(item.id, { reason, at: Date.now() });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    release();
  }
}

class CastFailure extends Error {}

async function probeDuration(path: string): Promise<number | null> {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], {
      timeout: 30_000,
    });
    const d = Math.round(Number(stdout.trim()));
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** Out with files nobody has asked for in six hours, then the oldest until the cache is under its cap. */
export async function evict(nowMs = Date.now()): Promise<void> {
  const dir = cacheDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const files: Array<{ id: string; size: number; mtime: number }> = [];
  for (const name of names) {
    if (!name.endsWith('.mp4')) continue;
    const s = await stat(join(dir, name)).catch(() => null);
    if (s) files.push({ id: name.slice(0, -4), size: s.size, mtime: s.mtimeMs });
  }
  files.sort((a, b) => a.mtime - b.mtime);
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of files) {
    const stale = nowMs - f.mtime > CAST_CACHE_SECONDS * 1000;
    if (!stale && total <= CAST_CACHE_BYTES) continue;
    await rm(join(dir, `${f.id}.mp4`), { force: true });
    await rm(join(dir, `${f.id}.json`), { force: true });
    total -= f.size;
  }
}

/** For tests: forget jobs and failures. */
export function resetCastState(): void {
  jobs.clear();
  failures.clear();
}
