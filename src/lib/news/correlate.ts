// Which of today's stories are about something this knowledge base says matters.
//
// The brief was "news where there is a strong correlation between important
// elements in the intelligence graph, notes, chats, research". Two halves, and
// keeping them apart is the whole design:
//
//   THIS FILE is the maths, and it is PURE — anchors in, stories in, ranked
//   matches out. No `$lib/db`, so it is testable without a database and cannot
//   drag the server graph into a client bundle (same split as thread-graph /
//   thread-graph.server). `correlate.server.ts` builds the anchors.
//
// DELIBERATELY NOT AN LLM CALL, and deliberately not a vector search. The
// anchors are names the graph already resolved and the stories are 50 short
// titles; a name either appears in a headline or it does not, and a rule
// settles that for nothing per refresh. The house pattern is the same one the
// daydream engine states outright — rules detect, the model only phrases.
//
// It is also not an embedding search because "strong correlation" here means
// "this headline is about that thing", not "these two texts are near each
// other". ANN neighbours over short titles are mostly noise, which this
// codebase has already measured once.

import { acronymsOf, normaliseName, significantTokens } from '$lib/jkai/intel/resolve/match';
import type { NewsStory } from './types';

/** Where an anchor came from. Drives its weight and how a match is explained. */
export type AnchorKind = 'entity' | 'research' | 'memory' | 'chat';

/**
 * One important element of the knowledge base, as a thing to look for in a
 * headline. `name` is the display form; `aliases` are the other surface forms
 * the graph knows (see the intel `aliases` column, which merges write).
 */
export interface Anchor {
  id: string;
  name: string;
  aliases: string[];
  kind: AnchorKind;
  /**
   * How much this element matters, 0–1, computed by the server half from what
   * the source can actually support: an entity's connectedness and whether it
   * is watched, a research session's recency, a memory's confidence.
   */
  importance: number;
  /** Human phrase for the citation line — "watched entity", "you researched". */
  why: string;
}

export type MatchStrength = 'name' | 'phrase' | 'acronym';

export interface StoryMatch {
  anchor: Anchor;
  /** The surface form that actually matched, as it appears in the anchor. */
  matched: string;
  strength: MatchStrength;
  /** anchor.importance × the strength multiplier, 0–1. */
  score: number;
}

export interface CorrelatedStory {
  story: NewsStory;
  matches: StoryMatch[];
  /** The best single match's score — what the list is ranked by. */
  score: number;
}

/**
 * A multi-word name in a headline is close to proof; a single common word is a
 * coincidence waiting to happen; an acronym is in between and only counted when
 * it is capitalised in the headline (see `matchesAcronym`).
 */
const STRENGTH_WEIGHT: Record<MatchStrength, number> = {
  phrase: 1,
  name: 0.62,
  acronym: 0.45,
};

/**
 * The floor, PER STRENGTH — because one number could not serve both ends of it.
 *
 * Calibrated against the live wire on 2026-09-02 rather than guessed. A single
 * global floor of 0.32 did two wrong things at once: it dropped "New things for
 * regular expressions in PostgreSQL" against a confirmed `PostgreSQL` entity
 * (0.5 importance × 0.62 = 0.31, under by a hundredth), while the number that
 * would have admitted it was still far above the real false positive of the
 * day — "Is Minifying CSS Necessary?" matching a `Corporate Services
 * subcommittee` acronym at 0.09.
 *
 * The two failures pull in opposite directions because the strengths are not
 * comparable evidence. A multi-word name in a headline is nearly proof and
 * needs little importance behind it; an acronym is a coincidence generator and
 * needs a lot. So each strength gets its own bar.
 */
export const STRENGTH_FLOOR: Record<MatchStrength, number> = {
  phrase: 0.25,
  name: 0.3,
  acronym: 0.45,
};

/** Kept for callers that want one number to describe the policy. */
export const STRONG_MATCH_FLOOR = STRENGTH_FLOOR.name;

/**
 * Single words too generic to mean anything in a technology headline, even when
 * the graph holds an entity of that name. Not a language model — a stop-list
 * for the handful of names that are also ordinary words, which is where a
 * name-match rule actually goes wrong.
 */
const TOO_GENERIC = new Set([
  'ai', 'api', 'app', 'apps', 'data', 'design', 'health', 'home', 'news', 'note',
  'notes', 'open', 'post', 'research', 'search', 'site', 'story', 'test', 'time',
  'tools', 'user', 'users', 'web', 'work', 'code', 'team', 'group', 'project',
  'service', 'system', 'model', 'models', 'report', 'review', 'update', 'family',
  'john', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'new',
]);

/** Lower-cased, punctuation-flattened, single-spaced — the space both sides of
 *  a comparison are put into before anything is compared. */
export function haystack(story: Pick<NewsStory, 'title' | 'summary' | 'domain'>): string {
  return ` ${normaliseName(`${story.title} ${story.summary} ${story.domain}`)} `;
}

/** Whole-word containment. `.includes` would match "rust" inside "trusted",
 *  which is the classic way a name-match rule earns its reputation. */
function containsPhrase(hay: string, needle: string): boolean {
  const n = normaliseName(needle);
  if (!n) return false;
  return hay.includes(` ${n} `);
}

/**
 * An acronym only counts when the HEADLINE capitalised it. Lower-cased, `ons`
 * and `dfe` collide with ordinary words and with each other; capitalised in a
 * title they are almost always the organisation. The raw title is passed in
 * un-normalised for exactly this reason.
 */
function matchesAcronym(rawTitle: string, acronym: string): boolean {
  if (acronym.length < 2 || acronym.length > 6) return false;
  const re = new RegExp(`\\b${acronym.toUpperCase()}\\b`);
  return re.test(rawTitle);
}

/**
 * An anchor with its per-anchor work already done.
 *
 * `significantTokens` and `acronymsOf` depend only on the anchor, and `haystack`
 * only on the story — but the obvious nesting recomputes all three inside the
 * inner loop. At the tool's eight anchors that was invisible; the desk now
 * correlates every row against every anchor, which is ~160 anchors x ~75
 * stories, and it meant normalising the same summary text twelve thousand
 * times. Both are hoisted instead.
 */
export interface PreparedAnchor {
  anchor: Anchor;
  forms: Array<{ form: string; tokens: string[] }>;
  acronyms: string[];
}

/** Do an anchor's form analysis once, ahead of the story loop. */
export function prepareAnchor(anchor: Anchor): PreparedAnchor {
  const forms = [anchor.name, ...anchor.aliases]
    .filter(Boolean)
    .map((form) => ({ form, tokens: significantTokens(form) }))
    .filter((entry) => entry.tokens.length > 0);
  const acronyms: string[] = [];
  for (const { form } of forms) {
    for (const acronym of acronymsOf(form)) {
      if (!TOO_GENERIC.has(acronym) && !acronyms.includes(acronym)) acronyms.push(acronym);
    }
  }
  return { anchor, forms, acronyms };
}

/** The strongest way this anchor appears in this story, or null. */
export function matchAnchor(story: NewsStory, anchor: Anchor): StoryMatch | null {
  return matchPrepared(story, haystack(story), prepareAnchor(anchor));
}

function matchPrepared(
  story: NewsStory,
  hay: string,
  prepared: PreparedAnchor,
): StoryMatch | null {
  const { anchor, forms, acronyms } = prepared;

  let best: { matched: string; strength: MatchStrength } | null = null;

  for (const { form, tokens } of forms) {
    // Multi-word forms are matched whole. "Data Spine" in a headline is about
    // the data spine; "data" is about anything.
    if (tokens.length > 1) {
      if (containsPhrase(hay, form)) {
        best = { matched: form, strength: 'phrase' };
        break;
      }
      continue;
    }

    const single = tokens[0];
    if (TOO_GENERIC.has(single) || single.length < 3) continue;
    if (containsPhrase(hay, single) && (!best || best.strength === 'acronym')) {
      best = { matched: form, strength: 'name' };
    }
  }

  if (!best) {
    // `acronymsOf` documents itself as a BLOCKING helper — deliberately more
    // generous than the matcher that decides merges. Using it to decide a match
    // is therefore a widening, and the three gates below are what pay for it:
    // the acronym must be 2–6 characters, must not be an ordinary word, and
    // must appear CAPITALISED in the headline. Note it cannot produce an
    // acronym that skips a preposition (`DfE`); those arrive as aliases, and
    // there is a test saying so.
    for (const acronym of acronyms) {
      if (matchesAcronym(story.title, acronym)) {
        best = { matched: acronym.toUpperCase(), strength: 'acronym' };
        break;
      }
    }
  }

  if (!best) return null;
  return {
    anchor,
    matched: best.matched,
    strength: best.strength,
    score: Number((anchor.importance * STRENGTH_WEIGHT[best.strength]).toFixed(4)),
  };
}

export interface CorrelateOptions {
  /**
   * Override the per-strength floors with one absolute number. Only for
   * probing — production wants `STRENGTH_FLOOR`, which is what omitting this
   * gives you. `floor: 0` reports everything, including the coincidences.
   */
  floor?: number;
  /** Most stories to return. */
  limit?: number;
  /** Most anchors to name per story — a headline matching nine entities is one
   *  fact, not nine. */
  matchesPerStory?: number;
}

/**
 * Rank today's wire against what the knowledge base says matters.
 *
 * Stories with no match are dropped entirely rather than returned with a zero:
 * the caller's question is "is any of this relevant", and a list of 50 stories
 * with 47 zeroes answers a different one.
 */
export function correlateStories(
  stories: readonly NewsStory[],
  anchors: readonly Anchor[],
  opts: CorrelateOptions = {},
): CorrelatedStory[] {
  const limit = opts.limit ?? 8;
  const perStory = opts.matchesPerStory ?? 3;
  const floorFor = (strength: MatchStrength) => opts.floor ?? STRENGTH_FLOOR[strength];

  const prepared = anchors.map(prepareAnchor);

  const out: CorrelatedStory[] = [];
  for (const story of stories) {
    const hay = haystack(story);
    const matches: StoryMatch[] = [];
    for (const entry of prepared) {
      const m = matchPrepared(story, hay, entry);
      if (m && m.score >= floorFor(m.strength)) matches.push(m);
    }
    if (matches.length === 0) continue;
    matches.sort((a, b) => b.score - a.score);
    out.push({
      story,
      matches: matches.slice(0, perStory),
      score: matches[0].score,
    });
  }

  // Score first, then the wire's own ranking — two stories about the same
  // watched entity should come back in the order the source thought mattered.
  out.sort((a, b) => b.score - a.score || a.story.rank - b.story.rank);
  return out.slice(0, limit);
}

/**
 * The first-party half of a match, with no third-party text in it.
 *
 * `lookups.ts` forbids putting text somebody else wrote into the daydream pack
 * — a card built from a headline is a prompt injection with a card id attached.
 * So the daydream path gets THIS: our own entity name, our own reason, and
 * counts. The headline stays on /news where a person reads it.
 */
export interface SafeCorrelation {
  anchorId: string;
  anchorName: string;
  anchorKind: AnchorKind;
  why: string;
  /** How many of today's stories matched this anchor. */
  storyCount: number;
  /** Highest score across those stories. */
  topScore: number;
  /** Which wires carried them — 'hacker-news', 'lobsters'. Ours, not theirs. */
  sources: string[];
}

/** Collapse story-shaped matches into anchor-shaped facts. */
export function summariseByAnchor(correlated: readonly CorrelatedStory[]): SafeCorrelation[] {
  const byAnchor = new Map<string, SafeCorrelation>();
  for (const c of correlated) {
    for (const m of c.matches) {
      const existing = byAnchor.get(m.anchor.id);
      if (existing) {
        existing.storyCount += 1;
        existing.topScore = Math.max(existing.topScore, m.score);
        if (!existing.sources.includes(c.story.source)) existing.sources.push(c.story.source);
        continue;
      }
      byAnchor.set(m.anchor.id, {
        anchorId: m.anchor.id,
        anchorName: m.anchor.name,
        anchorKind: m.anchor.kind,
        why: m.anchor.why,
        storyCount: 1,
        topScore: m.score,
        sources: [c.story.source],
      });
    }
  }
  return [...byAnchor.values()].sort((a, b) => b.topScore - a.topScore || b.storyCount - a.storyCount);
}
