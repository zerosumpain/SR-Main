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
import { eq, and, ne } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { emitLog } from './log-emitter';
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
import type { ResearchReport } from '$lib/deepdive/types';

export interface BriefFact {
  claim: string;
  sourceUrl: string;
  detail?: string;
}

export interface ResearchBrief {
  topic: string;
  facts: BriefFact[];
  concepts: Array<{ name: string; whyHard: string }>;
  causalMap: Array<{ from: string; to: string; relationship: string }>;
  liveData: Array<{ name: string; url: string; what: string }>;
  misconceptions: string[];
  gaps: string[];
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
  const MIN_SOURCES = 3;
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

export function formatBriefForPrompt(brief: ResearchBrief): string {
  const lines: string[] = [];
  lines.push(`# Research Brief — ${brief.topic}`);
  lines.push('');
  lines.push('Every factual claim you render must trace to a FACT below. Do not invent figures, and do not smooth over the GAPS — the final chapter should state them honestly.');
  lines.push('');
  lines.push('## FACTS');
  brief.facts.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.claim}${f.detail ? ` — ${f.detail}` : ''}`);
    lines.push(`   source: ${f.sourceUrl}`);
  });
  lines.push('');
  lines.push('## CONCEPTS THAT ARE GENUINELY HARD');
  brief.concepts.forEach((c) => lines.push(`- **${c.name}** — ${c.whyHard}`));
  lines.push('');
  lines.push('## CAUSAL MAP (build your levers and diagrams on this)');
  brief.causalMap.forEach((c) => lines.push(`- ${c.from} → ${c.to}: ${c.relationship}`));
  lines.push('');
  lines.push('## LIVE DATA AVAILABLE');
  brief.liveData.forEach((d) => lines.push(`- ${d.name} (${d.url}) — ${d.what}`));
  lines.push('');
  lines.push('## COMMON MISCONCEPTIONS (chapters should confront these)');
  brief.misconceptions.forEach((m) => lines.push(`- ${m}`));
  lines.push('');
  lines.push('## GAPS');
  brief.gaps.forEach((g) => lines.push(`- ${g}`));
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
  "causalMap": [{ "from": "...", "to": "...", "relationship": "..." }],
  "liveData": [{ "name": "...", "url": "https://...", "what": "..." }],
  "misconceptions": ["..."],
  "gaps": ["..."]
}

Rules:
- Ground every concept, every causal link, and every misconception in the numbered facts you were given. Do not introduce a claim, relationship, or figure the facts do not support — if it isn't traceable to one of the numbered facts, it does not belong here.
- causalMap is the model an interactive simulation will be built on. Prefer relationships with a direction and a rough magnitude, drawn only from what the facts establish.
- liveData should point to real datasets or APIs the facts actually mention, not invented ones.
- gaps are what the numbered facts do NOT establish, not general knowledge a search engine might find. Do not leave this empty to look thorough; an empty gaps list on a complex topic is itself a warning sign.
- Aim for 3-5 concepts, 4-8 causal relationships.`;

/**
 * Run the research stage. Polls the Deep Dive session for up to 20 minutes.
 * Throws on timeout or an unusable brief — the caller marks the build failed
 * with the reason, which is far better than an ungrounded explainer.
 */
export async function buildResearchBrief(buildId: string, challenge: string): Promise<ResearchBrief> {
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
    })
    .returning();

  await emitLog(buildId, 'system', `Research stage started (session ${session.id}) — this runs before planning.`);
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
    // and reapStaleBuilds kills any running build whose `heartbeatAt ?? updatedAt`
    // is older than STALE_BUILD_MS (30 min). Research routinely runs longer than
    // that, so without this ping the reaper — or a sidecar restart, which clears
    // the `activeBuildId === b.id` escape hatch — would abandon a healthy build
    // mid-research. Ping every poll; it is one cheap UPDATE per 20s.
    await db
      .update(jkaiBuilds)
      .set({ heartbeatAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId))
      .catch(() => {});

    // Visible progress. The build log was previously silent for the whole
    // research stage, so a perfectly healthy build looked hung — which is
    // exactly what happened on the first real studio run.
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
    // A worker crash and a genuine stall are different operator problems — one
    // means "read the deep-dive logs", the other means "this topic may be too
    // obscure or the model too slow". Distinct messages so the build failure
    // reason actually points somewhere useful.
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

  // The facts (and their sourceUrl) come DIRECTLY from the facts/sources
  // tables, never from the LLM. ResearchReport carries no URLs anywhere —
  // ranked_facts and every *_fact_ids array are opaque fact ids, not fact
  // text (see $lib/deepdive/postprocess.ts) — so asking the model to emit
  // `sourceUrl` per fact from the serialised report gave it no real URLs to
  // draw on, and every one it returned was invented. isBriefUsable's
  // http(s)-prefix check could not tell a fabricated URL from a real one.
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
        // A refuted claim or one the researcher discarded must never reach a
        // published explainer as sourced truth — the worst failure mode this
        // feature has. isCounterfactual=false is the same filter every other
        // reader of this table applies (see postprocess.ts, credibility.ts,
        // synthesis-scope.ts); deskState='archived' is Research Desk's own
        // "discarded" state and has no equivalent precedent elsewhere, but the
        // semantics are the same — a fact the researcher filed away as wrong
        // or unwanted, not raw material a syllabus should cite.
        eq(facts.isCounterfactual, false),
        ne(facts.deskState, 'archived'),
      ),
    );

  // report.ranked_facts is the session's ranked order (best first); anything
  // it doesn't cover falls back to descending confidence and goes last.
  const rankIndex = new Map(report.ranked_facts.map((id, i) => [id, i]));
  const ranked = factRows
    .filter((f) => rankIndex.has(f.id))
    .sort((a, b) => rankIndex.get(a.id)! - rankIndex.get(b.id)!);
  const unranked = factRows
    .filter((f) => !rankIndex.has(f.id))
    .sort((a, b) => b.confidence - a.confidence);
  const orderedFacts = [...ranked, ...unranked].slice(0, 15);

  if (orderedFacts.length < MIN_FACTS) {
    throw new Error(
      `Research stage: the research session produced too few sourced facts (${orderedFacts.length}, need ${MIN_FACTS}) — session ${session.id}.`,
    );
  }

  const briefFacts: BriefFact[] = orderedFacts.map((f) => ({
    claim: f.content,
    sourceUrl: f.url,
    ...(f.title ? { detail: f.title } : {}),
  }));

  const factsForPrompt = orderedFacts
    .map((f, i) => `${i + 1}. ${f.content}\n   source: ${f.url}`)
    .join('\n');

  // getLLMClient is async and takes a full ModelContext ({ provider, modelId }),
  // returning { client, model } — NOT a bare client keyed by a model id string.
  // resolveDefaultModel() already returns a coerced ModelContext (see
  // $lib/deepdive/ai.ts's getPrimary(), which does exactly this), so it is
  // passed straight through rather than picking modelId back out of it.
  const ctx = await resolveDefaultModel();
  const { client, model } = await getLLMClient(ctx);
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: CONVERT_PROMPT },
      { role: 'user', content: `Topic: ${challenge}\n\nFACTS:\n${factsForPrompt}`.slice(0, 120_000) },
    ],
    temperature: 0.3,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
  });
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

  const brief: ResearchBrief = {
    topic: challenge.slice(0, 500),
    facts: briefFacts,
    concepts: parsed.concepts ?? [],
    causalMap: parsed.causalMap ?? [],
    liveData: parsed.liveData ?? [],
    misconceptions: parsed.misconceptions ?? [],
    gaps: parsed.gaps ?? [],
    sessionId: session.id,
  };

  const usable = isBriefUsable(brief);
  if (!usable.ok) throw new Error(`Research stage: ${usable.reason}`);

  await emitLog(
    buildId,
    'system',
    `Research brief ready — ${brief.facts.length} sourced facts, ${brief.causalMap.length} causal links, ${brief.gaps.length} gaps.`,
  );
  return brief;
}
