// src/lib/daydream/think/notes.ts
//
// A think note as its READERS see it — the feed page, the phone's Noticed card
// and Health strip, the briefing. PURE: no database, no model, so the page, the
// native endpoints and the tests all share one mapper.
//
// A note is a `daydream_thoughts` row with kind `think_<outcome>`. What it is
// ABOUT (the channel its question started from) rides in the evidence list as a
// `think-question` reference (`audit.ts`). Notes written before that existed are
// read back through the tools they cited, which name the channel just as well
// for every note that looked at anything specific.
//
// The wire shape (`NativeNote`) is FIXED: the iPhone app was built against it.

import { QUESTION_EVIDENCE_KIND } from './audit';
import { CHANNELS, type Channel, type Outcome } from './questions';

export const THINK_KIND_PREFIX = 'think_';

/** Notes a day that may interrupt him. Two a cycle over twenty-one waking
 *  cycles is forty-two WhatsApps; ponder's cap was four and that was the
 *  complaint's upper end, not its lower. The rest land on the feed. Here
 *  rather than in `run.ts` so the feed's engine strip can report it without
 *  importing the model gateway. */
export const DAILY_RAISE_CAP = 4;

/** The page every note links to, opened on that note. */
export const FEED_PATH = '/jkai/daydreams';

export function noteHref(id: string): string {
  return `${FEED_PATH}?note=${encodeURIComponent(id)}`;
}

export function isThinkKind(kind: string | null | undefined): boolean {
  return !!kind && kind.startsWith(THINK_KIND_PREFIX) && kind.length > THINK_KIND_PREFIX.length;
}

export function outcomeOf(kind: string): string {
  return isThinkKind(kind) ? kind.slice(THINK_KIND_PREFIX.length) : kind;
}

/** The reader's words for the loop's vocabulary — the same the phone uses, so
 *  a note reads the same on both. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
  correlate: 'A connection',
  efficiency: 'Time saver',
  quality_of_life: 'Quality of life',
  research: 'Research',
  build: 'Build idea',
  health_plan: 'Health plan',
  suggest: 'Worth trying',
  money_analysis: 'Money',
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  health: 'Health',
  home: 'Home',
  mail: 'Mail',
  chat: 'Chat',
  diary: 'Diary',
  money: 'Money',
  research: 'Research',
};

export function outcomeLabel(outcome: string): string {
  return (OUTCOME_LABEL as Record<string, string>)[outcome] ?? 'Noticed';
}

export function channelLabel(channel: string | null): string {
  return channel ? ((CHANNEL_LABEL as Record<string, string>)[channel] ?? channel) : 'Mixed';
}

function isChannel(s: unknown): s is Channel {
  return typeof s === 'string' && (CHANNELS as readonly string[]).includes(s);
}

/** Which channel a cited TOOL belongs to. `memory_search` and `correlate` read
 *  across channels and say nothing on their own. */
const TOOL_CHANNEL: Record<string, Channel> = {
  health_hub: 'health',
  health_series: 'health',
  health_timeline: 'health',
  ha_find: 'home',
  ha_query_state: 'home',
  ha_get_history: 'home',
  mail_facts: 'mail',
  chat_threads: 'chat',
  diary: 'diary',
  spend: 'money',
  research_web_search: 'research',
  fetch_url: 'research',
};

/** Outcomes that name their channel whatever was cited. */
const OUTCOME_CHANNEL: Partial<Record<string, Channel>> = {
  health_plan: 'health',
  money_analysis: 'money',
  research: 'research',
};

type EvidenceLike = { kind?: unknown; id?: unknown };

/**
 * The channel a note's question started from.
 *
 * The recorded question first. Failing that — a note written before the
 * question was recorded — the channel most of its cited cards came from, then
 * the channel its outcome implies. `null` only for a note that cited nothing
 * but cross-channel reads, which the phone shows under a generic mark.
 */
export function thinkChannelOf(evidence: unknown, outcome: string): Channel | null {
  const refs = Array.isArray(evidence) ? (evidence as EvidenceLike[]) : [];
  for (const e of refs) {
    if (e?.kind === QUESTION_EVIDENCE_KIND && isChannel(e.id)) return e.id;
  }
  const votes = new Map<Channel, number>();
  for (const e of refs) {
    if (e?.kind !== 'think-card' || typeof e.id !== 'string') continue;
    // A card ref is `<tool>:<args>@<day>` (`tools.ts` makeCard).
    const tool = e.id.slice(0, e.id.indexOf(':') < 0 ? undefined : e.id.indexOf(':'));
    const ch = TOOL_CHANNEL[tool];
    if (ch) votes.set(ch, (votes.get(ch) ?? 0) + 1);
  }
  let best: Channel | null = null;
  let most = 0;
  // CHANNELS order breaks a tie, so the answer never depends on citation order.
  for (const ch of CHANNELS) {
    const n = votes.get(ch) ?? 0;
    if (n > most) {
      best = ch;
      most = n;
    }
  }
  return best ?? OUTCOME_CHANNEL[outcome] ?? null;
}

// ── Rows ───────────────────────────────────────────────────────────────────

/** The columns every reader needs. `notes.server.ts` selects exactly these. */
export interface ThinkRow {
  id: string;
  kind: string;
  title: string;
  narrative: string | null;
  explanation: string;
  evidence: unknown;
  status: string;
  suppressedReason: string | null;
  feedback: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  note: string | null;
}

/**
 * Held-back notes that still belong on the feed: ones that passed their audit
 * and were kept quiet only by the daily cap (`feed_only: …`), by his routing
 * (`notify: …`), or by a low learned weight for their kind. A POSITIVE list —
 * anything else held back (refuted, uncertain, an echo of a settled claim, or a
 * reason nobody has written yet) stays off. `hub-counts.server.ts` counts the
 * Noticed badge by the same three prefixes.
 */
export const FEED_HELD_REASONS = ['feed_only', 'notify:', 'below_threshold'] as const;

/** Statuses a feed never shows: filed away, expired, or put off by the owner. */
const OFF_FEED_STATUSES = new Set(['archived', 'expired', 'snoozed']);

/** Is this row a note the feed shows? Rated notes stay, with their verdict. */
export function isOnFeed(row: Pick<ThinkRow, 'kind' | 'status' | 'suppressedReason'>): boolean {
  if (!isThinkKind(row.kind)) return false;
  if (OFF_FEED_STATUSES.has(row.status)) return false;
  if (row.status === 'suppressed') {
    const reason = row.suppressedReason ?? '';
    if (!FEED_HELD_REASONS.some((r) => reason.startsWith(r))) return false;
  }
  return true;
}

/** Is this row one the PHONE shows? The feed, less anything the owner has
 *  muted — a `never` on the note or on its whole kind. */
export function isForPhone(row: Pick<ThinkRow, 'kind' | 'status' | 'suppressedReason' | 'feedback'>, muted: ReadonlySet<string>): boolean {
  return isOnFeed(row) && row.feedback !== 'never_kind' && !muted.has(row.kind);
}

/** How long a note stays on the Today card. */
export const TODAY_WINDOW_HOURS = 48;
/** How many notes the Today card carries. */
export const TODAY_LIMIT = 2;

/**
 * The Today card's notes: the newest from the last 48 hours the phone may show,
 * less any the owner has already turned down. Input need not be sorted.
 */
export function todayNotes<R extends ThinkRow>(rows: R[], muted: ReadonlySet<string>, now: Date): R[] {
  const floor = now.getTime() - TODAY_WINDOW_HOURS * 3_600_000;
  return rows
    .filter((r) => isForPhone(r, muted) && r.status !== 'dismissed' && r.createdAt.getTime() >= floor)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, TODAY_LIMIT);
}

// ── The wire ───────────────────────────────────────────────────────────────

export interface NativeNote {
  id: string;
  outcome: string;
  channel: Channel | null;
  title: string;
  body: string;
  createdAt: string;
  url: string;
  feedback: 'useful' | 'not_useful' | null;
}

/** `never_kind` reads as `not_useful` on the wire — the contract has two
 *  verdicts, and a muted note never reaches the phone to be shown one anyway. */
export function wireFeedback(feedback: string | null): NativeNote['feedback'] {
  if (feedback === 'useful') return 'useful';
  if (feedback === 'not_useful' || feedback === 'never_kind') return 'not_useful';
  return null;
}

export function toNativeNote(row: ThinkRow): NativeNote {
  const outcome = outcomeOf(row.kind);
  return {
    id: row.id,
    outcome,
    channel: thinkChannelOf(row.evidence, outcome),
    title: row.title,
    // The narrative is the note's own audited sentence; the explanation (what
    // it read) stands in only if a row somehow never got one.
    body: row.narrative ?? row.explanation,
    createdAt: row.createdAt.toISOString(),
    url: noteHref(row.id),
    feedback: wireFeedback(row.feedback),
  };
}

// ── Input ──────────────────────────────────────────────────────────────────

export type NoteScope = 'all' | 'health';

/** `?scope=` — absent is every note; anything else unknown is refused. */
export function parseScope(raw: string | null): NoteScope | null {
  if (raw == null || raw.trim() === '' || raw === 'all') return 'all';
  return raw === 'health' ? 'health' : null;
}

/** The Health tab's notes: started from health, or a proposed week. */
export function inScope(note: Pick<NativeNote, 'channel' | 'outcome'>, scope: NoteScope): boolean {
  return scope === 'all' || note.channel === 'health' || note.outcome === 'health_plan';
}

export const NATIVE_LIST_DEFAULT = 5;
export const NATIVE_LIST_MAX = 20;

/** The phone's verdicts, and what each writes. `never` is the kind mute. */
const WIRE_VERDICTS = { useful: 'useful', not_useful: 'not_useful', never: 'never_kind' } as const;
export type StoredVerdict = (typeof WIRE_VERDICTS)[keyof typeof WIRE_VERDICTS];

export function parseFeedbackBody(
  body: unknown,
): { ok: true; id: string; verdict: StoredVerdict } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === 'string' ? b.id.trim() : '';
  if (!id || id.length > 200) return { ok: false, error: 'id is required' };
  const verdict = typeof b.verdict === 'string' ? b.verdict : '';
  if (!Object.hasOwn(WIRE_VERDICTS, verdict)) {
    return { ok: false, error: 'verdict must be useful, not_useful or never' };
  }
  return { ok: true, id, verdict: WIRE_VERDICTS[verdict as keyof typeof WIRE_VERDICTS] };
}

// ── The feed page ──────────────────────────────────────────────────────────

/** A note as the web feed draws it: the wire note plus what only the page
 *  shows — what it read, whether it went out, the owner's own note. */
export interface FeedNote extends NativeNote {
  outcomeLabel: string;
  channelLabel: string;
  /** It interrupted him (WhatsApp / phone); otherwise it waited on the feed. */
  raised: boolean;
  /** `dismissed` — he said not useful or never. */
  turnedDown: boolean;
  /** Its kind is muted: nothing of this outcome will be raised again. */
  kindMuted: boolean;
  kind: string;
  /** The verdict as stored — `never_kind` included, which the wire folds. */
  verdict: string | null;
  /** What it read — code-built, never model prose. */
  read: string;
  ownerNote: string | null;
}

export function toFeedNote(row: ThinkRow, muted: ReadonlySet<string>): FeedNote {
  const n = toNativeNote(row);
  return {
    ...n,
    outcomeLabel: outcomeLabel(n.outcome),
    channelLabel: channelLabel(n.channel),
    raised: row.deliveredAt != null,
    turnedDown: row.status === 'dismissed',
    kindMuted: muted.has(row.kind),
    kind: row.kind,
    verdict: row.feedback,
    read: row.explanation,
    ownerNote: row.note,
  };
}
