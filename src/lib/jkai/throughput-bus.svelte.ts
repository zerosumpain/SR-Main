// Live output-throughput accounting for /jkai chat ("tok/s, actually").
//
// ChatArea owns the orchestrator SSE stream, but the readout lives in the
// conversation sidebar's bottom-left footer — two sibling components with no
// shared parent state. So the accounting sits here as module-level runes, the
// same pattern as `launcher-bus.svelte.ts`.
//
// NUMERATOR — what counts as output:
//   - `token` deltas    → the visible reply
//   - `thinking` deltas → reasoning tokens
//   - `tool_start` args → tool-call tokens (the model generated that JSON)
// `replace_bubble` is excluded: it swaps the whole bubble rather than adding
// to it, so counting it would double-bill text already counted. Sub-agent
// frames are excluded too — a delegate runs *inside* the parent's tool window,
// which is paused time here, so folding its tokens in would inflate the rate.
//
// DENOMINATOR — only stretches where output was actually arriving. The clock
// starts on the first output delta and stops the moment a tool starts running;
// it restarts on the next delta. So both tool execution AND the provider's
// post-tool prefill wait fall out — that's the "minus dead time" part. Basing
// the restart on deltas rather than on `tool_result` also makes it
// self-healing: a tool_start whose result never arrives can't strand the
// clock.
//
// While a turn streams, the token count is a chars/4 estimate (there's no
// tokeniser client-side). On the terminal `done` event the server hands us the
// provider's own output-token count and we recompute the settled figure from
// that — `lastActual` records which of the two the displayed number came from.

/** Chars per token. Matches `approxTokens()` in `$lib/jkai/prompts/workbench`. */
const CHARS_PER_TOKEN = 4;
/** Below these, a sample is noise (a two-word reply over 40ms is not 400 tok/s). */
const MIN_ACTIVE_MS = 250;
const MIN_TOKENS = 8;

export const throughput = $state({
  /** A measured turn is streaming right now. */
  live: false,
  /** Generation time banked so far this turn, in ms (paused stretches excluded). */
  activeMs: 0,
  /** `performance.now()` at which the current active stretch began; null = paused. */
  startedAt: null as number | null,
  /** Output chars seen this turn — divide by CHARS_PER_TOKEN for the live estimate. */
  chars: 0,
  /** tok/s for the most recent completed turn; null until one lands. */
  lastTps: null as number | null,
  /** True when `lastTps` was computed from the provider's token count, not the estimate. */
  lastActual: false,
  /** Session totals behind the rolling average. */
  sessionTokens: 0,
  sessionActiveMs: 0,
});

// Not a rune: nothing renders it, and it must not be reactive — it gates the
// note* calls so a replayed event burst can't be mistaken for live generation.
let measuring = false;

/**
 * Start accounting for a new turn.
 *
 * Pass `replay: true` when re-attaching to an already-running job: the SSE bus
 * flushes its buffered events in one burst, which would read as thousands of
 * tokens in ~0ms. Those turns are simply not measurable, so we ignore them.
 */
export function beginTurn(opts: { replay?: boolean } = {}): void {
  measuring = !opts.replay;
  throughput.live = measuring;
  throughput.activeMs = 0;
  throughput.startedAt = null;
  throughput.chars = 0;
}

/** Bill a token / thinking delta, starting the clock if it was paused. */
export function noteOutput(text: string | undefined): void {
  if (!measuring || !text) return;
  if (throughput.startedAt === null) throughput.startedAt = performance.now();
  throughput.chars += text.length;
}

/**
 * Bill a tool call's argument JSON, then pause the clock for the tool's
 * execution. Order matters: the model generated those arg tokens during the
 * stretch that is ending, so they belong to it.
 */
export function noteToolCall(args: unknown): void {
  if (!measuring) return;
  try {
    const json = JSON.stringify(args ?? {});
    if (json && json !== '{}' && json !== 'null') throughput.chars += json.length;
  } catch {
    // Unserialisable args (cycles) — skip the char count, still pause.
  }
  pauseClock();
}

function pauseClock(): void {
  if (throughput.startedAt === null) return;
  throughput.activeMs += performance.now() - throughput.startedAt;
  throughput.startedAt = null;
}

/** Estimated tokens from a streamed char count. */
export function tokensFromChars(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

/** tok/s, or null when the sample is too small to mean anything. */
export function rate(tokens: number, activeMs: number): number | null {
  if (activeMs < MIN_ACTIVE_MS || tokens < MIN_TOKENS) return null;
  return tokens / (activeMs / 1000);
}

/**
 * Close out the turn. `actualOutputTokens` is the provider's own completion-
 * token count (which includes reasoning and tool-call tokens) when the server
 * reported one; without it we fall back to the streamed estimate.
 *
 * Safe to call more than once — the second call is a no-op beyond clearing
 * `live`, so `done`/`error` handlers and their `finally` backstops can all
 * call it.
 */
export function settleTurn(actualOutputTokens?: number | null): void {
  if (!measuring) {
    throughput.live = false;
    return;
  }
  measuring = false;
  pauseClock();

  const hasActual = typeof actualOutputTokens === 'number' && actualOutputTokens > 0;
  const tokens = hasActual ? Math.round(actualOutputTokens) : tokensFromChars(throughput.chars);
  const tps = rate(tokens, throughput.activeMs);
  if (tps !== null) {
    throughput.lastTps = tps;
    throughput.lastActual = hasActual;
    throughput.sessionTokens += tokens;
    throughput.sessionActiveMs += throughput.activeMs;
  }
  throughput.live = false;
}
