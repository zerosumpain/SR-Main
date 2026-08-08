// Assemble Hermes' outbound text frames into one assistant reply without
// letting a side-channel message eat it.
//
// Two things about the frame stream are easy to get wrong, and both were:
//
// 1. **One reply is MANY message ids.** Hermes' stream consumer opens a fresh
//    message id at every tool boundary, so a single answer arrives as a chain
//    of segments. The pump used to append every `send` into one flat string and
//    treat every `replace` as "throw all of that away and use this instead".
//
// 2. **Not every text frame is the reply.** The gateway interleaves its own
//    status bubbles on the SAME channel — the long-running notifier
//    (`⏳ Working — 12 min — iteration 19/90, …`, re-edited every
//    `gateway_notify_interval` seconds against its own message id) and the
//    busy-ack (`⚡ Interrupting current task (…)`) among them.
//
// Put together those produced the de-sync: the notifier's second tick is not a
// prefix of its first, so the platform adapter downgrades the edit from an
// append to a `replace` (`jkai_platform/adapter.py` `edit_message`), and the
// flat accumulator obediently replaced the whole answer — on screen AND in the
// persisted `orchestrator_chats` row — with one line reading "⏳ Working — 12
// min — iteration 1/90, mcp_jkai_jkai_extended".
//
// The fix is segment-scoped: keep the text per message id in arrival order and
// recompute the full body, so a `replace` can only ever rewrite the segment it
// names. That holds regardless of WHICH side channel misbehaves — the notifier,
// the tool-progress log's `(×N)` counter, a flood-control retry, or a future
// Hermes format change — which is why it is the fix and the config knobs at the
// Hermes end are only noise reduction.
//
// Status frames are recognised and routed off the text channel entirely, so
// they can never reach `partialResponse` even if the segment map somehow
// mis-keys them. The iteration counter is stripped on the way past: it is the
// model's internal budget, which is machinery, not progress.

/** Hermes' framework injects a one-time onboarding notice at the start of any
 *  chat whose platform isn't wired into the cron / cross-platform delivery map.
 *  It is a meta-notification, not an agent reply, but it arrives as a plain
 *  `send` frame — so it would otherwise stream into the bubble, be persisted as
 *  the *start* of the assistant row, and drag the turn's attachments onto it. */
export const HERMES_HOME_CHANNEL_NOTICE_PREFIX = '📬 No home channel is set for Jkai';

/**
 * A gateway status bubble, recognised on the text channel.
 *
 * `progress` is the recurring "still going" filler — one per notify interval,
 * each superseding the last, so it belongs on the transient heartbeat channel.
 * `notice` is one-shot (queued / interrupted / timed out) and is worth a
 * permanent line in the thread.
 */
export interface HermesStatusFrame {
  kind: 'progress' | 'notice';
  /** The line with the `iteration X/Y` fragment removed. */
  text: string;
  /** Minutes Hermes reported as elapsed, when the line carries them. */
  elapsedMin: number | null;
  /** What Hermes said it was doing — a tool name or a phrase like
   *  "receiving stream response". Null when the line carried no detail. */
  detail: string | null;
}

/**
 * The status lines the gateway writes onto the assistant text channel, as an
 * explicit allowlist of leading phrases.
 *
 * An allowlist rather than "leading ⏳/⚡/⏱" for the same reason
 * `hermes-tool-log.ts` allowlists its tool glyphs: real replies open with
 * glyph-then-phrase shapes (`✅ Corrected:`, `🥇 WINNER:`) and must survive
 * untouched. Two spellings of the elapsed-time filler are listed because the
 * format changed once — production history holds both the old
 * `⏳ Still working... (12 min elapsed — iteration 5/90…)` and the current
 * `⏳ Working — 12 min — iteration 5/90, …`.
 *
 * Sources, all in `~/hermes-agent/gateway/run.py`: the long-running notifier
 * (`⏳ Working`), the busy-ack (`⏳ Queued` / `⏳ Subagent working` /
 * `⏩ Steered` / `⚡ Interrupting`), the inactivity reaper
 * (`⏱️ Agent inactive`), the gateway-restart/reload guards (`⏳ Gateway …`,
 * `⏳ Agent is running …`) and the provider rate-limit notice
 * (`⏱️ The model provider is rate-limiting requests…`).
 */
const STATUS_PREFIXES: ReadonlyArray<{ prefix: string; kind: HermesStatusFrame['kind'] }> = [
  { prefix: '⏳ Working — ', kind: 'progress' },
  { prefix: '⏳ Still working', kind: 'progress' },
  { prefix: '⏳ Queued for the next turn', kind: 'notice' },
  { prefix: '⏳ Subagent working', kind: 'notice' },
  { prefix: '⏩ Steered into current run', kind: 'notice' },
  { prefix: '⚡ Interrupting current task', kind: 'notice' },
  { prefix: '⏱ Agent inactive for ', kind: 'notice' },
  // run.py:3117/:3119, :7363/:7365, :7678 — "⏳ Gateway restarting — queued for
  // the next turn after it comes back." and "⏳ Gateway is reloading and is not
  // accepting another turn right now." The gerund varies, so match the stem.
  { prefix: '⏳ Gateway ', kind: 'notice' },
  // run.py:7303 — "⏳ Agent is running — `/model` can't run mid-turn."
  { prefix: '⏳ Agent is running', kind: 'notice' },
  // run.py:243 — emitted with the ⏱️ presentation form; normaliseGlyphs makes
  // that compare equal to the bare glyph written here.
  { prefix: '⏱ The model provider is rate-limiting', kind: 'notice' },
];

/** Drop emoji variation selectors so `⏱️` and `⏱` compare equal — Hermes emits
 *  the presentation form, and a copy of the same string elsewhere may not. */
const VARIATION_SELECTOR = /️/g;

function normaliseGlyphs(value: string): string {
  return value.replace(VARIATION_SELECTOR, '');
}

/**
 * Remove `iteration 5/90` and tidy the separator it leaves behind.
 *
 * The counter appears in two shapes — `— iteration 5/90, receiving stream
 * response` (notifier) and `(12 min elapsed, iteration 5/90, running: x)`
 * (busy-ack) — so the cleanup collapses doubled commas, empty brackets and a
 * dangling em-dash rather than trying to match each shape whole.
 */
function stripIterationCounter(text: string): string {
  return text
    .replace(/iteration\s+\d+\s*\/\s*\d+/gi, '')
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/,\s*\)/g, ')')
    .replace(/\(\s*\)/g, '')
    .replace(/—\s*,\s*/g, '— ')
    .replace(/\s*—\s*(?=[)…])/g, '')
    .replace(/\s*—\s*$/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

/**
 * Classify one text frame's content as a gateway status line, or null when it
 * is ordinary reply text.
 */
export function classifyHermesStatusText(content: string): HermesStatusFrame | null {
  const probe = normaliseGlyphs(content).trimStart();
  const hit = STATUS_PREFIXES.find((p) => probe.startsWith(normaliseGlyphs(p.prefix)));
  if (!hit) return null;

  const text = stripIterationCounter(probe);
  const mins = text.match(/(\d+)\s*min/);
  // The notifier's detail rides after the elapsed time; the busy-ack's rides
  // inside its bracket as `running: <tool>`. Everything else has none.
  const notifierDetail = text.match(/^⏳ Working — \d+\s*min\s*—\s*(.+)$/);
  const ackDetail = text.match(/running:\s*([^),]+)/);
  return {
    kind: hit.kind,
    text,
    elapsedMin: mins ? Number(mins[1]) : null,
    detail: (notifierDetail?.[1] ?? ackDetail?.[1])?.trim() || null,
  };
}

/** What a text frame did to the reply, in the shape the consumers publish. */
export type HermesTextUpdate =
  /** Appended to the end of the reply — the common streaming case. */
  | { kind: 'append'; delta: string; text: string }
  /** An earlier segment changed, so consumers must take the whole body. */
  | { kind: 'rewrite'; text: string }
  /** A gateway status bubble; belongs off the text channel. */
  | { kind: 'status'; status: HermesStatusFrame }
  /** Nothing to show (the home-channel notice, or an empty append). */
  | { kind: 'ignore' };

/** Just enough of `SseFrame` to accumulate; typed structurally so tests and the
 *  wired chat node can feed it without constructing a whole frame. */
export interface HermesTextFrame {
  kind: string;
  content: string;
  message_id: string;
}

/**
 * Does this frame belong to the turn we are streaming?
 *
 * Hermes' outbound queue is keyed by chat, not by turn, and whichever
 * connection is attached drains it. So a turn whose consumer detached — a new
 * message superseded it, the watchdog killed it, the tab reloaded — leaves its
 * frames in the queue for the NEXT turn's consumer to pick up. That consumer
 * used to accept them as its own: it rendered and persisted the previous
 * turn's answer, then took that turn's `finalize` as its own completion and
 * closed in milliseconds. Every reply after it landed one message behind, and
 * nothing ever resynchronised (production, 2026-08-08).
 *
 * The plugin now stamps `metadata.turn_id` on everything a turn emits.
 *
 * Untagged frames are ACCEPTED, deliberately. Two kinds arrive untagged: the
 * gateway's own status bubbles and cron pushes, which are produced outside any
 * inbound turn and have always been welcome; and every frame at all if the
 * plugin has not been restarted since this shipped. Rejecting by default would
 * turn a stale gateway into a silent total outage — a chat that streams
 * nothing — which is a far worse failure than the one being fixed.
 */
export function frameBelongsToTurn(
  frame: { metadata?: Record<string, unknown> | null },
  turnId: string,
): boolean {
  const stamped = frame.metadata?.['turn_id'];
  if (typeof stamped !== 'string' || !stamped) return true;
  return stamped === turnId;
}

export interface HermesTextAccumulator {
  /** Fold one `send` / `replace` frame in and report what changed. */
  accept(frame: HermesTextFrame): HermesTextUpdate;
  /** The reply so far — every segment, in arrival order. */
  readonly text: string;
}

/**
 * Segment-scoped accumulator for one turn's reply.
 *
 * Segments are keyed by Hermes' `message_id` and concatenated in insertion
 * order with no separator, which is byte-identical to the old flat `+=` for a
 * well-behaved stream — the change is only that a `replace` is now confined to
 * the segment it names instead of clearing everything.
 */
export function createHermesTextAccumulator(): HermesTextAccumulator {
  const segments = new Map<string, string>();
  // Message ids already known to be a gateway status bubble. Classification has
  // to be sticky, not per-frame: the platform adapter emits an edit as a `send`
  // carrying only the DELTA whenever the new text extends the old, and a delta
  // like " — iteration 2/90, gmail_search" starts with no status prefix at all.
  // Judged frame-by-frame that fragment opens a brand-new segment at the end of
  // the reply and leaks machinery text straight into the bubble.
  const statusIds = new Set<string>();
  // The segment currently at the END of the reply — set only when a new one is
  // opened, so a `replace` aimed at a mid-chain segment doesn't make later
  // appends to it look like they extend the body.
  let lastId: string | null = null;
  // Memoised join, invalidated on every mutation.
  let joined: string | null = '';

  const full = () => {
    if (joined === null) {
      let out = '';
      for (const seg of segments.values()) out += seg;
      joined = out;
    }
    return joined;
  };

  return {
    get text() {
      return full();
    },
    accept(frame: HermesTextFrame): HermesTextUpdate {
      if (frame.kind !== 'send' && frame.kind !== 'replace') return { kind: 'ignore' };
      if (frame.content.startsWith(HERMES_HOME_CHANNEL_NOTICE_PREFIX)) return { kind: 'ignore' };

      const status = classifyHermesStatusText(frame.content);
      if (status) {
        // Only remember a REAL id. An unkeyed status frame must not condemn the
        // shared unkeyed segment, which is where malformed prose also lands.
        if (frame.message_id) statusIds.add(frame.message_id);
        return { kind: 'status', status };
      }

      // A frame with no id of its own still has to land somewhere; give it a
      // single shared segment rather than a new one per frame, so a malformed
      // stream degrades to the old append-only behaviour.
      const id = frame.message_id || '__unkeyed__';
      // A later frame on a known status id is a continuation of that bubble
      // however it reads on its own. Drop it rather than guess: losing a line
      // of gateway filler is free, leaking it into the answer is not.
      if (statusIds.has(id)) return { kind: 'ignore' };
      const isNew = !segments.has(id);
      const isNewest = isNew || lastId === id;

      if (frame.kind === 'send') {
        if (!frame.content) return { kind: 'ignore' };
        segments.set(id, (segments.get(id) ?? '') + frame.content);
        if (isNew) lastId = id;
        joined = null;
        // Appending to the newest segment (or opening one) extends the reply,
        // so the delta alone is enough for the client. Growing an EARLIER
        // segment moves text the client has already rendered, so it needs the
        // whole body instead.
        return isNewest
          ? { kind: 'append', delta: frame.content, text: full() }
          : { kind: 'rewrite', text: full() };
      }

      segments.set(id, frame.content);
      if (isNew) lastId = id;
      joined = null;
      return { kind: 'rewrite', text: full() };
    },
  };
}
