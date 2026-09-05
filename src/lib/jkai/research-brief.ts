/**
 * The research stage Studio builds run before planning.
 *
 * Everything downstream cites back to this. The FACTS/GAPS split is deliberate:
 * a flat merged summary destroys provenance, and the fix that worked elsewhere
 * on this site was forcing facts to carry their source and gaps to be named
 * rather than smoothed over.
 *
 * Uses the existing Deep Dive engine — `startResearch` runs asynchronously and
 * writes `report` on the session row — then converts its ResearchReport into
 * the structured brief with one LLM call.
 */
import { db } from '$lib/db';
import { researchSessions, facts, sources, jkaiBuilds } from '$lib/db/schema';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { getLLMClient } from '$lib/llm/client';
import { resolveNotebookModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { emitLog } from './log-emitter';
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
import type { ResearchReport } from '$lib/deepdive/types';

export interface BriefFact {
  claim: string;
  sourceUrl: string;
  detail?: string;
  /** Publication the claim came from, for a citation a reader can weigh. */
  sourceTitle?: string;
  /**
   * What kind of source this is — 'government', 'news', 'social' and so on —
   * and how much weight the research desk gave it.
   *
   * A compensation scheme explained from GOV.UK primary material and one
   * explained from Facebook posts are different artefacts, and until now the
   * brief could not tell the difference: every fact arrived as a bare URL. A
   * previous studio build cited Facebook posts as evidence and nothing in the
   * system objected.
   */
  sourceType?: string;
  credibility?: number;
  /** Date the source was fetched. A 2019 page is not a 2025 fact. */
  asOf?: string;
}

export interface ResearchBrief {
  topic: string;
  facts: BriefFact[];
  concepts: Array<{ name: string; whyHard: string }>;
  /**
   * The model the levers are built on. Each link cites the numbered facts it
   * rests on, and a link that cannot cite them is dropped before the brief is
   * used — see groundCausalMap. The graph was the obvious place to derive this
   * from and turns out to be the wrong one: `relationship` holds `employs`,
   * `part_of`, `located_in` — ontology, not causation — across 353 distinct
   * types in 698 rows, with from_fact_id populated on none of them. So this
   * stays synthesised, and is made checkable instead.
   */
  causalMap: Array<{ from: string; to: string; relationship: string; facts?: number[] }>;
  liveData: Array<{ name: string; url: string; what: string }>;
  misconceptions: string[];
  gaps: string[];
  /**
   * Where the corpus contradicts itself, as CANDIDATES for the agent to judge.
   *
   * 291 facts carry `refutes_fact_id` and `searchResearch` excludes every one
   * of them (`AND NOT f.is_counterfactual`), so they could never arrive by the
   * normal route — the IBCA build had 31 in its own session and saw none.
   *
   * Not rendered as "sources disagree". Sampling five pairs found two genuine
   * and valuable ("estate eligibility is restricted" against "core awards are
   * available to eligible estates"), one a fair qualification, and two false
   * positives that are merely related statements. A 40% artefact rate belongs
   * in front of a judge, not a renderer.
   */
  contested?: Array<{ claim: string; counterClaim: string; claimUrl: string | null; counterUrl: string | null }>;
  sessionId: string | null;
}

/**
 * How long to wait for the deep-dive session's report.
 *
 * MEASURED, not guessed. The first pick was 20 minutes, which turned out to be
 * below the *average* real session and killed the very first studio build
 * (2026-08-10) at 20m00s while its session was still in phase3 with 353 facts
 * from 44 sources already gathered. Across the 17 completed sessions in
 * production at that point: mean 29.8m, p90 67.4m, max 82.8m.
 *
 * 90 minutes clears the observed maximum with headroom. Research does not count
 * against `activeMinutesUsed` (only iterations do), so a long research stage
 * spends wall-clock, not iteration budget.
 *
 * Raising this REQUIRES the heartbeat in the poll loop below — reapStaleBuilds
 * abandons any running build quiet for STALE_BUILD_MS (30 min), so a longer
 * deadline without a ping just moves the failure from the timeout to the reaper.
 */
export const RESEARCH_DEADLINE_MS = 90 * 60 * 1000;

/** How often the poll writes a progress line to the build log. */
const PROGRESS_INTERVAL_MS = 2 * 60 * 1000;

const MIN_FACTS = 8;
/** A brief drawn from one or two pages is technically sourced, not researched. */
const MIN_SOURCES = 3;
/** Cap on facts in a brief, identical on every path so prompts stay comparable. */
const BRIEF_FACT_CAP = 15;

/**
 * How a studio build gets its evidence.
 *
 * `reuse`  — only what is already in the corpus. No new session, seconds, no cost.
 * `extend` — reuse if it clears the bars, otherwise research the gaps, SEEDED with
 *            what was already found. The default: never worse than `fresh`, often
 *            far faster.
 * `fresh`  — always a new Deep Dive, ignoring prior work.
 */
export type ResearchMode = 'reuse' | 'extend' | 'fresh';
export const RESEARCH_MODES: readonly ResearchMode[] = ['reuse', 'extend', 'fresh'] as const;

/**
 * searchResearch's own default is 0.3, tuned for chat recall where a human reads
 * the hits and discards the duds. A brief's facts are rendered to a learner as
 * true, so precision matters more than recall here.
 */
const REUSE_MIN_SIM = 0.45;
/** searchResearch caps topK at 30; ask for the maximum and filter down. */
const REUSE_TOP_K = 30;

/**
 * Would a syllabus built on this brief be grounded, or invented?
 *
 * Called before the planner runs. A build that fails here stops with a clear
 * reason instead of producing a confident, sourceless explainer — which is the
 * single worst failure mode available to this feature.
 */
export function isBriefUsable(brief: ResearchBrief): { ok: boolean; reason?: string } {
  if (brief.facts.length < MIN_FACTS) {
    return {
      ok: false,
      reason: `Research produced only ${brief.facts.length} sourced facts (need ${MIN_FACTS}). Narrow the challenge statement or pick a topic with more public material.`,
    };
  }
  const unsourced = brief.facts.filter((f) => !f.sourceUrl || !/^https?:\/\//.test(f.sourceUrl));
  if (unsourced.length > 0) {
    return {
      ok: false,
      reason: `${unsourced.length} fact(s) arrived without a source URL, starting with "${unsourced[0].claim.slice(0, 80)}". A fact without provenance is a guess.`,
    };
  }
  // A brief could otherwise pass with 8+ well-formed https:// facts that all
  // point at the same one or two pages — technically sourced, not actually
  // researched. Require some spread across the source set.
  const distinctSources = new Set(brief.facts.map((f) => f.sourceUrl)).size;
  if (distinctSources < MIN_SOURCES) {
    return {
      ok: false,
      reason: `The brief draws on only ${distinctSources} distinct source${distinctSources === 1 ? '' : 's'} across ${brief.facts.length} facts. A brief built from one or two sources is not a research base.`,
    };
  }
  if (brief.gaps.length > brief.facts.length) {
    return {
      ok: false,
      reason: `The brief has more gaps than facts (${brief.gaps.length} gaps vs ${brief.facts.length} facts). There is not enough public material to explain this honestly.`,
    };
  }
  if (brief.causalMap.length === 0) {
    return {
      ok: false,
      reason: 'No causal relationships were found. Without them there is no model to build levers on, and every chapter degrades to prose.',
    };
  }
  return { ok: true };
}

/** The shape both evidence paths produce before synthesis. */
type OrderedFact = {
  id: string;
  content: string;
  confidence: number;
  url: string | null;
  title: string | null;
  /**
   * Provenance, where the research desk recorded it. Optional because it
   * genuinely is: credibility is populated for roughly two thirds of sources,
   * and a fact with none should read as "provenance unverified" rather than
   * forcing every caller to invent a null.
   */
  credibilityType?: string | null;
  credibilityScore?: number | null;
  fetchedAt?: string | null;
};

export function distinctHostCount(rows: Array<{ url: string | null }>): number {
  const hosts = new Set<string>();
  for (const r of rows) {
    if (!r.url) continue;
    try {
      hosts.add(new URL(r.url).host);
    } catch {
      /* a malformed URL is not a host */
    }
  }
  return hosts.size;
}

/**
 * Map cross-session search hits into the brief's fact shape.
 *
 * Exported for tests: this is where reuse either produces real evidence or
 * quietly produces junk, and the dedup is the part most likely to rot.
 * `sourceUrl` arrives already sanitised to http(s)-or-null by research-search.ts,
 * but we re-check rather than trust a neighbour module's invariant.
 */
export function mapHitsToFacts(
  hits: Array<{
    factId: string;
    passage: string;
    confidence: number;
    sourceUrl: string | null;
    sourceTitle: string | null;
    credibilityType?: string | null;
    credibilityScore?: number | null;
    fetchedAt?: string | null;
  }>,
  cap = BRIEF_FACT_CAP,
): OrderedFact[] {
  const seen = new Set<string>();
  const out: OrderedFact[] = [];
  for (const h of hits) {
    if (!h.sourceUrl || !/^https?:\/\//.test(h.sourceUrl)) continue;
    const passage = (h.passage ?? '').trim();
    if (!passage) continue;
    // Two sessions researching the same topic routinely extract the same claim
    // from the same page. Without this the brief looks well-sourced while
    // actually repeating itself, and the host-diversity check is fooled too.
    const key = `${h.sourceUrl}::${passage.slice(0, 120).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: h.factId,
      content: passage,
      confidence: h.confidence,
      url: h.sourceUrl,
      title: h.sourceTitle,
      ...(h.credibilityType ? { credibilityType: h.credibilityType } : {}),
      ...(h.credibilityScore != null ? { credibilityScore: h.credibilityScore } : {}),
      ...(h.fetchedAt ? { fetchedAt: h.fetchedAt } : {}),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** Search everything already researched. Returns [] when nothing clears the bar. */
async function factsFromExistingKnowledge(
  buildId: string,
  challenge: string,
): Promise<{ facts: OrderedFact[]; searchFailed: boolean }> {
  const { searchResearch } = await import('$lib/deepdive/research-search');
  try {
    const hits = await searchResearch(challenge, {
      topK: REUSE_TOP_K,
      minSim: REUSE_MIN_SIM,
      // Distilled facts only. Raw source chunks are unreviewed page text,
      // truncated mid-sentence, with a hardcoded confidence of 0 — fine for a
      // human reading chat, not something to render to a learner as a sourced
      // claim. Without this they would also compete for the 30-row limit.
      factsOnly: true,
    });
    return { facts: mapHitsToFacts(hits), searchFailed: false };
  } catch (err) {
    // Never silently. searchResearch embeds the query, so a missing or invalid
    // embeddings key throws here — and swallowing that turns an infrastructure
    // outage into "this topic is not covered", which is the exact misdiagnosis
    // pattern that has bitten this codebase before. Reuse stays dead until
    // someone notices, and in 'reuse' mode the error blames the corpus.
    console.error('[studio] research reuse search failed', err);
    await emitLog(
      buildId,
      'error',
      `Research: the search over existing knowledge FAILED (${(err as Error).message}). This is an infrastructure fault, not an empty corpus — check the embeddings key.`,
    ).catch(() => {});
    return { facts: [], searchFailed: true };
  }
}

/** Does this evidence clear the same bars isBriefUsable will apply later? */
export function evidenceIsSufficient(rows: OrderedFact[]): boolean {
  return rows.length >= MIN_FACTS && distinctHostCount(rows) >= MIN_SOURCES;
}

export function formatBriefForPrompt(brief: ResearchBrief): string {
  const lines: string[] = [];
  lines.push(`# Research Brief — ${brief.topic}`);
  lines.push('');
  lines.push('Every factual claim you render must trace to a FACT below. Do not invent figures, and do not smooth over the GAPS — the final chapter should state them honestly.');
  lines.push('');
  lines.push('## FACTS');
  lines.push(
    'Each fact carries what kind of source it came from and when it was fetched. WEIGH THEM. ' +
      'A government publication and a social-media post are not equivalent evidence, and a chapter ' +
      'that leans on the weaker one should say so rather than presenting both as the record. ' +
      'Where a fact has no source type, treat it as unverified provenance.',
  );
  brief.facts.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.claim}${f.detail ? ` — ${f.detail}` : ''}`);
    const marks = [
      f.sourceType ? `type: ${f.sourceType}` : null,
      f.credibility != null ? `credibility: ${f.credibility.toFixed(2)}` : null,
      f.asOf ? `as of: ${f.asOf}` : null,
    ].filter(Boolean);
    lines.push(`   source: ${f.sourceUrl}${marks.length ? ` (${marks.join(', ')})` : ''}`);
  });
  lines.push('');
  lines.push('## CONCEPTS THAT ARE GENUINELY HARD');
  brief.concepts.forEach((c) => lines.push(`- **${c.name}** — ${c.whyHard}`));
  lines.push('');
  lines.push('## CAUSAL MAP (build your levers and diagrams on this)');
  brief.causalMap.forEach((c) =>
    lines.push(
      `- ${c.from} → ${c.to}: ${c.relationship}${c.facts?.length ? ` [facts ${c.facts.join(', ')}]` : ''}`,
    ),
  );
  lines.push('');
  lines.push('## LIVE DATA AVAILABLE');
  brief.liveData.forEach((d) => lines.push(`- ${d.name} (${d.url}) — ${d.what}`));
  lines.push('');
  lines.push('## COMMON MISCONCEPTIONS (chapters should confront these)');
  brief.misconceptions.forEach((m) => lines.push(`- ${m}`));
  lines.push('');
  lines.push('## GAPS');
  brief.gaps.forEach((g) => lines.push(`- ${g}`));

  if (brief.contested?.length) {
    lines.push('');
    lines.push('## CONTESTED — CANDIDATES, NOT CONCLUSIONS');
    lines.push(
      'The corpus records these as contradicting each other. JUDGE EACH ONE. Roughly two in five ' +
        'are extraction artefacts — two statements that are merely related, or one qualifying the ' +
        'other rather than refuting it. Build a chapter on a tension ONLY where you can see the ' +
        'contradiction yourself, and say which source says what. Never render "sources disagree" ' +
        'on the strength of this list alone.',
    );
    brief.contested.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.claim}`);
      lines.push(`   against: ${c.counterClaim}`);
      lines.push(`   ${c.claimUrl ?? 'no source'}  vs  ${c.counterUrl ?? 'no source'}`);
    });
  }
  return lines.join('\n');
}

// Deliberately does NOT ask for `facts` or their sourceUrl. ResearchReport
// carries no URLs anywhere — ranked_facts and every *_fact_ids array are
// opaque fact ids (see $lib/deepdive/postprocess.ts), so a model asked to
// emit sourced facts from that JSON has only two options: fabricate a
// plausible-looking URL, or return nothing — and isBriefUsable's
// http(s)-prefix check cannot tell a fabricated URL from a real one. Real
// facts+URLs come straight from the `facts`/`sources` tables in
// buildResearchBrief below and never pass through the LLM. This prompt only
// synthesises the parts that are genuinely synthesis: concepts, the causal
// model, live data pointers, misconceptions, and gaps.
const CONVERT_PROMPT = `You are given a NUMBERED list of research facts, each with its source URL already attached. Sourcing is handled separately — do not repeat the facts back. Your job is to synthesise structure on top of them for someone building an interactive explainer.

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:

{
  "concepts": [{ "name": "...", "whyHard": "..." }],
  "causalMap": [{ "from": "...", "to": "...", "relationship": "...", "facts": [1, 4] }],
  "liveData": [{ "name": "...", "url": "https://...", "what": "..." }],
  "misconceptions": ["..."],
  "gaps": ["..."]
}

Rules:
- Ground every concept, every causal link, and every misconception in the numbered facts you were given. Do not introduce a claim, relationship, or figure the facts do not support — if it isn't traceable to one of the numbered facts, it does not belong here.
- causalMap is the model an interactive simulation will be built on. Prefer relationships with a direction and a rough magnitude, drawn only from what the facts establish.
- EVERY causal link MUST carry a "facts" array naming the numbered facts it rests on. A link you cannot cite is a link you invented, and it will be dropped before the brief is used — silently weakening the model the levers are built on. Cite the fact numbers as given, not the source URLs.
- liveData should point to real datasets or APIs the facts actually mention, not invented ones.
- gaps are what the numbered facts do NOT establish, not general knowledge a search engine might find. Do not leave this empty to look thorough; an empty gaps list on a complex topic is itself a warning sign.
- Aim for 3-5 concepts, 4-8 causal relationships.`;

/**
 * Find where the corpus contradicts the facts we selected.
 *
 * `searchResearch` filters counterfactuals out entirely (`AND NOT
 * f.is_counterfactual`), which is right for retrieval — a refutation is not a
 * fact to cite — and means they can never reach a brief by the normal route.
 * The IBCA build had 31 in its own session and saw none of them.
 *
 * So ask directly: of the facts we chose, which ones does something else in
 * the corpus refute? Bounded, and never fatal — a brief without this section
 * is a brief, whereas a research stage that dies looking for one is not.
 *
 * `inArray`, not a hand-built `= ANY(...)`: this repo has a scar from a Drizzle
 * array binding that compiled to a row constructor and broke silently at two
 * or more elements.
 */
export async function contestedPairs(
  selected: OrderedFact[],
  cap = 8,
): Promise<ResearchBrief['contested']> {
  const ids = selected.map((f) => f.id).filter(Boolean);
  if (ids.length === 0) return [];
  const byId = new Map(selected.map((f) => [f.id, f]));
  try {
    const rows = await db
      .select({
        refutes: facts.refutesFactId,
        counterClaim: facts.content,
        counterUrl: sources.url,
      })
      .from(facts)
      .leftJoin(sources, eq(sources.id, facts.sourceId))
      .where(inArray(facts.refutesFactId, ids))
      .limit(cap);

    const out: ResearchBrief['contested'] = [];
    for (const r of rows) {
      const original = r.refutes ? byId.get(r.refutes) : undefined;
      if (!original || !r.counterClaim) continue;
      out.push({
        claim: original.content,
        counterClaim: r.counterClaim,
        claimUrl: original.url,
        counterUrl: r.counterUrl ?? null,
      });
    }
    return out;
  } catch (err) {
    // A missing contested section costs nuance. A research stage that throws
    // looking for one costs the build.
    console.error('[studio] contested-pair lookup failed', err);
    return [];
  }
}

/**
 * Drop causal links the model could not cite.
 *
 * causalMap is what the interactive levers are built on, so an invented link
 * becomes an invented mechanism the reader operates — the most consequential
 * place in the whole brief for a fabrication to land. Every link must name the
 * numbered facts it rests on, and a citation that points outside the fact list
 * is treated as no citation at all.
 *
 * Deliberately not derived from the intel graph, which was the obvious
 * alternative: `relationship` holds `employs`, `part_of`, `located_in` — who
 * relates to whom, not what drives what — and would ground the levers in an
 * org chart. Synthesis is the right shape; this makes it checkable.
 */
export function groundCausalMap(
  links: Array<{ from?: unknown; to?: unknown; relationship?: unknown; facts?: unknown }>,
  factCount: number,
): Array<{ from: string; to: string; relationship: string; facts: number[] }> {
  const out: Array<{ from: string; to: string; relationship: string; facts: number[] }> = [];
  for (const l of links) {
    const from = typeof l.from === 'string' ? l.from.trim() : '';
    const to = typeof l.to === 'string' ? l.to.trim() : '';
    const relationship = typeof l.relationship === 'string' ? l.relationship.trim() : '';
    if (!from || !to || !relationship) continue;
    // 1-based, matching the numbering the model was shown.
    const cited = (Array.isArray(l.facts) ? l.facts : [])
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= factCount);
    if (cited.length === 0) continue;
    out.push({ from, to, relationship, facts: [...new Set(cited)] });
  }
  return out;
}

/**
 * Run the research stage. Polls the Deep Dive session for up to 20 minutes.
 * Throws on timeout or an unusable brief — the caller marks the build failed
 * with the reason, which is far better than an ungrounded explainer.
 */
/**
 * Get a studio build its evidence, by whichever route the mode allows.
 *
 * The expensive path (a fresh Deep Dive) is unchanged; what is new is that it is
 * no longer the only one. On 2026-08-10 the corpus already held 4,088 embedded
 * facts across 19 sessions from 975 distinct URLs, and the first studio build
 * still spent 20 minutes re-researching a topic a prior session had covered with
 * 361 facts from 24 hosts.
 */
export async function buildResearchBrief(
  buildId: string,
  challenge: string,
  mode: ResearchMode = 'extend',
): Promise<ResearchBrief> {
  let seedFacts: OrderedFact[] = [];

  if (mode !== 'fresh') {
    const { facts: known, searchFailed } = await factsFromExistingKnowledge(buildId, challenge);
    if (evidenceIsSufficient(known)) {
      await emitLog(
        buildId,
        'system',
        `Research: reusing existing knowledge — ${known.length} facts from ${distinctHostCount(known)} sources already in the corpus. No new research session needed.`,
      );
      return synthesiseBrief(buildId, challenge, known, null);
    }
    if (mode === 'reuse') {
      throw new Error(
        searchFailed
          ? `Research stage: mode 'reuse' could not search existing knowledge — the search itself failed, so this says nothing about what the corpus holds. Check the embeddings key, then retry.`
          : `Research stage: mode 'reuse' found only ${known.length} usable facts from ${distinctHostCount(known)} sources in existing research (need ${MIN_FACTS} from ${MIN_SOURCES}). Re-run with mode 'extend' to research the gaps.`,
      );
    }
    // extend: not enough on its own, but not nothing — carry it into the new
    // session so the researcher works the gaps instead of re-treading ground.
    seedFacts = known;
    await emitLog(
      buildId,
      'system',
      `Research: existing knowledge covers ${seedFacts.length} facts from ${distinctHostCount(seedFacts)} sources — short of the ${MIN_FACTS}/${MIN_SOURCES} bar, so starting a seeded research session to fill the gaps.`,
    );
  }

  const { startResearch } = await import('$lib/deepdive/worker');
  const [session] = await db
    .insert(researchSessions)
    .values({
      topic: challenge.slice(0, 500),
      goals: [
        'Identify the mechanisms that drive the outcome, with direction and magnitude',
        'Find public datasets or APIs a reader could explore',
        'Identify what people commonly get wrong about this',
      ],
      // phase1.ts folds this into the researcher's system prompt — same
      // mechanism research_branch uses. parentSessionId stays null on purpose:
      // reuse hits span several sessions, and that column means one parent.
      ...(seedFacts.length
        ? {
            seedContext: {
              type: 'fact' as const,
              // phase1.ts renders this as "a follow-up investigation from a
              // parent research session on X", so say what the follow-up is
              // FOR rather than repeating the topic back at itself.
              parentTopic: `${challenge.slice(0, 400)} — partially covered by earlier research`,
              parentGoals: [],
              // phase1.ts slices this to 5; sending more just sits unread.
              factContents: seedFacts.slice(0, 5).map((f) => f.content),
              // phase1.ts DOES read gapDescription and suggestedQueries. Without
              // them a seeded session is just a fresh one with five facts of
              // background — it would re-tread the ground we already have.
              gapDescription: `Existing research already establishes the ${seedFacts.length} facts above. Do not re-establish them — find what they do not cover: the mechanisms linking cause to effect, quantities and magnitudes, and public datasets a reader could explore.`,
              suggestedQueries: [
                `${challenge.slice(0, 120)} mechanism`,
                `${challenge.slice(0, 120)} data`,
                `${challenge.slice(0, 120)} criticism OR limitations`,
              ],
            },
          }
        : {}),
    })
    .returning();

  await emitLog(
    buildId,
    'system',
    `Research stage started (session ${session.id})${seedFacts.length ? `, seeded with ${seedFacts.length} known facts` : ''} — this runs before planning.`,
  );
  void startResearch(session.id);

  const deadline = Date.now() + RESEARCH_DEADLINE_MS;
  let report: ResearchReport | null = null;
  let sessionFailed = false;
  let lastProgressAt = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20_000));
    const [row] = await db.select().from(researchSessions).where(eq(researchSessions.id, session.id));
    if (row?.report) { report = row.report as ResearchReport; break; }
    if (row?.status === 'failed') { sessionFailed = true; break; }

    // Liveness. Nothing else writes heartbeat_at or updated_at during research,
    // and reapStaleBuilds abandons any running build quiet for STALE_BUILD_MS
    // (30 min). Research routinely runs longer than that.
    await db
      .update(jkaiBuilds)
      .set({ heartbeatAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId))
      .catch(() => {});

    if (Date.now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = Date.now();
      const [factCount, sourceCount] = await Promise.all([
        db.$count(facts, eq(facts.sessionId, session.id)).catch(() => 0),
        db.$count(sources, eq(sources.sessionId, session.id)).catch(() => 0),
      ]);
      const mins = Math.round((Date.now() - (deadline - RESEARCH_DEADLINE_MS)) / 60_000);
      await emitLog(
        buildId,
        'system',
        `Research: ${row?.status ?? 'starting'} — ${factCount} facts from ${sourceCount} sources, ${mins}m elapsed of ${RESEARCH_DEADLINE_MS / 60_000}m. Watch it at /deepdive/${session.id}`,
      );
    }
  }
  if (!report) {
    if (sessionFailed) {
      throw new Error(
        `Research stage: the deep-dive session failed before producing a report (session ${session.id}). Check its logs.`,
      );
    }
    throw new Error(
      `Research stage produced no report within ${RESEARCH_DEADLINE_MS / 60_000} minutes (session ${session.id}). ` +
        `The session may still be running — see /deepdive/${session.id}.`,
    );
  }

  const factRows = await db
    .select({
      id: facts.id,
      content: facts.content,
      confidence: facts.confidence,
      url: sources.url,
      title: sources.title,
    })
    .from(facts)
    .innerJoin(sources, eq(facts.sourceId, sources.id))
    .where(
      and(
        eq(facts.sessionId, session.id),
        // A refuted or discarded claim must never reach a published explainer
        // as sourced truth — the worst failure mode this feature has.
        eq(facts.isCounterfactual, false),
        ne(facts.deskState, 'archived'),
      ),
    );

  // report.ranked_facts is the session's ranked order (best first); anything it
  // doesn't cover falls back to descending confidence and goes last.
  const rankIndex = new Map(report.ranked_facts.map((id, i) => [id, i]));
  const ranked = factRows
    .filter((f) => rankIndex.has(f.id))
    .sort((a, b) => rankIndex.get(a.id)! - rankIndex.get(b.id)!);
  const unranked = factRows
    .filter((f) => !rankIndex.has(f.id))
    .sort((a, b) => b.confidence - a.confidence);
  const orderedFacts = [...ranked, ...unranked].slice(0, BRIEF_FACT_CAP);

  if (orderedFacts.length < MIN_FACTS) {
    throw new Error(
      `Research stage: the research session produced too few sourced facts (${orderedFacts.length}, need ${MIN_FACTS}) — session ${session.id}.`,
    );
  }

  return synthesiseBrief(buildId, challenge, orderedFacts, session.id);
}

/**
 * Turn a fact set into a full brief. Shared by both evidence paths — reuse and a
 * fresh Deep Dive differ ONLY in where `orderedFacts` came from. The facts and
 * their URLs never pass through the model; it synthesises structure on top.
 */
async function synthesiseBrief(
  buildId: string,
  challenge: string,
  orderedFacts: OrderedFact[],
  sessionId: string | null,
): Promise<ResearchBrief> {
  const briefFacts: BriefFact[] = orderedFacts.map((f) => ({
    claim: f.content,
    sourceUrl: f.url as string,
    ...(f.title ? { detail: f.title, sourceTitle: f.title } : {}),
    ...(f.credibilityType ? { sourceType: f.credibilityType } : {}),
    ...(f.credibilityScore != null ? { credibility: f.credibilityScore } : {}),
    ...(f.fetchedAt ? { asOf: f.fetchedAt } : {}),
  }));
  const factsForPrompt = orderedFacts
    .map((f, i) => `${i + 1}. ${f.content}\n   source: ${f.url}`)
    .join('\n');

  // getLLMClient is async and takes a full ModelContext ({ provider, modelId }),
  // returning { client, model } — NOT a bare client keyed by a model id string.
  // resolveNotebookModel() already returns a coerced ModelContext (see
  // $lib/deepdive/ai.ts's getPrimary(), which does exactly this), so it is
  // passed straight through rather than picking modelId back out of it.
  const ctx = await resolveNotebookModel();
  const { client, model } = await getLLMClient(ctx);
  const completion = await withActivity('notebook', () =>
    client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: CONVERT_PROMPT },
        { role: 'user', content: `Topic: ${challenge}\n\nFACTS:\n${factsForPrompt}`.slice(0, 120_000) },
      ],
      temperature: 0.3,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    }),
  );
  // Record spend against the build, not just this ad-hoc research session.
  // maxCostUsd (see studio.ts's STUDIO_BUDGET) is the hard backstop on a
  // studio build's total spend — same recordBuildUsage/parseUsage pairing
  // planner.ts's streamPlannerCall uses for its own LLM calls. Unlike that
  // streaming call, this one is a plain (non-streamed) completion, so
  // completion.usage already carries real prompt_tokens/completion_tokens
  // rather than only a total.
  if (completion.usage) {
    const [buildRow] = await db
      .select({ priceSnapshot: jkaiBuilds.priceSnapshot })
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, buildId));
    const priceSnapshot = (buildRow?.priceSnapshot ?? null) as PriceSnapshot | null;
    await recordBuildUsage(buildId, parseUsage(completion.usage), priceSnapshot);
  }
  const raw = completion.choices?.[0]?.message?.content ?? '{}';
  const jsonStart = raw.indexOf('{');
  let parsed: Partial<ResearchBrief> = {};
  try {
    parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart, raw.lastIndexOf('}') + 1) : raw);
  } catch {
    throw new Error('Research stage: the brief conversion returned unparseable JSON.');
  }

  const proposedLinks = parsed.causalMap ?? [];
  const groundedLinks = groundCausalMap(proposedLinks, briefFacts.length);
  if (proposedLinks.length > 0 && groundedLinks.length < proposedLinks.length) {
    // Say it out loud. A silently shrinking causal map is a silently weakening
    // set of levers, and if the model stops citing altogether the build fails
    // on "no causal map" with no hint of why.
    await emitLog(
      buildId,
      groundedLinks.length === 0 ? 'error' : 'system',
      `Research: dropped ${proposedLinks.length - groundedLinks.length} of ${proposedLinks.length} causal link(s) ` +
        `that cited no fact in range. ${
          groundedLinks.length === 0
            ? 'None survived, so this brief has no model for the levers to stand on — the synthesis ignored the citation requirement.'
            : `${groundedLinks.length} remain.`
        }`,
    );
  }

  const brief: ResearchBrief = {
    topic: challenge.slice(0, 500),
    facts: briefFacts,
    concepts: parsed.concepts ?? [],
    causalMap: groundedLinks,
    liveData: parsed.liveData ?? [],
    misconceptions: parsed.misconceptions ?? [],
    gaps: parsed.gaps ?? [],
    contested: await contestedPairs(orderedFacts),
    sessionId,
  };

  const usable = isBriefUsable(brief);
  if (!usable.ok) {
    // Say what the research actually FOUND before throwing it away.
    //
    // The gate runs at the very end of the stage, so by the time it rejects,
    // a full deep-dive has already run — tens of minutes and real spend — and
    // the brief is about to be discarded unstored (orchestrator.ts aborts the
    // build without writing `research_brief`). Until this log existed the only
    // surviving trace was the one-line reason, which says a count and not a
    // topic: "only 2 distinct sources across 15 facts" gives no way to tell a
    // topic with no public material from a search that went sideways.
    //
    // That distinction is the whole diagnosis. The 2026-09-03 rejection was an
    // explainer about this site's own daydream feature — a subject the public
    // web genuinely does not cover, where no amount of re-running helps and the
    // answer is to change the topic or the evidence source. Seeing the two
    // source URLs says that immediately.
    const sources = [...new Set(brief.facts.map((f) => f.sourceUrl).filter(Boolean))];
    await emitLog(
      buildId,
      'error',
      `Research brief REJECTED — ${usable.reason}\n` +
        `What the stage found: ${brief.facts.length} sourced fact(s) across ${sources.length} ` +
        `distinct source(s), ${brief.causalMap.length} causal link(s), ${brief.gaps.length} gap(s).` +
        (sources.length
          ? `\nSources: ${sources.slice(0, 10).join(', ')}${sources.length > 10 ? ` (+${sources.length - 10} more)` : ''}`
          : '\nSources: none — the research produced no usable citation at all.') +
        `\nThe brief is discarded, so a retry re-runs the whole stage. If the sources above are ` +
        `thin because the topic is internal or very recent, changing the topic will help and ` +
        `re-running will not.`,
    );
    throw new Error(`Research stage: ${usable.reason}`);
  }

  await emitLog(
    buildId,
    'system',
    `Research brief ready — ${brief.facts.length} sourced facts, ${brief.causalMap.length} causal links, ${brief.gaps.length} gaps.`,
  );
  return brief;
}
