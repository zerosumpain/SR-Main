/**
 * Is the Hermes gateway on homeserv reachable right now?
 *
 * Production runs on the VPS and dials homeserv over Tailscale. When that box is
 * dark the socket does not refuse — it hangs, and undici's default connect
 * timeout means ~10.5s per call. A live host with a dead service refuses in
 * ~0.07s, so the slow case is specifically "homeserv is gone".
 *
 * This gives callers a cheap, bounded answer so they can route to the VPS-local
 * chat engine instead of discovering the outage one hung request at a time.
 *
 * Three properties matter:
 *
 * - **Bounded.** 2.5s, matching `pingUrl` in `$lib/architecture/health.ts` — the
 *   one timeout in the tree that already beats undici's connect default.
 * - **Single-flight.** Concurrent callers share one in-flight probe. Without it a
 *   burst of chat sends during an outage each pay their own 2.5s.
 * - **Fails closed.** Anything other than a clean response reads as unreachable.
 *   An unknown Hermes must route to the engine that is definitely alive; the
 *   worst case is a working chat with fewer tools.
 */

const PROBE_TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 30_000;

type Cached = { reachable: boolean; at: number };

// Keyed by base URL, not global. One process only ever talks to one Hermes
// today, so a single slot would work — but a shared slot silently answers for
// a URL it never probed, and that is a bug that only appears the day a second
// gateway exists, in the code least likely to be re-read.
const cached = new Map<string, Cached>();
const inFlight = new Map<string, Promise<boolean>>();

/** Test seam — `Date.now()` is not injectable and these are time-dependent. */
let now = () => Date.now();

async function probe(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/platforms/jkai/health`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // <500 is "something answered". A 5xx means the gateway is up but unwell,
    // which for routing purposes is the same as down: send chat elsewhere.
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Cached, single-flight reachability check. `baseUrl` is the Hermes platform URL
 * the caller would otherwise dial, so the probe and the real request always
 * agree on the target.
 */
export async function isHermesReachable(baseUrl: string): Promise<boolean> {
  if (!baseUrl) return false;

  const c = cached.get(baseUrl);
  if (c && now() - c.at < CACHE_TTL_MS) return c.reachable;

  // Single-flight: the second caller in a burst awaits the first probe rather
  // than opening its own.
  const pending = inFlight.get(baseUrl);
  if (pending) return pending;

  const p = probe(baseUrl)
    .then((reachable) => {
      cached.set(baseUrl, { reachable, at: now() });
      return reachable;
    })
    .finally(() => {
      inFlight.delete(baseUrl);
    });

  inFlight.set(baseUrl, p);
  return p;
}

/**
 * Will a chat sent right now actually be answered by Hermes?
 *
 * Two facts, and both must hold: the engine is *selected* (`jkai.chat.hermes_enabled`,
 * resolved per request) and it is *reachable*. Callers used to check only the
 * first, which is how `/jkai` came to advertise an engine that could not answer.
 *
 * Params are explicit rather than read from `$env` so this module stays pure and
 * unit-testable; callers already hold these constants.
 */
export async function hermesWillAnswerChat(
  isEnabled: (envDefault: boolean) => Promise<boolean>,
  envDefault: boolean,
  baseUrl: string,
): Promise<boolean> {
  // A settings-read failure must not take chat down — fall back to the env
  // default, which is what the call site did before the toggle existed.
  const enabled = await isEnabled(envDefault).catch(() => envDefault);
  if (!enabled) return false;
  return isHermesReachable(baseUrl);
}

/**
 * Drop the cached verdict. Call after deliberately changing the engine so the
 * next request re-probes instead of honouring a verdict from before the change.
 */
export function invalidateHermesReach(): void {
  cached.clear();
}

/** Test-only: control the clock and reset module state between cases. */
export function __setClockForTests(fn: () => number): void {
  now = fn;
  cached.clear();
  inFlight.clear();
}
