/**
 * "Something just failed to authenticate — look at the connectors soon."
 *
 * The seam between the code that FINDS a lapsed grant (the Gmail service, the
 * Whoop token refresh) and the watcher that tells the owner about it. It
 * imports nothing on purpose: the Gmail service is in the workflow engine's
 * import graph, and pulling the watcher's probes, the notification ledger and
 * WhatsApp's channel into it would make every mail fetch depend on all three.
 * The watcher registers itself here when it starts, the same way a WhatsApp
 * sender registers itself as a notification channel.
 *
 * Requests are COALESCED. A lapsed Gmail token is discovered by the watcher's
 * poll, by a chat tool, and by a workflow node, often within seconds of each
 * other, and each would otherwise buy a full probe of every connector. One
 * check runs no sooner than `CHECK_DEBOUNCE_MS` after the first request, and
 * no sooner than `CHECK_MIN_GAP_MS` after the previous check, however many
 * requests arrive in between.
 *
 * With no watcher registered — the builder sidecar, a development box, a test
 * — a request is a no-op, which is the right outcome: there is nobody here to
 * tell.
 */

export const CHECK_DEBOUNCE_MS = 60_000;
export const CHECK_MIN_GAP_MS = 5 * 60_000;

type Runner = () => Promise<unknown>;

let runner: Runner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRanAt = 0;

/** The watcher hands over its check here; `null` withdraws it. */
export function registerConnectorCheck(fn: Runner | null): void {
  runner = fn;
  if (!fn && timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Called by the watcher whenever a check completes, scheduled or requested. */
export function noteConnectorCheckRan(at: number = Date.now()): void {
  lastRanAt = at;
}

/**
 * Ask for a connector check soon. Never throws, never waits.
 *
 * Returns true when a check is (now or already) scheduled, false when there is
 * no watcher in this process to run one.
 */
export function requestConnectorCheck(reason = 'requested'): boolean {
  if (!runner) return false;
  if (timer) return true; // coalesced into the one already pending

  const now = Date.now();
  const delay = Math.max(CHECK_DEBOUNCE_MS, lastRanAt + CHECK_MIN_GAP_MS - now);
  timer = setTimeout(() => {
    timer = null;
    const run = runner;
    if (!run) return;
    lastRanAt = Date.now();
    void run().catch((err) => {
      console.error(`[connectors] requested check (${reason}) failed:`, err instanceof Error ? err.message : err);
    });
  }, delay);
  timer.unref?.();
  return true;
}

/** Tests only. */
export function _resetConnectorCheckForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  runner = null;
  lastRanAt = 0;
}
