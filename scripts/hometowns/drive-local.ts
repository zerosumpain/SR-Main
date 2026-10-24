// Plays a solo Hometowns county through the games API the way a phone does
// (spec §14.2 item 4, WP4): one device token, one SSE stream, moves posted
// to the generic act endpoint with ids and `since`, and every frame checked:
//   - DELTA CHECK: each frame is merged onto the one before it on its own
//     chain (the stream is one chain, requests are another) with the wire's
//     merge rule, and the merged town must hash to the frame's `townHash`;
//   - CANARY (§10.4 item 8): between the driver's own moves, the town held
//     from one request is ticked forward locally with the engine, from the
//     frame's snapshot and `predict` block alone, to the tick of the next
//     request, and must hash to the server's `townHash` there. That is the
//     phone's exact prediction, and the M1 exit asks for zero mismatches;
//   - A28: after any frame whose rev went backwards (a lost write), moves the
//     server said yes to but no longer lists are posted again.
// The mayor is the engine's Balanced bot, fed from the wire.
//
// Against the local stack (no address or token in this file, A36):
//   HOMETOWNS_BASE=http://<preview host>:15401 HOMETOWNS_TOKEN=<device token> \
//     npx tsx scripts/hometowns/drive-local.ts [--days 2] [--dev-tick 30000] [--seed 1]
//       [--restart-cmd "<shell command that restarts main-family>"] [--restart-at 0.5] [--json]
// It needs the server's HOMETOWNS_DEV_CLOCK=1 for a dev tick; on the real
// clock a day takes a day. Exit status 1 on any canary or delta mismatch.
//
// In-process (the Vitest suite): import `driveSolo` and hand it a Transport
// over rooms.server and a Clock over fake timers.

import { applyFrame } from '../../src/lib/games/hometowns/wire';
import { RETRY_MESSAGE } from '../../src/lib/games/hometowns/hometowns';
import { paramsFor, population, stateHash, tickTown, townContext, type Command, type TownState } from '../../src/lib/games/hometowns/engine/index';
import { BOTS, type BotView } from '../../src/lib/games/hometowns/engine/bots/index';
import { checklistOf } from '../../src/lib/games/hometowns/engine/tiers';
import type { HometownsWire } from '../../src/lib/games/hometowns/engine/wire';

/** A refusal as the API sends it: `{ error }` with a status. */
export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The four calls a phone makes. Each answers the room as this player sees it. */
export interface Transport {
  start(body: Record<string, unknown>): Promise<HometownsWire>;
  act(id: string, body: Record<string, unknown>): Promise<HometownsWire>;
  view(id: string): Promise<HometownsWire>;
  /** Follows the room; returns the unsubscribe. */
  stream(id: string, onFrame: (frame: HometownsWire) => void): () => void;
}

export interface Clock {
  now(): number;
  wait(ms: number): Promise<void>;
}

export interface DriveOptions {
  transport: Transport;
  clock: Clock;
  /** Regional Days to play after founding (default 2). */
  days?: number;
  devTickMs?: number;
  seed?: number;
  site?: number;
  /** Restarts the server mid-run (the local stack's main-family; in-process, a rehydrate). */
  restart?: () => Promise<void>;
  /** When to restart, as a share of the run (default 0.5). */
  restartAt?: number;
  /** Ticks between the mayor's sessions (default 6). */
  sessionTicks?: number;
  log?: (line: string) => void;
}

export interface DriveReport {
  roomId: string;
  frames: { stream: number; requests: number; whole: number; deltas: number };
  delta: { checked: number; mismatches: number };
  canary: { checked: number; mismatches: number; ticks: number };
  moves: { posted: number; accepted: number; refused: number; retried: number; reposted: number };
  resyncs: number;
  restarts: number;
  regionalDays: number;
  final: { tick: number; pop: number; dayIndex: number; rev: number } | null;
}

/** Driver-side randomness for the bot (not the engine's; nothing here is predicted). */
function botRng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Presence moves the server never logs, so a frame never lists them (and they are never re-posted). */
const QUIET = new Set(['hello', 'seen', 'visit', 'stats']);

/** One chain of frames, each cut against the one before it. */
class Chain {
  held: HometownsWire | null = null;
  maxRev = 0;
  constructor(private readonly r: DriveReport) {}

  /** Merges and checks a frame; null when it could not be merged (the caller fetches a whole one). */
  take(frame: HometownsWire): HometownsWire | null {
    let whole: HometownsWire;
    if (frame.base === null) {
      whole = clone(frame);
      this.r.frames.whole++;
    } else {
      if (!this.held || this.held.rev !== frame.base) {
        this.r.resyncs++;
        return null;
      }
      whole = clone(applyFrame(this.held, frame));
      this.r.frames.deltas++;
    }
    const t = whole.me?.town;
    if (t) {
      this.r.delta.checked++;
      if (stateHash(t) !== whole.me!.townHash) this.r.delta.mismatches++;
    }
    this.held = whole;
    return whole;
  }
}

/** The town at `held`, ticked forward to `tick` with the engine from the frame's own inputs. */
export function predictTown(held: HometownsWire, tick: number): TownState | null {
  const me = held.me;
  if (!me?.town || !me.snapshot || !me.predict || me.town.gridBase === null) return null;
  const t = clone(me.town);
  const p = me.predict;
  const env = { params: paramsFor(p.paramsVersion), snapshot: me.snapshot, rivalry: p.rivalry, mishaps: p.mishaps, dayIndex: p.dayIndex };
  // The grid's origin (epoch + paused time) from the frame's clock: tick g ends at origin + (g + 1)·tickMs.
  const origin = held.clock.nextTickAt - (held.clock.gridTick + 1) * held.clock.tickMs;
  while (t.tick < tick) {
    const g = t.gridBase! + t.tick;
    tickTown(t, townContext(t, p.townIndex, t.tick, env, origin + (g + 1) * held.clock.tickMs, false));
  }
  return t;
}

/** What the Balanced bot sees, from a frame alone (the BotView a phone could build). */
function botView(f: HometownsWire, now: number): BotView | null {
  const me = f.me;
  if (!me?.town || !me.snapshot || !me.predict) return null;
  const params = paramsFor(me.predict.paramsVersion);
  const town = clone(me.town);
  return {
    seat: me.seat,
    townIndex: me.predict.townIndex,
    town,
    snapshot: me.snapshot,
    params,
    now,
    dayIndex: me.predict.dayIndex,
    countyWeek: false,
    untilRegionalDay: f.clock.nextRegionalDayAt - now,
    profile: me.profile,
    pop: population(town),
    wants: (me.derived?.wants ?? []).map((w) => w.key),
    advisors: (me.derived?.advisors ?? []).map((a) => a.key),
    checklist: checklistOf(town),
    others: (f.towns ?? []).map((card, k) => (k === me.predict!.townIndex ? null : card)),
    env: { params, snapshot: me.snapshot, rivalry: me.predict.rivalry, mishaps: me.predict.mishaps, dayIndex: me.predict.dayIndex },
  };
}

export async function driveSolo(o: DriveOptions): Promise<DriveReport> {
  const { transport: tx, clock } = o;
  const log = o.log ?? (() => {});
  const devTickMs = o.devTickMs ?? 30_000;
  const days = o.days ?? 2;
  const r: DriveReport = {
    roomId: '',
    frames: { stream: 0, requests: 0, whole: 0, deltas: 0 },
    delta: { checked: 0, mismatches: 0 },
    canary: { checked: 0, mismatches: 0, ticks: 0 },
    moves: { posted: 0, accepted: 0, refused: 0, retried: 0, reposted: 0 },
    resyncs: 0,
    restarts: 0,
    regionalDays: 0,
    final: null,
  };
  const requests = new Chain(r);
  let stream = new Chain(r);
  /** The town as of the driver's last move or view, for the canary; null until it is on the grid. */
  let base: HometownsWire | null = null;
  /** Moves the server accepted, newest last (A28 re-posting). */
  const accepted: { id: string; body: Record<string, unknown> }[] = [];

  const first = await tx.start({
    game: 'hometowns',
    difficulty: 'easy',
    pace: 'async',
    county: { name: 'Drive County', rivalry: 'friendly', regionalHour: 18, mishaps: 'mild', devTickMs, seed: o.seed ?? 1 },
  });
  const id = first.id;
  r.roomId = id;
  requests.take(first);
  r.frames.requests++;
  const follow = () =>
    tx.stream(id, (f) => {
      r.frames.stream++;
      if (!stream.take(f)) stream = new Chain(r);
    });
  let unfollow = follow();

  /** A whole frame by GET; checks the canary against the town held since the last move. */
  async function look(): Promise<HometownsWire> {
    const f = requests.take(await tx.view(id))!;
    r.frames.requests++;
    const t = f.me?.town;
    if (base?.me?.town && t && t.tick > base.me.town.tick && f.me!.predict?.dayIndex === base.me.predict?.dayIndex) {
      const predicted = predictTown(base, t.tick);
      if (predicted) {
        r.canary.checked++;
        r.canary.ticks += t.tick - base.me.town.tick;
        if (stateHash(predicted) !== f.me!.townHash) {
          r.canary.mismatches++;
          log(`canary mismatch at tick ${t.tick}`);
          await post({ action: 'stats', canary: { tick: t.tick, ok: false } }).catch(() => {});
        }
      }
    }
    base = f;
    return f;
  }

  /** One move with `since`; a Regional Day still finishing is retried after a second (A19). */
  async function post(body: Record<string, unknown>): Promise<HometownsWire | null> {
    r.moves.posted++;
    for (let attempt = 0; ; attempt++) {
      try {
        const since = requests.held?.rev ?? null;
        const f = await tx.act(id, since === null ? body : { ...body, since });
        r.frames.requests++;
        const whole = requests.take(f) ?? (await look());
        r.moves.accepted++;
        const mid = (body.planId ?? body.moveId) as string | undefined;
        if (mid && !QUIET.has(String(body.action))) {
          accepted.push({ id: mid, body });
          while (accepted.length > 20) accepted.shift();
        }
        if (whole.rev < requests.maxRev) await repost(whole);
        requests.maxRev = Math.max(requests.maxRev, whole.rev);
        base = whole;
        return whole;
      } catch (e) {
        if (e instanceof DriveError && e.status === 409 && e.message === RETRY_MESSAGE && attempt < 10) {
          r.moves.retried++;
          await clock.wait(1_000);
          continue;
        }
        if (e instanceof DriveError) {
          r.moves.refused++;
          log(`refused ${String(body.action)}: ${e.message}`);
          return null;
        }
        throw e;
      }
    }
  }

  /** A28: after a frame whose rev went backwards, post again what it no longer shows. */
  async function repost(f: HometownsWire): Promise<void> {
    const shown = new Set((f.me?.moves ?? []).map((m) => m.id));
    for (const m of accepted.filter((a) => !shown.has(a.id))) {
      r.moves.reposted++;
      await post(m.body);
    }
  }

  await post({ action: 'start' });
  await post({ action: 'hello' });
  await post({ action: 'found', site: o.site ?? 0, nameParts: ['Bramble', 'ford'], avatar: 'badger', flag: 1, moveId: 'drive-found' });
  for (let k = 0; k < 12; k++) {
    await clock.wait(10_500);
    await post({ action: 'sprint', moveId: `drive-sprint-${k}` });
  }

  const dayMs = 48 * devTickMs;
  const startedAt = clock.now();
  const endAt = startedAt + days * dayMs;
  // One restart a run, part-way through.
  let restartAt = o.restart ? startedAt + (o.restartAt ?? 0.5) * days * dayMs : Infinity;
  const startDay = requests.held?.me?.predict?.dayIndex ?? 0;
  const bot = BOTS.balanced;
  let session = 0;
  while (clock.now() < endAt) {
    await clock.wait((o.sessionTicks ?? 6) * devTickMs);
    if (clock.now() >= restartAt) {
      unfollow();
      log('restarting the server');
      await o.restart!();
      r.restarts++;
      restartAt = Infinity;
      stream = new Chain(r);
      unfollow = follow();
    }
    const f = await look();
    await post({ action: 'hello' });
    const view = botView(requests.held ?? f, clock.now());
    if (view) {
      const cmds: Command[] = bot.policy(view, botRng((o.seed ?? 1) * 1000 + session));
      for (const cmd of cmds) {
        const body: Record<string, unknown> = { ...cmd, action: cmd.type };
        delete body.type;
        if (cmd.type !== 'build' && !('moveId' in body)) body.moveId = `drive-${session}-${r.moves.posted}`;
        await post(body);
      }
    }
    const tick = requests.held?.me?.town?.tick ?? 0;
    await post({ action: 'seen', tick, moveId: `drive-seen-${session}` });
    session++;
  }
  unfollow();
  const last = await look();
  r.regionalDays = (last.me?.predict?.dayIndex ?? 0) - startDay;
  const t = last.me?.town;
  r.final = t ? { tick: t.tick, pop: population(t), dayIndex: last.me!.predict!.dayIndex, rev: last.rev } : null;
  return r;
}

// ---- Over HTTP (the local stack) ------------------------------------------------------------------

export function httpTransport(baseUrl: string, token: string): Transport {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  async function call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<HometownsWire> {
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as { room?: HometownsWire; error?: string };
    if (!res.ok || !json.room) throw new DriveError(res.status, json.error ?? res.statusText);
    return json.room;
  }
  return {
    start: (body) => call('POST', '/api/native/games', body),
    act: (id, body) => call('POST', `/api/native/games/${id}`, body),
    view: (id) => call('GET', `/api/native/games/${id}`),
    stream(id, onFrame) {
      const ctrl = new AbortController();
      void (async () => {
        const res = await fetch(`${baseUrl}/api/native/games/${id}/stream`, { headers, signal: ctrl.signal });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          let cut: number;
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const event = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            for (const line of event.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              const msg = JSON.parse(line.slice(6)) as { type: string; room?: HometownsWire };
              if (msg.type === 'room' && msg.room) onFrame(msg.room);
            }
          }
        }
      })().catch(() => {});
      return () => ctrl.abort();
    },
  };
}

async function main(): Promise<void> {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const base = process.env.HOMETOWNS_BASE;
  const token = process.env.HOMETOWNS_TOKEN;
  if (!base || !token) {
    console.error('Set HOMETOWNS_BASE (the preview origin) and HOMETOWNS_TOKEN (a throwaway device token).');
    process.exit(2);
  }
  const restartCmd = arg('restart-cmd');
  const restart = restartCmd
    ? async () => {
        const { spawnSync } = await import('node:child_process');
        const out = spawnSync(restartCmd, { shell: true, stdio: 'inherit' });
        if (out.status !== 0) throw new Error(`restart command failed (${out.status})`);
        // Wait for the server to answer again.
        for (let k = 0; k < 120; k++) {
          const ok = await fetch(`${base}/api/native/games`, { headers: { authorization: `Bearer ${token}` } }).then((res) => res.ok, () => false);
          if (ok) return;
          await new Promise((res) => setTimeout(res, 1_000));
        }
        throw new Error('the server did not come back');
      }
    : undefined;
  const report = await driveSolo({
    transport: httpTransport(base.replace(/\/$/, ''), token),
    clock: { now: () => Date.now(), wait: (ms) => new Promise((res) => setTimeout(res, ms)) },
    days: Number(arg('days') ?? 2),
    devTickMs: Number(arg('dev-tick') ?? 30_000),
    seed: Number(arg('seed') ?? 1),
    restart,
    restartAt: arg('restart-at') ? Number(arg('restart-at')) : undefined,
    log: (line) => console.log(`[drive-local] ${line}`),
  });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[drive-local] room ${report.roomId}: ${report.regionalDays} Regional Days, ${report.restarts} restart(s)`);
    console.log(`[drive-local] moves ${JSON.stringify(report.moves)}; frames ${JSON.stringify(report.frames)}; resyncs ${report.resyncs}`);
    console.log(`[drive-local] delta checks ${report.delta.checked} (${report.delta.mismatches} mismatches); canary ${report.canary.checked} over ${report.canary.ticks} ticks (${report.canary.mismatches} mismatches)`);
    console.log(`[drive-local] final ${JSON.stringify(report.final)}`);
  }
  process.exit(report.canary.mismatches || report.delta.mismatches ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) void main();
