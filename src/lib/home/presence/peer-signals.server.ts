/**
 * Signals between this site's own processes, over Postgres LISTEN/NOTIFY.
 *
 * On the VPS the site runs as two processes from one release: the `http` web
 * app and the `worker` (see $lib/server/service-role). Most state they share
 * lives in the database already. The exception is the trail generation
 * ($lib/home/presence/trail-generation): an in-memory counter every trail
 * writer moves so presence readers can keep a scan of the trail until it goes
 * stale. household-live and daydream-observe write the trail in the worker
 * while /home and the Family pages read it in the web app, so without this the
 * readers would sit on stale rows up to their time limits (90–120 s).
 *
 * Deliberately NOT a relay for the platform bus: `workflows-client/event-bus`
 * subscribes to every event in every process, so re-emitting another
 * process's events would start event-triggered workflows twice. Each process
 * handles the events it emits, exactly once, as before.
 *
 * Best effort by design. A lost signal costs freshness, never correctness: the
 * caches' own time limits still apply. On (re)connect the counter is moved
 * once, because signals sent while disconnected were missed.
 */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { onTrailChanged, trailChangedElsewhere } from './trail-generation';

export const TRAIL_CHANNEL = 'sr_trail_changed';
const INSTANCE = randomUUID();
const RECONNECT_MS = 5_000;
/** One NOTIFY per burst: a companion page writes dozens of fixes in a loop. */
const COALESCE_MS = 250;

let started = false;
let client: Client | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

/** The payload this process sends; a process ignores its own. */
export function signalPayload(): string {
  return INSTANCE;
}

/** What a received notification means for this process. PURE. */
export function isFromPeer(channel: string, payload: string | undefined): boolean {
  return channel === TRAIL_CHANNEL && !!payload && payload !== INSTANCE;
}

function announceTrailChanged(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    db.execute(sql`select pg_notify(${TRAIL_CHANNEL}, ${INSTANCE})`).catch((err) =>
      console.warn('[peer-signals] notify failed:', err instanceof Error ? err.message : err),
    );
  }, COALESCE_MS);
  pending.unref?.();
}

const dead = new WeakSet<Client>();

async function connect(): Promise<void> {
  const c = new Client({ connectionString: env.DATABASE_URL });
  c.on('notification', (msg) => {
    if (isFromPeer(msg.channel, msg.payload)) trailChangedElsewhere();
  });
  // 'error' and 'end' both fire for one lost connection: retire it once.
  c.on('error', (err) => retire(c, err));
  c.on('end', () => retire(c));
  try {
    await c.connect();
    await c.query(`LISTEN ${TRAIL_CHANNEL}`);
  } catch (err) {
    retire(c, err);
    return;
  }
  if (dead.has(c)) return;
  client = c;
  // Whatever was signalled while this process was not listening is lost.
  trailChangedElsewhere();
}

function retire(c: Client, err?: unknown): void {
  if (dead.has(c)) return;
  dead.add(c);
  if (client === c) client = null;
  if (err) console.warn('[peer-signals] listener lost, retrying:', err instanceof Error ? err.message : err);
  c.end().catch(() => {});
  setTimeout(() => void connect(), RECONNECT_MS).unref?.();
}

/** Once per process, from hooks.server.ts under the `peers` service. */
export function startPeerSignals(): void {
  if (started) return;
  started = true;
  onTrailChanged(announceTrailChanged);
  void connect();
}
