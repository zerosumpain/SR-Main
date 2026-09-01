// src/lib/daydream/adjudicate.ts
//
// Is the thing actually true?
//
// ── The gap this fills ──────────────────────────────────────────────────────
//
// Everything upstream of here checks that a thought is well FORMED. Detectors
// fire on rules over facts; the ponder audit drops a musing that cites a card
// it was not given; `compose`'s verify pass asks whether the phrasing is
// supported by the evidence block. None of that asks whether the claim is
// RIGHT — and a claim can cite its evidence perfectly and still be a misreading
// of it.
//
// The owner's example is the whole specification: "you were charged twice for
// Canva" is a correct reading of two rows, an invoice and a bank line, that are
// one payment seen from two sides. No amount of citation discipline catches
// that. Only going and looking does.
//
// So a reviewer gets the thought, the evidence it was built from, and the
// ability to go and read the sources, and returns its own estimate that the
// claim is true. **That verdict is the outcome**, and only a verdict of
// `verified` may reach WhatsApp.
//
// ── The two rules that do NOT bend ─────────────────────────────────────────
//
// 1. **A verdict can lift the threshold; it can never lift a mute.** The
//    cold-start threshold only ever existed as a proxy for "is this any good",
//    and a reviewer that has read the sources answers that question better than
//    a score does — so `verified` overrides it. A `never_kind` mute is a direct
//    instruction from the owner, and a model talking past it would make the
//    control worthless. Mutes are applied upstream in `persistCandidates`, so a
//    muted kind never becomes a thought and never arrives here at all; this
//    comment exists so that stays true the next time someone moves the check.
//
// 2. **The reviewer decides, and never acts.** It returns a verdict, a
//    likelihood and prose. It cannot deliver, schedule, write a memory or call
//    anything with a side effect.
//
// ── Reading sources means reading text other people wrote ──────────────────
//
// This is a deliberate departure from the rule the ponder lookup stage follows,
// which admits no tool returning somebody else's words. It has to be: the Canva
// case is only settleable by reading the invoice. A merchant who wanted to
// could therefore write an email designed to argue with the reviewer.
//
// What keeps that survivable is the blast radius, not the input. The reviewer's
// entire vocabulary is one of three verdicts, a number, and prose that is shown
// beside the claim rather than substituted for it. The worst a poisoned source
// can achieve is a wrong verdict on one thought — which suppresses a
// notification, or lets one through that the owner can then rate. It cannot
// reach a tool, a rule, or the delivery machinery.

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { coerceModelContext } from '$lib/constants/default-models';
import { thinkingRequestParams } from '$lib/models/thinking';
import { executeTool, getTool } from '$lib/workflows/site-tools/registry';
import { resolveEvidence } from './evidence';
import { errMsg } from './types';

/**
 * The reviewer's model, pinned rather than following the daydream default.
 *
 * Luna is the fast 5.6 at the lowest quota cost and the catalogue's own words
 * for it are "best fit for background site tasks" — which is exactly this. The
 * effort is where the money goes instead: `xhigh` on a small, well-bounded
 * question is a better buy than a heavier model on a shallow pass.
 */
export const REVIEW_MODEL_ID = 'codex/gpt-5.6-luna';
export const REVIEW_EFFORT = 'xhigh' as const;

export type Verdict = 'verified' | 'refuted' | 'uncertain';

/**
 * What the reviewer may look at.
 *
 * A positive allow-list, for the reasons set out in `ponder/lookups.ts`: the
 * `destructive` flag marks 21 of 188 tools and is not a read/write split, and
 * `executeTool` applies no gate of its own on headless paths. Unlike that list,
 * this one admits tools returning text the owner did not write — `mail_read`
 * and `gmail_get_message` are the only way to settle a claim about an invoice.
 * Nothing here writes, schedules, sends or spends.
 */
export const REVIEW_TOOL_NAMES: ReadonlyArray<string> = [
  // Settling a claim about an invoice needs the invoice.
  'mail_search',
  'mail_read',
  // The rows behind a money or spend claim.
  'datastore_query',
  // The figures behind a health claim.
  'health_stats',
  // The diary behind a plans claim.
  'apple_calendar_list',
  // Who or what a name refers to.
  'intel_find',
  // What John has already recorded about the thing.
  'memory_search',
];

const TOOL_NAMES = new Set(REVIEW_TOOL_NAMES);

/**
 * The tool definitions, taken from the registry rather than written out here.
 *
 * Hand-copying a parameter schema is precisely how `entity_id`/`entityId` and
 * `id`/`workflowId` cost two toolsets 44% and 48% of their calls: the copy
 * drifts from the tool and the resulting error is a DOMAIN claim ("not found"),
 * never "you spelled the argument wrong". Writing this list by hand had already
 * produced two such faults before it was replaced — `mail_read` takes `noteId`,
 * not `id`, and `apple_calendar_list` takes `dateRangeStart`, not `start`.
 *
 * A name the registry does not know is dropped rather than guessed at, and the
 * count is reported so a silently shrinking toolset is visible.
 */
export function reviewTools(): Array<{ type: 'function'; function: Record<string, unknown> }> {
  const out: Array<{ type: 'function'; function: Record<string, unknown> }> = [];
  for (const name of REVIEW_TOOL_NAMES) {
    const t = getTool(name);
    if (!t) {
      console.warn(`[daydream] reviewer: no such tool "${name}" — skipped`);
      continue;
    }
    out.push({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    });
  }
  return out;
}



/** Tool calls one review may make. A review that needs more than this is
 *  chasing something the sources cannot settle, and should say `uncertain`. */
export const MAX_TOOL_CALLS = 8;

/** Characters of any single tool result the model may see. A whole mailbox
 *  thread will not fit in a review and does not need to. */
const MAX_TOOL_RESULT = 4_000;

export interface ReviewResult {
  verdict: Verdict;
  likelihood: number;
  reasoning: string;
  /** Present only when the original claim needed restating. */
  narrative: string | null;
  sources: string[];
  tokens: { prompt: number; completion: number };
  toolCalls: number;
  /** The likelihood contradicted its verdict and was turned round. */
  likelihoodFlipped: boolean;
  error: string | null;
}

const SYSTEM = [
  "You are the reviewer for John's second brain. Something noticed a pattern and wants to tell him about it. Your job is to decide whether it is actually true, before he is interrupted with it.",
  '',
  'You are given the claim and the evidence it was built from. You may go and read the sources to check. Take your time and be sceptical: the machinery upstream of you checks only that a claim cites its evidence correctly, never that it read that evidence correctly.',
  '',
  'The failure this exists to catch: "you were charged twice for Canva" is a faithful reading of two rows — an invoice and a bank line — that are one payment seen from two sides. Look for that shape. One event reported by two systems. A subscription renewing on schedule mistaken for a duplicate. A calendar entry that recurs rather than repeating.',
  '',
  'Reply with ONE JSON object and nothing else:',
  '{"verdict":"verified"|"refuted"|"uncertain","likelihood":0.0-1.0,"reasoning":"...","narrative":"..."|null,"sources":["what you checked"]}',
  '',
  '- verdict "verified": you checked and the claim holds. He will be told.',
  '- verdict "refuted": you checked and it does not. He will NOT be told, and you will be quoted in the weekly letter explaining what you caught.',
  '- verdict "uncertain": the sources cannot settle it. He will not be interrupted for a maybe.',
  '- likelihood is the probability that THE CLAIM IS TRUE, on one 0..1 scale. It is NOT your confidence in your own verdict.',
  '  If you are 95% sure the claim is FALSE, likelihood is 0.05, not 0.95.',
  '  A "refuted" must be below 0.5. A "verified" must be above 0.5. Anything else contradicts itself.',
  '- reasoning: two sentences at most, plain, addressed to John. Say what you checked and what it showed.',
  '- narrative: only when the claim needs restating — a better sentence to send him. Null if the original stands.',
  '- sources: what you actually looked at. An empty list with a confident verdict is a contradiction; say "uncertain" instead.',
  '',
  'Refusing to be sure is a real answer and costs nothing. A wrong "verified" costs him an interruption about a thing that is not happening.',
].join('\n');

/** Run one tool for the reviewer. Refuses anything off the allow-list, however
 *  the model spells it. */
async function runReviewTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!TOOL_NAMES.has(name)) return `refused: ${name} is not available to the reviewer`;
  try {
    const res = await executeTool(name, args);
    if (!res?.success) return `error: ${String(res?.error ?? 'no result').slice(0, 300)}`;
    return JSON.stringify(res.data ?? null).slice(0, MAX_TOOL_RESULT);
  } catch (err) {
    return `error: ${errMsg(err).slice(0, 300)}`;
  }
}

/**
 * One resolved evidence item as the reviewer sees it — REF INCLUDED.
 *
 * First live run: a `mail_security` thought citing eighteen emails came back
 * `uncertain` because the reviewer "could not retrieve the cited messages". It
 * had gone hunting with `mail_search` and found unrelated mail. Those ids are
 * `intel_notes` ids and `mail_read` takes exactly that — it searched because
 * `mail_read`'s own description says the noteId comes "from a mail_search hit",
 * so nothing had ever told it the ids in front of it were the same thing.
 *
 * The runtime knew and the prompt did not, which is the same fault that kept
 * the lead frontier empty for a fortnight.
 */
export function evidenceLine(r: {
  kind: string;
  id: string;
  title: string;
  lines: string[];
  missing: boolean;
}): string {
  return `- [${r.kind}:${r.id}] ${r.title}${r.missing ? ' [THE ROW THIS NAMES IS GONE]' : ''}: ${r.lines.join(' ')}`.slice(
    0,
    400,
  );
}

/** How to reach the rows the evidence already names. A reviewer that
 *  re-searches for a row it was handed finds something else and concludes it
 *  could not check. */
export const SOURCE_GUIDANCE: ReadonlyArray<string> = [
  'Each line above is prefixed with the row it names. Read those rows DIRECTLY rather than searching for them again:',
  '  [email:<id>] — mail_read({"noteId":"<id>"}) returns that exact message. Do not use mail_search to find it; you already have it.',
  '  [memory:<id>], [intel-entity:<id>], [place:<id>], [spend:<id>] — the id is the row, and a search is a worse way to reach it.',
  'Searching is for what the evidence does NOT already name.',
];

export interface ThoughtToReview {
  id: string;
  kind: string;
  title: string;
  explanation: string;
  narrative: string | null;
  evidence: Array<{ kind: string; id: string; note?: string }>;
}

/**
 * Review one thought.
 *
 * Never throws. A reviewer that cannot run must leave the thought unreviewed
 * rather than guess — an unreviewed thought is silent, which is the safe
 * direction, and a failed review that recorded `refuted` would silently bury a
 * claim nobody had actually checked.
 */
export async function reviewThought(thought: ThoughtToReview): Promise<ReviewResult> {
  const empty: ReviewResult = {
    verdict: 'uncertain',
    likelihood: 0,
    reasoning: '',
    narrative: null,
    sources: [],
    tokens: { prompt: 0, completion: 0 },
    toolCalls: 0,
    likelihoodFlipped: false,
    error: null,
  };

  try {
    // The evidence, resolved to what it actually points at. The reviewer starts
    // from the same rows the claim was built on rather than re-finding them.
    let evidenceLines: string[] = [];
    try {
      const resolved = await resolveEvidence(thought.evidence ?? []);
      // The REF is carried, not just the prose.
      //
      // First live run: a `mail_security` thought citing eighteen emails came
      // back `uncertain` because the reviewer "could not retrieve the cited
      // messages" — it had gone hunting with `mail_search` and found unrelated
      // mail. Those ids are `intel_notes` ids, and `mail_read` takes exactly
      // that; it searched because `mail_read`'s own description says the noteId
      // comes "from a mail_search hit", so nothing had ever told it the ids in
      // front of it were the same thing. The runtime knew and the prompt did
      // not — the same fault that kept the lead frontier empty for a fortnight.
      evidenceLines = resolved.map(evidenceLine);
    } catch (err) {
      evidenceLines = [`(the evidence could not be resolved: ${errMsg(err)})`];
    }

    const { client, model } = await getLLMClient(coerceModelContext({ modelId: REVIEW_MODEL_ID }));
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          `CLAIM (${thought.kind}): ${thought.title}`,
          thought.narrative ? `AS IT WOULD BE SENT: ${thought.narrative}` : '',
          '',
          'HOW IT WAS REACHED:',
          thought.explanation,
          '',
          'THE EVIDENCE IT WAS BUILT FROM:',
          ...(evidenceLines.length ? evidenceLines : ['(none recorded)']),
          '',
          ...SOURCE_GUIDANCE,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    const tools = reviewTools();

    let promptTokens = 0;
    let completionTokens = 0;
    let toolCalls = 0;
    const checked: string[] = [];

    for (let turn = 0; turn <= MAX_TOOL_CALLS; turn++) {
      const res = await client.chat.completions.create({
        model,
        messages: messages as never,
        tools: tools as never,
        // The whole point of this stage. A shallow pass would reproduce the
        // mistake it exists to catch. Spelled by `thinkingRequestParams`
        // rather than by hand: the Codex bridge wants `reasoning_effort` and
        // OpenRouter wants a `reasoning` object, and getting that wrong fails
        // silently by simply not thinking any harder.
        ...thinkingRequestParams('codex', REVIEW_EFFORT),
        max_tokens: 1400,
      } as never);
      promptTokens += res.usage?.prompt_tokens ?? 0;
      completionTokens += res.usage?.completion_tokens ?? 0;

      const msg = res.choices?.[0]?.message as
        | { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
        | undefined;
      const calls = msg?.tool_calls ?? [];

      if (calls.length > 0 && turn < MAX_TOOL_CALLS) {
        messages.push({ role: 'assistant', content: msg?.content ?? '', tool_calls: calls });
        for (const c of calls) {
          toolCalls++;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.function.arguments || '{}');
          } catch {
            args = {};
          }
          checked.push(`${c.function.name}(${JSON.stringify(args).slice(0, 80)})`);
          const out = await runReviewTool(c.function.name, args);
          messages.push({ role: 'tool', tool_call_id: c.id, content: out });
        }
        continue;
      }

      const raw = (msg?.content ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return { ...empty, tokens: { prompt: promptTokens, completion: completionTokens }, toolCalls, error: 'reviewer did not return JSON' };
      }
      const v = validate(parsed, checked);
      return {
        ...v,
        likelihoodFlipped: v.likelihoodFlipped ?? false,
        tokens: { prompt: promptTokens, completion: completionTokens },
        toolCalls,
        error: null,
      };
    }

    return { ...empty, tokens: { prompt: promptTokens, completion: completionTokens }, toolCalls, error: 'reviewer ran out of turns' };
  } catch (err) {
    return { ...empty, error: errMsg(err).slice(0, 300) };
  }
}

/**
 * Coerce the reply into the three verdicts and a real number.
 *
 * Anything unrecognised becomes `uncertain`, never `verified`: the failure
 * direction that costs the owner an interruption about a thing that is not
 * happening is the one worth being strict about.
 */
export function validate(
  parsed: Record<string, unknown>,
  checked: string[],
): Pick<ReviewResult, 'verdict' | 'likelihood' | 'reasoning' | 'narrative' | 'sources'> & {
  /** True when the likelihood contradicted its verdict and was turned round. */
  likelihoodFlipped?: boolean;
} {
  const raw = typeof parsed.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : '';
  const verdict: Verdict = raw === 'verified' || raw === 'refuted' ? raw : 'uncertain';

  const n = typeof parsed.likelihood === 'number' ? parsed.likelihood : Number.NaN;
  let likelihood = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

  // ── The one scale, kept pointing the same way ────────────────────────────
  //
  // `likelihood` is the probability THE CLAIM IS TRUE, because that is the
  // number the owner asked for — "its own conclusion of the likelihood of that
  // fact". Models reliably answer a different question: on the first live runs
  // every refutation came back in the nineties, which is confidence in the
  // VERDICT, not probability of the claim. Five correct refutations of a real
  // duplicate-charge false alarm each carried 0.92–0.97, which on the feed
  // would read as "almost certainly true — refuted".
  //
  // The verdict is the outcome and is never touched. Only the number is turned
  // the right way round, and only when it plainly contradicts the verdict it
  // arrived with. Reported, not silent: a coercion nobody can see is how a
  // field quietly comes to mean something other than its name.
  let flipped = false;
  if (verdict === 'refuted' && likelihood > 0.5) {
    likelihood = 1 - likelihood;
    flipped = true;
  } else if (verdict === 'verified' && likelihood < 0.5) {
    likelihood = 1 - likelihood;
    flipped = true;
  }

  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim().slice(0, 600) : '';
  const narrativeRaw = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';
  const narrative = narrativeRaw.length >= 10 ? narrativeRaw.slice(0, 400) : null;

  const stated = Array.isArray(parsed.sources)
    ? parsed.sources.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 120))
    : [];
  // What it SAYS it checked, plus what it actually called. The second list is
  // the one that cannot be invented.
  const sources = [...new Set([...stated, ...checked])].slice(0, 20);

  // A confident verdict resting on nothing is not a verdict. Refutation is
  // exempt: the commonest honest refutation is "the evidence you gave me
  // already contradicts itself", which needs no further source.
  if (verdict === 'verified' && sources.length === 0) {
    return { verdict: 'uncertain', likelihood, reasoning, narrative, sources, likelihoodFlipped: flipped };
  }
  return { verdict, likelihood, reasoning, narrative, sources, likelihoodFlipped: flipped };
}

/** Thoughts still waiting on a review, newest first. */
export async function pendingReview(limit: number): Promise<ThoughtToReview[]> {
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      explanation: daydreamThoughts.explanation,
      narrative: daydreamThoughts.narrative,
      evidence: daydreamThoughts.evidence,
    })
    .from(daydreamThoughts)
    .where(
      and(
        isNull(daydreamThoughts.reviewVerdict),
        // Only what is still live. A thought the owner has already actioned or
        // dismissed does not need a verdict.
        or(eq(daydreamThoughts.status, 'new'), eq(daydreamThoughts.status, 'suppressed')),
        // And not a claim already settled under a different name.
        //
        // `suppressed` is deliberately IN the queue: a thought held back by the
        // cold-start score still deserves a verdict, because `verified` is what
        // lifts it over that bar. `already_refuted` is the one suppression that
        // must not be — the rows behind it have been read, and reviewing it
        // would spend a second xhigh pass reaching the conclusion that produced
        // the suppression. Six of those is the bill this whole change exists to
        // stop paying.
        sql`coalesce(${daydreamThoughts.suppressedReason}, '') not like 'already_refuted%'`,
      ),
    )
    .orderBy(sql`${daydreamThoughts.score} desc, ${daydreamThoughts.createdAt} desc`)
    .limit(limit);
  return rows as ThoughtToReview[];
}

/** Record a verdict against a thought. */
export async function recordReview(id: string, r: ReviewResult): Promise<void> {
  const reviewStatus = r.verdict === 'verified' ? 'new' : 'suppressed';
  const reviewReason =
    r.verdict === 'refuted'
      ? 'refuted_by_review'
      : r.verdict === 'uncertain'
        ? 'uncertain_after_review'
        : null;
  await db
    .update(daydreamThoughts)
    .set({
      reviewVerdict: r.verdict,
      reviewLikelihood: r.likelihood,
      reviewReasoning: r.reasoning || null,
      reviewNarrative: r.narrative,
      reviewSources: r.sources,
      reviewModel: REVIEW_MODEL_ID,
      reviewAt: new Date(),
      reviewPromptTokens: r.tokens.prompt,
      reviewCompletionTokens: r.tokens.completion,
      // Review is the final eligibility gate. Promote a verified thought even
      // when its cold-start score originally held it below the line; terminally
      // suppress the other verdicts so the composer does not keep reprocessing
      // them on every detector refresh.
      status: reviewStatus,
      suppressedReason: reviewReason,
      updatedAt: new Date(),
    })
    .where(eq(daydreamThoughts.id, id));
}
