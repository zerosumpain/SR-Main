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
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { emitLog } from './log-emitter';
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

const CONVERT_PROMPT = `You are converting a research report into a structured brief for someone building an interactive explainer.

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:

{
  "facts": [{ "claim": "...", "sourceUrl": "https://...", "detail": "..." }],
  "concepts": [{ "name": "...", "whyHard": "..." }],
  "causalMap": [{ "from": "...", "to": "...", "relationship": "..." }],
  "liveData": [{ "name": "...", "url": "https://...", "what": "..." }],
  "misconceptions": ["..."],
  "gaps": ["..."]
}

Rules:
- A fact with no source URL in the report must be OMITTED, not invented. Fewer honest facts beats more confident ones.
- causalMap is the model an interactive simulation will be built on. Prefer relationships with a direction and a rough magnitude.
- gaps are what the report could NOT establish. Do not leave this empty to look thorough; an empty gaps list on a complex topic is itself a warning sign.
- Aim for 10-15 facts, 3-5 concepts, 4-8 causal relationships.`;

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

  const deadline = Date.now() + 20 * 60 * 1000;
  let report: ResearchReport | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20_000));
    const [row] = await db.select().from(researchSessions).where(eq(researchSessions.id, session.id));
    if (row?.report) { report = row.report as ResearchReport; break; }
    if (row?.status === 'failed') break;
  }
  if (!report) {
    throw new Error(`Research stage produced no report within 20 minutes (session ${session.id}).`);
  }

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
      { role: 'user', content: JSON.stringify(report).slice(0, 120_000) },
    ],
    temperature: 0.3,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
  });
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
    facts: (parsed.facts ?? []).filter((f) => f && f.claim && f.sourceUrl),
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
