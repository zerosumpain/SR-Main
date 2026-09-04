/**
 * Plain-English narrative over the self-improvement audit trail.
 *
 * The Ledger already showed everything the engine did. What it could not show
 * was WHY: a reader saw `tool_shipped · govuk_search: Search the GOV.UK content
 * API…` and had no way to learn that it existed because five questions about UK
 * government projects went unanswered that week. This module turns the run
 * records into one card per improvement, each answering three questions in
 * order — what drove it, what was chosen, and what came of it.
 *
 * Design constraints that matter:
 *
 *  - EVIDENCE-BOUND, NO MODEL. Every sentence here is assembled from recorded
 *    fields. Nothing is sent to an LLM to be "written up". The morning briefing
 *    taught this the hard way: a fluent summary of machine data reads exactly as
 *    authoritative when it is wrong as when it is right, and the failure is
 *    silent. Where a fact is missing this module says so rather than filling it.
 *
 *  - LINKS ARE LABELLED BY CONFIDENCE. The driver behind a built tool is only
 *    `recorded` when the engine actually stored the link. Older runs predate
 *    that, so the driver is recovered by matching the tool against the week's
 *    unmet needs, and the card is marked `inferred` — the UI qualifies it with
 *    "likely". A guess presented as a record is the failure mode being avoided;
 *    a guess labelled as one is useful.
 *
 *  - ONE CARD PER IMPROVEMENT, THREADED ACROSS NIGHTS. An idea queued on the
 *    26th, attempted and rejected on the 28th, then fixed and shipped on the
 *    30th is a single arc, not four log lines in four places. Cards are keyed by
 *    `kind:subject`, so shipping a tool and later repairing it are deliberately
 *    two cards: they have different drivers (an unmet need vs an error rate),
 *    and merging them would blur the very question this view exists to answer.
 *
 *  - EXPECTED vs MEASURED OUTCOME. "Should let jkai answer battery questions"
 *    is a promise made at ship time; "called 12 times since, no errors" is a
 *    result. They are different fields and the UI renders them differently.
 *    "Too early to tell" is a valid, honest state and is used freely.
 *
 * Pure by design — no database, no Svelte, no fetch — so the whole derivation is
 * unit-testable from fixtures. The caller supplies every input. Mirrors
 * $lib/releases/public-filter.ts, which is pure for the same reason.
 *
 * Owner-only surface: `driverQuotes` carries verbatim user questions, which is
 * exactly the sort of text $lib/security/sensitive.ts exists to keep off public
 * pages. /jkai is owner-gated in hooks; if any of this is ever surfaced
 * publicly, the quotes must be dropped, not merely truncated.
 */

import type {
  BacklogItemData,
  ImprovementRunData,
  QuestionInsights,
  RunAction,
} from './types';
import type { ToolPolicyVersion } from '$lib/toolpolicy/policy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What sort of improvement a card describes. */
export type StoryKind = 'tool' | 'repair' | 'policy' | 'api' | 'idea';

/**
 * Where the improvement currently stands. Distinct from a run's status: a run
 * completes, an improvement lands.
 */
export type StoryStatus =
  | 'live'
  | 'fixed'
  | 'trial'
  | 'kept'
  | 'reverted'
  | 'rejected'
  | 'queued'
  | 'catalogued';

/** How the driver was established. Rendered — never hidden. */
export type LinkConfidence = 'recorded' | 'inferred' | 'unknown';

/**
 * WHERE the driver text came from. Not rendered; it exists to stop one
 * inference being used as evidence for another.
 *
 * A driver derived from a backlog item quotes that item's wording, so feeding it
 * back into "has this idea already been done?" makes every such idea match the
 * tool it was guessed from — the guess becomes its own proof.
 */
export type DriverSource = 'recorded' | 'intent' | 'backlog' | 'none';

/** Is the outcome a measurement, a stated expectation, or not yet knowable? */
export type OutcomeKind = 'measured' | 'expected' | 'pending';

/** One dated step in an improvement's arc. */
export interface StoryEvent {
  at: string;
  runId: string;
  /** Short verb: queued, built, shipped, rejected, repaired, published… */
  label: string;
  note?: string;
}

export interface ImprovementStory {
  /** Stable key: `kind:subject`. */
  id: string;
  kind: StoryKind;
  /** The thing being improved — a tool name, a policy target, an idea slug. */
  subject: string;
  /** Card headline — the tool name or the idea, not a sentence. */
  title: string;
  /** One line saying what the card is about, under the headline. */
  subtitle?: string;
  /**
   * A caveat the reader needs in order to trust the card — currently used where
   * the engine's own bookkeeping is inconsistent (an idea still queued although
   * a tool that appears to serve it already shipped).
   */
  note?: string;
  status: StoryStatus;
  statusLabel: string;

  /** WHY this happened, in plain English. */
  driver: string;
  /** The number behind the driver, when one was recorded. */
  driverEvidence?: string;
  /** Verbatim user questions that motivated it. Owner-only (see module doc). */
  driverQuotes?: string[];
  linkConfidence: LinkConfidence;
  /** Provenance of `driver`. Internal — see DriverSource. */
  driverSource?: DriverSource;
  /**
   * The unmet need in its ORIGINAL wording, with none of this module's
   * sentence-building around it. Used for text matching, never rendered:
   * comparing generated prose to generated prose matches on the template
   * ("You asked N questions…" vs "Unmet need identified from N questions…")
   * rather than on the subject matter.
   */
  driverNeed?: string;

  /** WHAT was chosen and done. */
  solution: string;

  /** WHAT came of it. */
  outcome: string;
  outcomeKind: OutcomeKind;

  events: StoryEvent[];
  firstAt: string;
  lastAt: string;
}

/** A run as loaded by the page — key, timestamp, and the stored record. */
export interface NarrativeRun {
  runId: string;
  createdAt: string;
  data: ImprovementRunData;
}

/** Live health of a custom tool, from the `custom_tools` table. */
export interface ToolHealth {
  name: string;
  description?: string;
  enabled: boolean;
  runCount: number;
  errorCount: number;
  createdAt?: string;
}

export interface NarrativeInput {
  runs: NarrativeRun[];
  backlog: BacklogItemData[];
  policyVersions: ToolPolicyVersion[];
  toolHealth: ToolHealth[];
  insights: QuestionInsights | null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Function words only. Kept deliberately tight: dropping a domain word like
 * "date" would break "up-to-date knowledge", which is exactly the phrase that
 * links govuk_search to its driver.
 */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'with', 'by',
  'from', 'is', 'are', 'was', 'were', 'it', 'this', 'that', 'via', 'you', 'your',
  'when', 'what', 'any', 'all', 'can', 'use', 'using', 'used', 'returns',
  'return', 'get', 'gets', 'e', 'g', 'etc', 'one', 'more', 'each', 'per', 'its',
  'their', 'about', 'into', 'over', 'such', 'also', 'may', 'will', 'has', 'have',
]);

/**
 * The content words of a piece of text — the unit every match here is counted
 * in.
 *
 * Exported so a caller can BLOCK on it before comparing: `looksSameSubject`
 * needs three shared words, which implies at least one, so an inverted index
 * built from this function generates a strict superset of the pairs the
 * predicate could accept. That is what lets the clusterer skip ~99% of the
 * 103,000 pairs in a 455-row backlog without changing a single verdict. It is
 * a pre-filter over the same tokens, not a second opinion about them.
 */
export function contentWords(text: string): Set<string> {
  const words = (text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length > 2 && !STOP.has(w)));
}

const tokenSet = contentWords;

/**
 * How strongly two texts overlap — the raw measurement every verdict in this
 * file is a threshold on.
 *
 * Exported as `subjectOverlap` below so a caller can RANK matches without
 * re-deriving what "related" means. `looksSameSubject` answers whether; this
 * answers how much, off the same tokens and the same arithmetic.
 *
 * Normalised by the SMALLER set: a four-word unmet need should be able to
 * match a sixty-word tool description without being punished for the length
 * difference — Jaccard would score that near zero.
 */
function overlap(a: Set<string>, b: Set<string>): { score: number; hits: number; tightness: number } {
  if (a.size === 0 || b.size === 0) return { score: 0, hits: 0, tightness: 0 };
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  // `score` deliberately ignores how much of the LONGER text went unmatched,
  // so a four-word need can match a sixty-word description. That is right for
  // admitting a match and useless for ranking two that both score 1.0 — a
  // three-word title matches both its exact twin and a six-word title that
  // contains it. `tightness` is the Jaccard the score throws away, and it is
  // the tie-break: the twin wins over the superset.
  return { score: hits / Math.min(a.size, b.size), hits, tightness: hits / (a.size + b.size - hits) };
}

/** Two shared content words AND a quarter of the smaller set — see tests. */
const MATCH_MIN_HITS = 2;
const MATCH_MIN_SCORE = 0.25;

/**
 * `minHits` is raised by callers that must not produce false positives.
 *
 * Two hits is right for "which need does this tool serve", where the candidate
 * set is small and a near miss still points somewhere sensible. It is far too
 * loose for "has this idea already been done": short titles are mostly generic
 * words, and on real data "Live OpenRouter balance" matched `govuk_search` on
 * nothing but "live" and "api" — a claim that a queued idea was finished when
 * it was not.
 */
function looksLinked(a: string, b: string, minHits = MATCH_MIN_HITS): boolean {
  const { score, hits } = overlap(tokenSet(a), tokenSet(b));
  return hits >= minHits && score >= MATCH_MIN_SCORE;
}

/** Distinct content words that must coincide before two texts are called the
 *  same subject. */
export const SAME_SUBJECT_MIN_HITS = 3;

/**
 * Are these two texts about the same thing?
 *
 * The strict reading of `looksLinked`, and the ONLY one three callers use: the
 * ledger asking "has something shipped that already covers this idea", the
 * queue board asking the same, and the clusterer asking "are these two queued
 * ideas restatements of one another". They are one question with three
 * operands, so they get one predicate — a second definition of "related" is
 * the bug that left every driver unrecorded for a fortnight.
 *
 * Two hits is far too loose here: short titles are mostly generic words, and
 * on real data "Live OpenRouter balance" matched `govuk_search` on nothing but
 * "live" and "api".
 *
 * Compare titles and subjects, never generated prose: "You asked N questions…"
 * and "Unmet need identified from N questions…" match on the template rather
 * than the subject.
 */
export function looksSameSubject(a: string, b: string): boolean {
  return looksLinked(a, b, SAME_SUBJECT_MIN_HITS);
}

/**
 * The strength behind a `looksSameSubject` verdict, for callers that must rank
 * several passing matches against each other rather than merely admit them.
 *
 * Exported so the clusterer can join an item to its STRONGEST partner instead
 * of to everything it passes against. Measured on production: joining every
 * passing pair chained eleven distinct themes into one 100-item component
 * through a handful of generic bridging titles, which is the standard
 * single-linkage failure and left 384 of 455 rows ungrouped once that blob
 * blew the size cap.
 */
export function subjectOverlap(a: string, b: string): { score: number; hits: number; tightness: number } {
  return overlap(tokenSet(a), tokenSet(b));
}

/** Best of several candidates, or null when none clear the bar. */
function bestMatch<T>(needle: string, items: T[], text: (t: T) => string): T | null {
  const nt = tokenSet(needle);
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const { score, hits } = overlap(nt, tokenSet(text(item)));
    if (hits < MATCH_MIN_HITS || score < MATCH_MIN_SCORE) continue;
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item ?? null;
}

/**
 * Which queued idea a piece of work belongs to.
 *
 * Exported so the ENGINE and the LEDGER agree on what "related" means. The
 * builder previously had its own one-line matcher (`description.includes(first
 * 20 chars of title)`) which never once fired in production, leaving every
 * backlog item open and every driver unrecorded. One definition, used by both.
 */
export function findRelatedIdea<T extends { slug: string; title: string; detail: string }>(
  text: string,
  items: T[],
): T | null {
  return bestMatch(text, items, (i) => `${i.title} ${i.detail}`);
}

function trimTo(text: string, max: number): string {
  const t = (text ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Strip a trailing full stop so callers can compose sentences safely. */
function unpunctuated(text: string): string {
  return (text ?? '').trim().replace(/[.\s]+$/, '');
}

function plural(n: number, word: string, suffix = 's'): string {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown date';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Subject extraction
// ---------------------------------------------------------------------------

/**
 * Action details are written as `<subject>: <prose>` by every phase, and
 * report.ts already splits on the colon for the WhatsApp summary. Runs recorded
 * before `action.story` existed are read back this way; newer runs carry the
 * subject as a field and never touch this.
 */
function subjectFromDetail(detail: string): string {
  return (detail ?? '').split(':')[0].trim();
}

/** `v3 targets fetch_url (…)` → 3. */
function policyVersionFromDetail(detail: string): number | null {
  const m = (detail ?? '').match(/\bv(\d+)\b/);
  return m ? Number(m[1]) : null;
}

interface Classified {
  key: string;
  kind: StoryKind;
  subject: string;
  label: string;
  note?: string;
}

/** Map one action onto the card it belongs to, or null if it isn't card-worthy. */
export function classifyAction(
  action: RunAction,
  policyByVersion: Map<number, ToolPolicyVersion>,
): Classified | null {
  const detail = action.detail ?? '';
  const recorded = action.story;

  switch (action.kind) {
    case 'tool_shipped':
    case 'tool_created': {
      const subject = recorded?.subject || subjectFromDetail(detail);
      if (!subject) return null;
      return {
        key: `tool:${subject}`,
        kind: 'tool',
        subject,
        label: action.kind === 'tool_shipped' ? 'shipped' : 'built',
      };
    }
    case 'tool_repaired': {
      const subject = recorded?.subject || subjectFromDetail(detail);
      if (!subject) return null;
      return { key: `repair:${subject}`, kind: 'repair', subject, label: 'repaired' };
    }
    case 'tool_rejected': {
      // `nearby_places (repair): candidate did not beat the incumbent` — a
      // failed repair belongs to the repair card, not the tool's build card.
      const head = subjectFromDetail(detail);
      const isRepair = /\(repair\)/i.test(head) || recorded?.mode === 'repair';
      const subject = recorded?.subject || head.replace(/\s*\(repair\)\s*$/i, '').trim();
      if (!subject) return null;
      // Overlay rejections name a policy, not a tool.
      if (/^call policy for /i.test(detail)) {
        const target = detail.replace(/^call policy for\s*/i, '').split(':')[0].trim();
        return target
          ? { key: `policy:${target}`, kind: 'policy', subject: target, label: 'overlay rejected' }
          : null;
      }
      return {
        key: isRepair ? `repair:${subject}` : `tool:${subject}`,
        kind: isRepair ? 'repair' : 'tool',
        subject,
        label: 'rejected',
        note: detail.slice(detail.indexOf(':') + 1).trim(),
      };
    }
    case 'policy_published':
    case 'policy_kept':
    case 'policy_reverted': {
      const version = policyVersionFromDetail(detail);
      const target =
        recorded?.subject ||
        (version !== null ? policyByVersion.get(version)?.targetTool : undefined) ||
        detail.match(/targets\s+(\S+)/)?.[1];
      if (!target) return null;
      const label =
        action.kind === 'policy_published'
          ? 'published on trial'
          : action.kind === 'policy_kept'
            ? 'kept'
            : 'rolled back';
      return { key: `policy:${target}`, kind: 'policy', subject: target, label };
    }
    case 'api_registered':
    case 'api_verified': {
      // discover.ts writes `<name> → <status> (for "<need>")`. The need is the
      // driver, so it is carried through rather than thrown away with the rest.
      const m = detail.match(/^(.+?)\s*→\s*(\S+)(?:\s*\(for\s*"([^"]*)"\))?/);
      const subject = (recorded?.subject || m?.[1] || subjectFromDetail(detail) || detail).trim();
      if (!subject) return null;
      return {
        key: `api:${subject}`,
        kind: 'api',
        subject,
        label: action.kind === 'api_registered' ? 'catalogued' : 'verified',
        note: m?.[3]?.trim() || undefined,
      };
    }
    case 'backlog_added': {
      const slug = (recorded?.subject || detail).trim();
      if (!slug) return null;
      return { key: `idea:${slug}`, kind: 'idea', subject: slug, label: 'queued' };
    }
    // Insights and measurements are context for other cards, not cards
    // themselves — the prime-outcome tiles already report the metric, and
    // `proposal` details are mostly "nothing buildable this run".
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Driver resolution
// ---------------------------------------------------------------------------

/** Field names match ImprovementStory so a resolved driver can be spread in. */
interface DriverText {
  driver: string;
  driverEvidence?: string;
  driverQuotes?: string[];
  linkConfidence: LinkConfidence;
  driverSource?: DriverSource;
  driverNeed?: string;
}

/** Turn one learned intent into the sentence that explains a build. */
function driverFromIntent(intent: QuestionInsights['intents'][number]): DriverText {
  const need = unpunctuated(intent.missingCapability ?? '');
  const asked = `You asked ${plural(intent.count, 'question')} of this kind`;
  return {
    driver: need
      ? `${asked}, and jkai had no way to answer them: ${need}.`
      : `${asked} and they were not being served well.`,
    driverEvidence: `intent "${intent.intent}" · ${plural(intent.count, 'question')} · flagged unserved`,
    driverQuotes: (intent.examples ?? []).slice(0, 2).map((q) => trimTo(q, 140)),
    linkConfidence: 'inferred',
    driverSource: 'intent',
    driverNeed: need || intent.intent,
  };
}

/**
 * Find what motivated a built tool.
 *
 * Preference order: what the engine recorded → the backlog item it was linked
 * to → the learned intent whose unmet capability the tool's description
 * matches. Only the first is `recorded`; the rest are labelled `inferred`
 * because they are established by text similarity, not by a stored reference.
 */
export function resolveToolDriver(
  subject: string,
  description: string,
  story: RunAction['story'] | undefined,
  backlog: BacklogItemData[],
  insights: QuestionInsights | null,
): DriverText {
  if (story?.driver) {
    return {
      driver: story.driver,
      driverEvidence: story.driverEvidence,
      driverQuotes: story.driverQuotes,
      linkConfidence: 'recorded',
      driverSource: 'recorded',
      driverNeed: story.driver,
    };
  }

  const haystack = `${subject.replace(/_/g, ' ')} ${description}`;

  // A backlog item the engine explicitly linked to this run's build.
  const linked = story?.driverRef
    ? backlog.find((b) => b.slug === story.driverRef)
    : null;
  if (linked) {
    return {
      driver: `Queued as an unmet need: ${unpunctuated(linked.title)}.`,
      driverEvidence: linked.detail ? trimTo(linked.detail, 220) : undefined,
      linkConfidence: 'recorded',
      driverSource: 'recorded',
      driverNeed: linked.title,
    };
  }

  // Otherwise: the learned intent this tool most plausibly serves.
  const unserved = (insights?.intents ?? []).filter(
    (i) => i.servedWell === false && (i.missingCapability || i.intent),
  );
  const intent = bestMatch(haystack, unserved, (i) => `${i.intent} ${i.missingCapability ?? ''}`);
  if (intent) return driverFromIntent(intent);

  // Or an idea sitting in the backlog that describes the same thing.
  const idea = bestMatch(haystack, backlog, (b) => `${b.title} ${b.detail}`);
  if (idea) {
    return {
      driver: `Likely built for the queued need: ${unpunctuated(idea.title)}.`,
      driverEvidence: idea.detail ? trimTo(idea.detail, 220) : undefined,
      linkConfidence: 'inferred',
      driverSource: 'backlog',
    };
  }

  return {
    driver: 'The engine did not record what prompted this one.',
    linkConfidence: 'unknown',
    driverSource: 'none',
  };
}

/** The driver for an idea card is the idea itself — always recorded. */
function driverFromBacklogItem(item: BacklogItemData | undefined, slug: string): DriverText {
  if (!item) {
    return {
      driver: `Queued as "${slug.replace(/-/g, ' ')}" — the original note is no longer in the backlog.`,
      linkConfidence: 'unknown',
    };
  }
  return {
    driver: `A gap in what jkai could answer: ${unpunctuated(item.title)}.`,
    driverEvidence: item.detail ? trimTo(item.detail, 240) : undefined,
    linkConfidence: 'recorded',
  };
}

// ---------------------------------------------------------------------------
// Outcome resolution
// ---------------------------------------------------------------------------

/**
 * What a shipped tool has actually done since.
 *
 * `runCount` on custom_tools is CUMULATIVE and never reset, so it cannot by
 * itself say "used since shipping" for a tool that existed beforehand. Newer
 * runs record the count at ship time (`story.runCountAtAction`) and the delta is
 * then exact; without it this reports the lifetime figure and says so.
 */
function outcomeForShippedTool(
  health: ToolHealth | undefined,
  story: RunAction['story'] | undefined,
  shippedAt: string,
): { outcome: string; kind: OutcomeKind; status: StoryStatus; statusLabel: string } {
  if (!health) {
    return {
      outcome: `Shipped on ${dayLabel(shippedAt)}, but it is no longer in the tool registry — it has since been removed.`,
      kind: 'measured',
      status: 'rejected',
      statusLabel: 'gone',
    };
  }

  const base = story?.runCountAtAction;
  const since = typeof base === 'number' ? Math.max(0, health.runCount - base) : null;
  const errors = health.errorCount;

  if (!health.enabled) {
    return {
      outcome: `Went live on ${dayLabel(shippedAt)} but is currently disabled, so jkai cannot call it.`,
      kind: 'measured',
      status: 'rejected',
      statusLabel: 'disabled',
    };
  }

  if (since === null && health.runCount === 0) {
    return {
      outcome: `Live since ${dayLabel(shippedAt)}. jkai has not needed it yet — nothing to measure.`,
      kind: 'pending',
      status: 'live',
      statusLabel: 'live',
    };
  }

  if (since !== null) {
    if (since === 0) {
      return {
        outcome: `Live since ${dayLabel(shippedAt)}. Not called yet, so the benefit is still unproven.`,
        kind: 'pending',
        status: 'live',
        statusLabel: 'live',
      };
    }
    const errPart = errors > 0 ? `, ${plural(errors, 'error')} in total` : ' with no errors';
    return {
      outcome: `Live since ${dayLabel(shippedAt)} and called ${plural(since, 'time')} since${errPart}.`,
      kind: 'measured',
      status: 'live',
      statusLabel: 'live',
    };
  }

  const errPart = errors > 0 ? `, ${plural(errors, 'error')}` : ' with no errors';
  return {
    outcome: `Live since ${dayLabel(shippedAt)}. Called ${plural(health.runCount, 'time')} in total${errPart} (lifetime figure — the count at ship time was not recorded).`,
    kind: 'measured',
    status: 'live',
    statusLabel: 'live',
  };
}

/** Plain-English reading of a policy trial. */
function outcomeForPolicy(
  version: ToolPolicyVersion | undefined,
): { outcome: string; kind: OutcomeKind; status: StoryStatus; statusLabel: string } {
  const trial = version?.trial;
  if (!version || !trial) {
    return {
      outcome: 'Published without a trial attached, so there is nothing to judge it against.',
      kind: 'pending',
      status: 'trial',
      statusLabel: 'no trial',
    };
  }
  const before = trial.baseline?.meanCalls;
  const after = trial.result?.meanCalls;

  if (trial.status === 'kept') {
    return {
      outcome:
        `Kept. ${trial.verdict ?? 'It beat the baseline it was measured against.'}` +
        (before !== undefined && after !== undefined
          ? ` Calls per chat turn went ${before} → ${after}.`
          : ''),
      kind: 'measured',
      status: 'kept',
      statusLabel: 'kept',
    };
  }
  if (trial.status === 'reverted') {
    return {
      outcome:
        `Rolled back automatically. ${trial.verdict ?? 'It did not beat its baseline.'}` +
        (before !== undefined && after !== undefined
          ? ` Calls per chat turn went ${before} → ${after}.`
          : '') +
        ' The wording costs prompt tokens every turn, so anything that does not earn its place is removed.',
      kind: 'measured',
      status: 'reverted',
      statusLabel: 'rolled back',
    };
  }
  return {
    outcome:
      `On trial since ${dayLabel(trial.startedAt)}: ${trial.turnsObserved} of 30 chat turns observed. ` +
      `It stays only if calls per turn drop at least 5% below ${before ?? 'the baseline'}; otherwise it rolls itself back.`,
    kind: 'expected',
    status: 'trial',
    statusLabel: 'on trial',
  };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface Bucket {
  key: string;
  kind: StoryKind;
  subject: string;
  events: StoryEvent[];
  actions: Array<{ action: RunAction; at: string; runId: string }>;
}

const KIND_ORDER: Record<StoryKind, number> = { tool: 0, repair: 1, policy: 2, api: 3, idea: 4 };
const STATUS_WEIGHT: Record<StoryStatus, number> = {
  live: 0, fixed: 1, kept: 2, trial: 3, catalogued: 4, reverted: 5, rejected: 6, queued: 7,
};

/**
 * Build the plain-English cards.
 *
 * Newest activity first, but a live improvement outranks a queued idea on the
 * same day: the page answers "what has changed" before "what might".
 */
export function buildStories(input: NarrativeInput): ImprovementStory[] {
  const policyByVersion = new Map((input.policyVersions ?? []).map((v) => [v.version, v]));
  const policyByTarget = new Map<string, ToolPolicyVersion>();
  // Newest version per target wins — that is the one whose trial is current.
  for (const v of [...(input.policyVersions ?? [])].sort((a, b) => a.version - b.version)) {
    if (v.targetTool) policyByTarget.set(v.targetTool, v);
  }
  const healthByName = new Map((input.toolHealth ?? []).map((t) => [t.name, t]));
  const backlogBySlug = new Map((input.backlog ?? []).map((b) => [b.slug, b]));

  // ── Group every action onto its card ──────────────────────────────────────
  const buckets = new Map<string, Bucket>();
  const runsOldestFirst = [...(input.runs ?? [])].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt),
  );

  for (const run of runsOldestFirst) {
    for (const action of run.data?.actions ?? []) {
      const cls = classifyAction(action, policyByVersion);
      if (!cls) continue;
      let bucket = buckets.get(cls.key);
      if (!bucket) {
        bucket = { key: cls.key, kind: cls.kind, subject: cls.subject, events: [], actions: [] };
        buckets.set(cls.key, bucket);
      }
      bucket.events.push({
        at: run.createdAt,
        runId: run.runId,
        label: cls.label,
        note: cls.note ? trimTo(cls.note, 200) : undefined,
      });
      bucket.actions.push({ action, at: run.createdAt, runId: run.runId });
    }
  }

  const stories: ImprovementStory[] = [];
  for (const bucket of buckets.values()) {
    const story = assemble(bucket, {
      policyByTarget,
      healthByName,
      backlogBySlug,
      backlog: input.backlog ?? [],
      insights: input.insights,
    });
    if (story) stories.push(story);
  }

  annotateAlreadyServedIdeas(stories, backlogBySlug);

  return stories.sort(
    (a, b) =>
      b.lastAt.localeCompare(a.lastAt) ||
      STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}

/**
 * Flag ideas that a shipped tool appears to have already served.
 *
 * The engine closes a backlog item only when its own matcher links a built tool
 * back to it, and that matcher cannot see ideas added during the SAME run — so
 * on 30 Jul it shipped `home_sensor_status` and `govuk_search` while leaving
 * "Real-time home sensor data" and "Up-to-date knowledge on UK government
 * projects" sitting open, ready to be built a second time.
 *
 * The card is annotated rather than hidden. Suppressing it would need this
 * text-similarity guess to be RIGHT, and a wrong guess would silently claim
 * finished work that is not finished — "Home security summary tool" genuinely is
 * a further idea, not a duplicate of `home_sensor_status`. Saying "this looks
 * covered, and the engine has not noticed" is both honest and the more useful
 * signal, because it names a real gap in the engine's bookkeeping.
 */
function annotateAlreadyServedIdeas(
  stories: ImprovementStory[],
  backlogBySlug: Map<string, BacklogItemData>,
): void {
  const shipped = stories.filter((s) => s.kind === 'tool' && (s.status === 'live' || s.status === 'fixed'));
  if (shipped.length === 0) return;

  for (const story of stories) {
    if (story.kind !== 'idea' || story.note) continue;
    // The TITLE only. A backlog `detail` is often the boilerplate "Unmet need
    // identified from 60 questions in 2026-31", whose words ("need",
    // "questions") appear in every generated driver and match everything.
    const ideaText = story.title;
    // Compare against the tool's DRIVER as well as its description. Both the
    // idea and the driver are phrased from the same learned unmet need ("Live or
    // up-to-date knowledge on UK government projects"), whereas the tool's own
    // description is written in API terms and shares far less vocabulary.
    const match = shipped.find((t) =>
      looksSameSubject(
        ideaText,
        // The need in its ORIGINAL wording, never the generated sentence. And a
        // driver GUESSED from the backlog quotes the idea's own words back at
        // it, so including that would make every such guess self-confirming.
        `${t.subject.replace(/_/g, ' ')} ${t.subtitle ?? ''} ` +
          (t.driverSource === 'backlog' ? '' : (t.driverNeed ?? '')),
      ),
    );
    if (!match) continue;
    story.note =
      `\`${match.subject}\` shipped on ${dayLabel(match.firstAt)} and looks like it covers this, ` +
      `but the engine did not record the link — so this idea is still queued and may be built twice.`;
  }
}

interface AssembleCtx {
  policyByTarget: Map<string, ToolPolicyVersion>;
  healthByName: Map<string, ToolHealth>;
  backlogBySlug: Map<string, BacklogItemData>;
  backlog: BacklogItemData[];
  insights: QuestionInsights | null;
}

function assemble(bucket: Bucket, ctx: AssembleCtx): ImprovementStory | null {
  const { kind, subject } = bucket;
  const firstAt = bucket.events[0]?.at ?? '';
  const lastAt = bucket.events[bucket.events.length - 1]?.at ?? firstAt;
  const last = bucket.actions[bucket.actions.length - 1];
  const attempts = bucket.actions.filter((a) => a.action.kind === 'tool_rejected').length;

  const base = {
    id: bucket.key,
    kind,
    subject,
    events: bucket.events,
    firstAt,
    lastAt,
  };

  if (kind === 'tool') {
    const shipped = [...bucket.actions]
      .reverse()
      .find((a) => a.action.kind === 'tool_shipped' || a.action.kind === 'tool_created');
    const health = ctx.healthByName.get(subject);
    const description =
      shipped?.action.story?.solution ||
      health?.description ||
      (shipped ? shipped.action.detail.slice(shipped.action.detail.indexOf(':') + 1) : '') ||
      '';
    const driver = resolveToolDriver(
      subject,
      description,
      shipped?.action.story ?? last?.action.story,
      ctx.backlog,
      ctx.insights,
    );

    if (!shipped) {
      // Tried, never shipped.
      const reason = last?.action.story?.outcome || bucket.events[bucket.events.length - 1]?.note;
      const queued = ctx.backlog.find((b) => looksLinked(`${subject} ${description}`, `${b.title} ${b.detail}`));
      return {
        ...base,
        title: subject,
        subtitle: 'A tool the engine tried to build',
        status: 'rejected',
        statusLabel: attempts > 1 ? `rejected ${attempts}×` : 'rejected',
        ...driver,
        solution: `Wrote a tool called \`${subject}\` and tested it before letting it anywhere near a conversation.`,
        outcome:
          `Not shipped — it failed its own safety and smoke tests${reason ? `: ${unpunctuated(trimTo(reason, 200))}` : ''}. ` +
          (queued && queued.status === 'open'
            ? 'The idea stays on the backlog, and the failure is fed back into the next attempt.'
            : 'Nothing went live, so jkai is unchanged.'),
        outcomeKind: 'measured',
      };
    }

    const res = outcomeForShippedTool(health, shipped.action.story, shipped.at);
    const repairNote = attempts > 0 ? ` It took ${plural(attempts, 'attempt')} to get past verification.` : '';
    return {
      ...base,
      title: subject,
      subtitle: description ? trimTo(unpunctuated(description), 150) : 'A tool the engine built',
      status: res.status,
      statusLabel: res.statusLabel,
      ...driver,
      solution:
        `Wrote a new tool, \`${subject}\`, and enabled it once it passed a static safety scan and a live smoke test.${repairNote}`,
      outcome: res.outcome,
      outcomeKind: res.kind,
    };
  }

  if (kind === 'repair') {
    const repaired = [...bucket.actions].reverse().find((a) => a.action.kind === 'tool_repaired');
    const health = ctx.healthByName.get(subject);
    const story = repaired?.action.story ?? last?.action.story;
    const recordedDriver = story?.driver;
    const errorRate =
      health && health.runCount > 0
        ? Math.round((health.errorCount / health.runCount) * 100)
        : null;

    const driver: DriverText = recordedDriver
      ? { driver: recordedDriver, driverEvidence: story?.driverEvidence, linkConfidence: 'recorded' }
      : {
          driver: `\`${subject}\` was failing often enough to be worth rewriting rather than leaving in place.`,
          driverEvidence:
            errorRate !== null && health
              ? `${errorRate}% of its ${plural(health.runCount, 'call')} have errored (lifetime)`
              : undefined,
          linkConfidence: errorRate !== null ? 'inferred' : 'unknown',
        };

    if (!repaired) {
      return {
        ...base,
        title: subject,
        subtitle: 'An attempt to fix a tool that keeps failing',
        status: 'rejected',
        statusLabel: 'no better',
        ...driver,
        solution: `Re-wrote the tool's code and ran the old and new versions against identical tests.`,
        outcome:
          'The rewrite did not beat the version already in place, so nothing was swapped in. ' +
          'The original stays live — a repair only lands if it strictly wins.',
        outcomeKind: 'measured',
      };
    }

    const notes = story?.solution || repaired.action.detail.split('—').slice(1).join('—').trim();
    const delta = story?.outcome || repaired.action.detail.match(/(\d+)→(\d+) of (\d+) smoke cases/)?.[0];
    return {
      ...base,
      title: subject,
      subtitle: 'A failing tool, rewritten',
      status: 'fixed',
      statusLabel: 'fixed',
      ...driver,
      solution: notes
        ? `Re-wrote its code and swapped it in only after it beat the old version on identical tests. ${unpunctuated(trimTo(notes, 260))}.`
        : `Re-wrote its code and swapped it in only after it beat the old version on identical tests.`,
      outcome: delta
        ? `The new version passes where the old one failed (${delta}) and is live now. Whether that holds in real use will show in its error rate over the coming days.`
        : 'The new version beat the old one on identical tests and is live now.',
      outcomeKind: 'expected',
    };
  }

  if (kind === 'policy') {
    const version = ctx.policyByTarget.get(subject);
    const published = [...bucket.actions].reverse().find((a) => a.action.kind === 'policy_published');
    const story = published?.action.story;
    const patternHit = published?.action.detail.match(/\((\d+) repeat calls over (\d+) turns?\)/);

    const driver: DriverText = story?.driver
      ? { driver: story.driver, driverEvidence: story.driverEvidence, linkConfidence: 'recorded' }
      : patternHit
        ? {
            driver:
              `\`${subject}\` was being called over and over inside single conversations — the same tool, ` +
              `again and again, to answer one question.`,
            driverEvidence: `${patternHit[1]} repeated calls across ${plural(Number(patternHit[2]), 'turn')}`,
            linkConfidence: 'inferred',
          }
        : {
            driver: `\`${subject}\` was identified as a repeat-call offender.`,
            linkConfidence: 'unknown',
          };

    if (!published && !version) return null;
    const res = outcomeForPolicy(version);
    const rationale = version?.rationale ? unpunctuated(trimTo(version.rationale, 260)) : '';
    return {
      ...base,
      title: subject,
      subtitle: 'Reworded so jkai calls it less often',
      status: res.status,
      statusLabel: res.statusLabel,
      ...driver,
      solution:
        `Re-worded how the tool is described to jkai, so it reaches for it more deliberately` +
        (rationale ? `: ${rationale}.` : '.') +
        ` No code changed — this is wording only, which is why it can be undone instantly.`,
      outcome: res.outcome,
      outcomeKind: res.kind,
    };
  }

  if (kind === 'api') {
    const registered = bucket.actions.some((a) => a.action.kind === 'api_registered');
    // The need the catalogue entry was found FOR — captured at classify time.
    const need = bucket.events.map((e) => e.note).filter(Boolean)[0];
    return {
      ...base,
      title: subject,
      subtitle: 'A data source added to the API catalogue',
      status: 'catalogued',
      statusLabel: registered ? 'catalogued' : 'verified',
      driver: need
        ? `jkai had no trustworthy source for this: ${unpunctuated(need)}.`
        : `jkai needed a trustworthy source for this kind of question and did not have one catalogued.`,
      driverEvidence: need ? 'recorded as an unmet need when the API was found' : undefined,
      linkConfidence: need ? 'recorded' : 'unknown',
      solution: `Found the API, probed it live to confirm it actually responds, and added it to the catalogue jkai is allowed to call.`,
      outcome: `It is available to every future answer. Nothing changes until a question needs it.`,
      outcomeKind: 'expected',
    };
  }

  // kind === 'idea'
  const item = ctx.backlogBySlug.get(subject);
  const driver = driverFromBacklogItem(item, subject);
  if (item?.status === 'shipped') return null; // told by the tool card instead
  const failed = item?.lastError;
  return {
    ...base,
    title: item ? trimTo(unpunctuated(item.title), 110) : subject.replace(/-/g, ' '),
    subtitle: 'An idea waiting to be built',
    status: 'queued',
    statusLabel: item && item.attempts > 0 ? `tried ${plural(item.attempts, 'time')}` : 'queued',
    ...driver,
    solution: item?.kind === 'feature'
      ? 'Too large to build unattended — it is written up for a human to review rather than shipped by the engine.'
      : 'Queued to be built on a future night. Nothing has been written yet.',
    outcome: failed
      ? `Attempted and failed so far: ${unpunctuated(trimTo(failed, 200))}. That error is fed back into the next attempt.`
      : 'Waiting its turn. Ideas are picked fewest-attempts-first, so this will be tried before anything already failed.',
    outcomeKind: 'pending',
  };
}

/** Headline counts for the section summary. */
export function summariseStories(stories: ImprovementStory[]): {
  live: number;
  fixed: number;
  onTrial: number;
  queued: number;
  rejected: number;
} {
  return {
    live: stories.filter((s) => s.status === 'live').length,
    fixed: stories.filter((s) => s.status === 'fixed').length,
    onTrial: stories.filter((s) => s.status === 'trial' || s.status === 'kept').length,
    queued: stories.filter((s) => s.status === 'queued').length,
    rejected: stories.filter((s) => s.status === 'rejected' || s.status === 'reverted').length,
  };
}
