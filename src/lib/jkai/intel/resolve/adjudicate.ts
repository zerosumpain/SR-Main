import { loadEvidenceVersions, pairEvidenceVersion } from './evidence-version.server';
// Research-assisted adjudication: read the evidence, then decide.
//
// Every signal the resolver had was a comparison of strings, an equality of
// email addresses or a cosine between two vectors. None of them read what the
// notes actually SAY. That is fine for the top of the range — an identical name
// with a shared address needs no interpretation — and it is why the middle of
// the range never clears: "Data Standards Board" and "Data Standards Authority"
// score 0.55 on words alone and no amount of arithmetic can settle them, while
// the two notes they came from say plainly that one replaced the other.
//
// So the band between the review floor and the auto-merge line gets a reader.
// It is handed a dossier — names, aliases, types, summaries, addresses, shared
// neighbours and the actual sentences each entity was extracted from — and asked
// one question with three permitted answers.
//
// Two rules it is built around:
//
//   1. It NEVER merges. A verdict is a decision row; merging remains the job of
//      the existing threshold and its chain guard and its blast-radius cap.
//   2. `unsure` is a first-class answer. A forced binary would turn "the notes
//      do not say" into a coin flip recorded as a fact.
import type { OpenAI } from 'openai';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { pgTextArray } from '$lib/db/sql-array';
import { getLLMClient } from '$lib/llm/client';
import { resolveResolutionModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import type { ResolvableEntity } from './match';
import { recordDecision, type Verdict } from './decisions';

/** Excerpts shown per entity. Three is enough to characterise; thirty is a bill. */
const EXCERPTS_PER_ENTITY = 3;
const EXCERPT_CHARS = 320;
/** Shared neighbours named in the prompt. */
const NEIGHBOURS_SHOWN = 8;

export interface PairEvidence {
  /** The entity this excerpt is evidence FOR, or 'both' for a co-mention. */
  noteId?: string;
  entityId: string;
  noteTitle: string | null;
  noteSource: string;
  excerpt: string;
}

/** The marker `describe` and the prompt use for a note naming both entities. */
export const CO_MENTION = 'both';

export interface AdjudicationInput {
  a: ResolvableEntity;
  b: ResolvableEntity;
  evidence: PairEvidence[];
  sharedNeighbours: string[];
  /** The matcher's own score and reasoning, so the reader can disagree with it. */
  confidence: number;
  reason: string;
}

export interface Adjudication {
  verdict: Verdict;
  citations?: string[];
  /** 0..1 — how sure the reader is of ITS answer, not the matcher's score. */
  confidence: number;
  rationale: string;
  model: string;
}

const SYSTEM_PROMPT = `You are an entity-resolution adjudicator for a personal knowledge graph.

You are given two nodes that an automated matcher thinks MIGHT be the same real-world thing, together with the evidence each was extracted from. Decide whether they are one thing or two.

Answer with JSON only:
{"verdict":"same"|"different"|"unsure","confidence":0.0-1.0,"rationale":"one sentence", "citations":["exact supporting quote copied from evidence"]}

How to decide:
- "same" — the evidence shows one real-world thing recorded twice: an abbreviation and its expansion, a rename, a person under two display names, the same document under two filenames.
- "different" — the evidence shows two things that merely resemble each other: a parent body and one of its committees, a programme and the team that runs it, two people who share a surname, a system and the standard it implements.
- "unsure" — the evidence does not settle it. This is the correct answer far more often than either of the others. Use it whenever you would be guessing.

Rules:
- A replacement or successor is not automatically a rename. Require an explicit statement of continuity for "same".
- Supply at least one exact supporting quote for any same or different verdict. Never cite the matcher score as evidence.
- Judge from the evidence given. Do not invent facts about the world to break a tie; if outside knowledge is doing the work, that is "unsure".
- Similar names are not evidence of sameness. Organisations deliberately name their subsidiaries after themselves.
- A source naming BOTH is the most decisive thing you have, and usually says they are DIFFERENT — a sentence introducing two names is introducing two things. The exception is a source that states the equivalence outright ("the Authority, formerly the Body"), which is "same".
- Conflicting email addresses mean "different" unless the evidence explicitly says one person holds both.
- The rationale is one sentence, points at the evidence, and never restates the names.`;

/** Names for a set of entity ids. Empty in, empty out — no query. */
export async function loadEntityNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const res = await db.execute(sql`
    SELECT id, name FROM intel_entities WHERE id = ANY(${pgTextArray(ids)}::text[])
  `);
  return new Map(
    (res.rows as Array<Record<string, unknown>>).map((r) => [String(r.id), String(r.name ?? '')]),
  );
}

/** Assemble what the reader is given. One query, both entities. */
export async function loadPairEvidence(aId: string, bId: string): Promise<PairEvidence[]> {
  const res = await db.execute(sql`
    SELECT n.id AS note_id, ne.entity_id, n.title, n.source, ne.excerpt
    FROM intel_note_entities ne
    JOIN intel_notes n ON n.id = ne.note_id
    WHERE ne.entity_id IN (${aId}, ${bId})
      AND n.graph_state = 'admitted'
      AND ne.excerpt IS NOT NULL
      AND length(ne.excerpt) > 0
    ORDER BY n.created_at DESC
  `);

  const perEntity = new Map<string, number>();
  const out: PairEvidence[] = [];
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const entityId = String(row.entity_id ?? '');
    const used = perEntity.get(entityId) ?? 0;
    if (used >= EXCERPTS_PER_ENTITY) continue;
    perEntity.set(entityId, used + 1);
    out.push({
      noteId: String(row.note_id),
      entityId,
      noteTitle: typeof row.title === 'string' ? row.title : null,
      noteSource: String(row.source ?? 'unknown'),
      excerpt: String(row.excerpt ?? '').slice(0, EXCERPT_CHARS),
    });
  }
  return out;
}

/**
 * Notes that name BOTH entities.
 *
 * The single most decisive thing in the dossier, and the rules cannot see it at
 * all. A source that mentions two names in the same breath is usually saying
 * they are different — you do not introduce a thing alongside itself — and
 * occasionally saying the opposite in as many words ("the Authority, formerly
 * the Body"). Either way it settles the question, and either way it was sitting
 * in the corpus unread.
 */
export async function loadCoMentions(aId: string, bId: string, limit = 2): Promise<PairEvidence[]> {
  const res = await db.execute(sql`
    SELECT n.id AS note_id, n.title, n.source,
           COALESCE(a.excerpt, b.excerpt) AS excerpt
    FROM intel_note_entities a
    JOIN intel_note_entities b ON b.note_id = a.note_id AND b.entity_id = ${bId}
    JOIN intel_notes n ON n.id = a.note_id
    WHERE a.entity_id = ${aId}
      AND n.graph_state = 'admitted'
      AND COALESCE(a.excerpt, b.excerpt) IS NOT NULL
    ORDER BY n.created_at DESC
    LIMIT ${limit}
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    entityId: CO_MENTION,
    noteId: String(r.note_id),
    noteTitle: typeof r.title === 'string' ? r.title : null,
    noteSource: String(r.source ?? 'unknown'),
    excerpt: String(r.excerpt ?? '').slice(0, EXCERPT_CHARS),
  }));
}

function describe(e: ResolvableEntity, evidence: PairEvidence[], label: string): string {
  const aliases = (e.aliases ?? []).filter(Boolean).slice(0, 8);
  const email = typeof e.properties?.email === 'string' ? e.properties.email : null;
  const lines = [
    `${label}: "${e.name}"`,
    `  type: ${e.typeName}`,
    aliases.length ? `  also called: ${aliases.join(', ')}` : null,
    email ? `  email: ${email}` : null,
    e.summary ? `  summary: ${e.summary.slice(0, 400)}` : null,
    `  connections: ${e.degree}, sources: ${e.noteCount}`,
  ].filter(Boolean);

  const mine = evidence.filter((x) => x.entityId === e.id);
  if (mine.length) {
    lines.push('  evidence:');
    for (const x of mine) {
      lines.push(`    - [${x.noteSource}${x.noteTitle ? ` · ${x.noteTitle}` : ''}] ${x.excerpt}`);
    }
  } else {
    lines.push('  evidence: none recorded');
  }
  return lines.join('\n');
}

export function buildAdjudicationPrompt(input: AdjudicationInput): string {
  const { a, b, evidence, sharedNeighbours } = input;
  const shared = evidence.filter((x) => x.entityId === CO_MENTION);
  return [
    describe(a, evidence, 'A'),
    '',
    describe(b, evidence, 'B'),
    '',
    ...(shared.length
      ? [
          'Sources naming BOTH:',
          ...shared.map((x) => `  - [${x.noteSource}${x.noteTitle ? ` · ${x.noteTitle}` : ''}] ${x.excerpt}`),
          '',
        ]
      : []),
    sharedNeighbours.length
      ? `Both are connected to: ${sharedNeighbours.slice(0, NEIGHBOURS_SHOWN).join(', ')}`
      : 'They share no connections in the graph.',
    '',
    'Use the source evidence to decide identity independently.',
    '',
    'Are A and B the same real-world thing?',
  ].join('\n');
}

/**
 * Parse the verdict, refusing anything that is not one of the three answers.
 *
 * A model that returns prose, or a fourth verdict of its own invention, must
 * produce NO decision rather than a default one — a defaulted "different" would
 * bury a real duplicate and a defaulted "same" would propose a bad merge, and
 * both would be recorded as though something had actually been decided.
 */
export function parseAdjudication(raw: string): Omit<Adjudication, 'model'> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const verdict = String(obj.verdict ?? '').toLowerCase();
  if (verdict !== 'same' && verdict !== 'different' && verdict !== 'unsure') return null;
  const confidence = Number(obj.confidence);
  return {
    verdict,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    rationale: String(obj.rationale ?? '').slice(0, 400),
  };
}

/** Ask the reader about one pair. Returns null when it declined to answer. */
export async function adjudicatePair(input: AdjudicationInput): Promise<Adjudication | null> {
  const modelCtx = await resolveResolutionModel();
  const { client, model } = await getLLMClient(modelCtx);

  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature: 0,
    // 3000, not the few hundred the answer needs.
    //
    // GLM — the site default — spends reasoning tokens out of this same budget
    // before it emits a character, routinely 700–1500 of them. At a tight cap
    // the reply comes back EMPTY with finish_reason "length", which here would
    // read as "the model declined to answer" and quietly skip the pair. Keeping
    // reasoning on is the point of this call, so the budget has to allow for it.
    // (Verified elsewhere in the codebase: 220 → empty, 800 → truncated JSON,
    // 3000 → works.) It is a ceiling, not a spend.
    max_tokens: 3000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildAdjudicationPrompt(input) },
    ],
  };

  // Tagged so the spend lands in its own bucket rather than the anonymous
  // gateway one — this is the first thing in intel that costs money per PAIR,
  // and a cost per pair on a 4,500-entity graph needs to be visible.
  const response = await withActivity('resolution', () => client.chat.completions.create(body));
  const parsed = parseAdjudication(response.choices[0]?.message?.content ?? '');
  if (!parsed) {
    // Both numbers, because they diagnose different faults: finish=length with
    // most of the budget spent on reasoning is the token cap, and finish=stop
    // with a full answer is a model that ignored the response format.
    const usage = response.usage as { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
    console.warn(
      `[intel:adjudicate] unusable verdict for ${input.a.name} / ${input.b.name} — ` +
        `finish=${response.choices[0]?.finish_reason} ` +
        `completion=${usage?.completion_tokens ?? '?'} ` +
        `reasoning=${usage?.completion_tokens_details?.reasoning_tokens ?? '?'}`,
    );
    return null;
  }
  const raw = response.choices[0]?.message?.content ?? '';
  let quotes: string[] = [];
  try { const value = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    quotes = Array.isArray(value.citations) ? value.citations.filter((q: unknown): q is string => typeof q === 'string' && q.length >= 12 && input.evidence.some(e => e.excerpt.includes(q))) : [];
  } catch { /* An ungrounded verdict must abstain. */ }
  return { ...parsed, verdict: parsed.verdict !== 'unsure' && !quotes.length ? 'unsure' : parsed.verdict, citations: quotes, model };
}

export interface AdjudicationRun {
  considered: number;
  decided: number;
  same: number;
  different: number;
  unsure: number;
  failed: number;
}

/**
 * Adjudicate a batch of pairs and record every verdict.
 *
 * Sequential on purpose. The gateway is shared with chat, and a burst of
 * parallel calls from a background sweep is exactly the shape that made replies
 * slow; there is no deadline on this work.
 */
export async function adjudicateBatch(
  pairs: AdjudicationInput[],
  opts: {
    neighbourNames?: (a: string, b: string) => string[];
    /**
     * Called before every pair.
     *
     * Not decoration. The nightly engine registers a batch whose heartbeat goes
     * STALE after 120s, and a stale batch stops suppressing the stall alarm —
     * which is how a heavy intel stage previously got the service restarted
     * underneath it, eight times a night. Forty sequential model calls is
     * minutes of work, so every one of them has to say the process is busy.
     */
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<AdjudicationRun> {
  const run: AdjudicationRun = { considered: pairs.length, decided: 0, same: 0, different: 0, unsure: 0, failed: 0 };

  const versions = await loadEvidenceVersions();
  let index = 0;
  for (const pair of pairs) {
    opts.onProgress?.(index++, pairs.length);
    try {
      const [own, together] = pair.evidence.length
        ? [pair.evidence, [] as PairEvidence[]]
        : await Promise.all([
            loadPairEvidence(pair.a.id, pair.b.id),
            loadCoMentions(pair.a.id, pair.b.id),
          ]);
      const evidence = [...own, ...together];
      const sharedNeighbours = pair.sharedNeighbours.length
        ? pair.sharedNeighbours
        : (opts.neighbourNames?.(pair.a.id, pair.b.id) ?? []);
      const verdict = await adjudicatePair({ ...pair, evidence, sharedNeighbours });
      if (!verdict) {
        run.failed++;
        continue;
      }
      await recordDecision({
        evidenceVersion: pairEvidenceVersion(pair.a.id, pair.b.id, versions),
        citations: verdict.citations,
        aId: pair.a.id,
        bId: pair.b.id,
        verdict: verdict.verdict,
        decidedBy: 'llm',
        confidence: pair.confidence,
        verdictConfidence: verdict.confidence,
        rationale: verdict.rationale,
        model: verdict.model,
        aName: pair.a.name,
        bName: pair.b.name,
      });
      run.decided++;
      run[verdict.verdict]++;
    } catch (err) {
      console.error(
        `[intel:adjudicate] failed on "${pair.a.name}" / "${pair.b.name}":`,
        err instanceof Error ? err.message : err,
      );
      run.failed++;
    }
  }

  return run;
}

/**
 * The band worth reading.
 *
 * Above the auto-merge line the rules are already right and an LLM call is
 * money spent to agree with them. Below the review floor the volume is
 * unbounded — every weak token overlap in a 4,500-entity graph — and the
 * evidence is thin enough that the honest answer would be `unsure` every time.
 */
export const ADJUDICATION_BAND = { min: 0.4, max: 0.85 } as const;
/** Pairs one nightly stage may read. A blast radius, not a rate limit. */
export const ADJUDICATION_NIGHTLY_LIMIT = 40;

export interface CandidateForAdjudication {
  candidate: { confidence: number; reason: string };
  keep: ResolvableEntity;
  merge: ResolvableEntity;
  decision?: { decidedBy: string; stale?: boolean } | null;
}

/**
 * Adjudicate the undecided middle of a duplicate sweep.
 *
 * Pairs that already carry a verdict are skipped — re-asking costs money to
 * produce an answer that is already on file, and a human verdict must never be
 * quietly overwritten by a model.
 */
export async function adjudicateCandidates(
  reports: CandidateForAdjudication[],
  opts: {
    limit?: number;
    band?: { min: number; max: number };
    force?: boolean;
    /** Passed through to `adjudicateBatch` — see why it matters there. */
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<AdjudicationRun & { skipped: number }> {
  const band = opts.band ?? ADJUDICATION_BAND;
  const limit = opts.limit ?? ADJUDICATION_NIGHTLY_LIMIT;

  const eligible = reports.filter((r) => {
    if (r.decision?.decidedBy === 'human') return false;
    if (!opts.force && r.decision && !r.decision.stale) return false;
    const c = r.candidate.confidence;
    return c >= band.min && c <= band.max;
  });
  const skipped = reports.length - eligible.length;

  const { loadNeighbourIndex } = await import('./merge');
  const neighbours = await loadNeighbourIndex().catch(() => new Map<string, Set<string>>());

  const chosen = eligible.slice(0, limit);

  // A shared neighbour is only useful to a reader as a NAME. Collect the ids
  // first, then resolve them in one query — the earlier version fell back to an
  // id prefix, which told the model nothing and cost tokens to say it.
  const sharedIds = new Set<string>();
  const sharedPerPair = chosen.map((r) => {
    const na = neighbours.get(r.keep.id) ?? new Set<string>();
    const nb = neighbours.get(r.merge.id) ?? new Set<string>();
    const ids: string[] = [];
    for (const id of na) {
      if (id === r.keep.id || id === r.merge.id) continue;
      if (!nb.has(id)) continue;
      ids.push(id);
      sharedIds.add(id);
      if (ids.length >= NEIGHBOURS_SHOWN) break;
    }
    return ids;
  });
  const names = await loadEntityNames([...sharedIds]);

  const inputs: AdjudicationInput[] = chosen.map((r, i) => {
    const shared = sharedPerPair[i].map((id) => names.get(id)).filter((n): n is string => Boolean(n));
    return {
      a: r.keep,
      b: r.merge,
      evidence: [],
      sharedNeighbours: shared,
      confidence: r.candidate.confidence,
      reason: r.candidate.reason,
    };
  });

  const run = await adjudicateBatch(inputs, { onProgress: opts.onProgress });
  return { ...run, skipped };
}
