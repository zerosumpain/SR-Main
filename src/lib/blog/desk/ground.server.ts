/**
 * The grounded lane: pull the checkable assertions out of a draft and put each
 * one in front of the web before it publishes.
 *
 * Server-only — it spends money (one extraction call, then a search and a
 * verdict call per claim) and holds the Tavily key's blast radius.
 *
 * This is the DESK's half of the job. `/api/admin/blog/review-claims` already
 * does claim extraction plus a Tavily lookup and streams candidate sources for
 * the author to cite; that endpoint stops at "here are some links". This one
 * carries on to a verdict and turns it into a `Finding`, so the answer lands in
 * the checklist and survives a page reload. The extraction prompt and the
 * ranking are deliberately the same shape as that route's — two prompts that
 * drift apart would give the two panels different claim lists off one post,
 * which reads as a bug in whichever one you happened to open second.
 */

import { getLLMClient } from '$lib/llm/client';
import { search as tavilySearch } from '$lib/deepdive/tavily';
import { hostnameOf, rankSources } from '$lib/blog/reputable-domains';
import { anchorHash } from './anchor';
import type { Evidence, Finding } from './types';
import { resolveBlogModel } from '$lib/server/models/workload-settings';

/** A claim as pulled from the draft, with the query that will be used to check
 *  it. `snippet` is verbatim post text: it is both the editor's scroll-to
 *  target and the input to the anchor hash, so it must not be paraphrased. */
export type GroundedClaim = { claim: string; snippet: string; searchQuery: string };

export type ClaimVerdict = {
  stance: 'supports' | 'contradicts' | 'unclear';
  /** 0..1. The model's own, clamped — it is a sort key and a severity input,
   *  never a probability anything is calibrated against. */
  confidence: number;
  reasoning: string;
  evidence: Evidence[];
};

/** Eight is the cap and it is a budget, not a limit of the extractor: each
 *  claim costs one Tavily search plus one verdict call, so a chatty post could
 *  otherwise turn a save into twenty round trips. The most load-bearing claims
 *  are what is wanted, not all of them. */
const MAX_CLAIMS = 8;
/** Enough to have something worth ranking; the top 4 are what the verdict call
 *  actually reads. */
const TAVILY_RESULTS_PER_CLAIM = 8;
const CANDIDATES_PER_CLAIM = 4;
/** A long post past this is truncated rather than sent whole. The extractor's
 *  job is the load-bearing claims and those cluster in the argument, not the
 *  appendix — and a 40k-character body silently blows the context window of a
 *  model whose window changed under us at the catalogue's next refresh. */
const MAX_INPUT_CHARS = 24_000;
const SNIPPET_MAX = 240;

/**
 * WHY THE SKIP LIST IS HALF THE PROMPT: a fact checker that flags "I found this
 * frustrating" as an unverified claim is a fact checker the author learns to
 * scroll past, and once he is scrolling past it the real finding underneath
 * goes with it. Opinion, prediction and first-person experience are not
 * checkable against anything, so surfacing them is pure cost — every one of
 * them spends a search, a verdict call and, worse, a line of the author's
 * attention. Better to return three claims that are genuinely checkable than
 * eight where five are the author's own life.
 */
const EXTRACT_SYSTEM = `You read a draft blog post and extract the factual assertions in it that could be checked against an external source.

EXTRACT a sentence only if it asserts something about the world that could, in principle, be shown right or wrong by someone else:
- dates, quantities, measurements, prices, percentages
- named events and what happened at them
- attributions: who said, wrote, built, decided or published something
- statements about what an organisation, product, standard or law does

SKIP, always, and return nothing for:
- opinion, taste, judgement or argument ("the API is badly designed")
- prediction or speculation about the future ("this will be standard by 2030")
- the author's own experience, actions or feelings ("I spent a weekend on it", "I found this frustrating")
- hypotheticals, analogies, jokes and rhetorical questions
- anything whose truth depends on the author's private situation rather than the public record

For each claim return:
- "claim": one sentence restating the factual assertion plainly
- "snippet": the EXACT substring of the post containing it, copied verbatim, at most 180 characters. Do not paraphrase, correct or re-punctuate it.
- "searchQuery": a web search query of at most 12 words, using the specific names, dates and terms that would appear in a source

Return at most ${MAX_CLAIMS} claims, the ones the post most depends on being right. If there are no checkable factual assertions, return an empty array — that is a normal answer, not a failure.

Respond with VALID JSON ONLY:
{"claims": [{"claim": "...", "snippet": "...", "searchQuery": "..."}]}`;

/**
 * NO VOICE BLOCK ON THIS CALL, and none on the extractor either.
 *
 * The Voice Card exists to make generated prose sound like John. A finding is
 * not prose: it is machine output the author reads once and acts on, and
 * measurably, wrapping an extraction or classification prompt in a writing
 * voice degrades it — the model spends its attention matching a register
 * instead of matching the claim to the evidence, and the JSON comes back
 * chattier and less accurate. The voice system is opt-in per surface for
 * exactly this reason. Do not add one here because the output "reads dry".
 */
const VERDICT_SYSTEM = `You are checking one factual claim against search results. You are not writing prose and you are not being persuasive.

Decide whether the sources, taken together, SUPPORT the claim, CONTRADICT it, or leave it UNCLEAR.

- "supports": at least one source states substantially the same fact.
- "contradicts": at least one source states something incompatible with it. A source giving a different number, date or attribution for the same thing contradicts it.
- "unclear": the sources are about the right subject but do not settle this claim, or they are about something else entirely. This is the correct answer far more often than either of the others, and choosing it costs nothing.

Judge the CLAIM, not the writing. Do not penalise a claim for being roughly worded if the substance matches.

Also mark each source you were given with its own stance towards the claim, by index. A source you did not use is "unclear".

Respond with VALID JSON ONLY:
{"stance": "supports" | "contradicts" | "unclear", "confidence": 0.0-1.0, "reasoning": "one or two sentences, naming the source that decided it", "sources": [{"index": 0, "stance": "supports"}]}`;

/**
 * Parse JSON out of a model reply.
 *
 * `response_format: json_object` is asked for on every call here and is still
 * not a guarantee — a provider that quietly ignores it, or a Codex-routed model
 * that fences its output, returns a ```json block. The brace-slice fallback is
 * the same one `/api/admin/blog/review-claims` carries and exists because a
 * whole run failing on a stray backtick is not a failure worth having.
 */
function safeJSON<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const trim = (s: string, max: number) => {
  const flat = (s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function isStance(v: unknown): v is Evidence['stance'] {
  return v === 'supports' || v === 'contradicts' || v === 'unclear';
}

/**
 * Pull the checkable assertions out of a draft.
 *
 * Returns [] rather than throwing on a malformed reply: an extractor that found
 * nothing and an extractor that could not be parsed look the same to the
 * caller, and neither is a reason to lose the deterministic findings the run
 * has already stored. The route reports the count, so "0 claims" is visible.
 */
export async function extractClaims(plainText: string, max: number = MAX_CLAIMS): Promise<GroundedClaim[]> {
  const text = (plainText ?? '').trim();
  // Below this there is not enough post to have an argument in it, let alone a
  // sourced one. Saves a call on every new draft.
  if (text.length < 200) return [];

  const cap = Math.max(0, Math.min(max, MAX_CLAIMS));
  if (cap === 0) return [];

  // The `blog` role, not the bare site default. The writing desk IS the blog
  // assistant's other half — the assistant endpoints have resolved `blog` since
  // it was registered, and these two calls quietly did not, so the switch on
  // /admin/ops/costs moved half of blog and left the desk behind.
  const ctx = await resolveBlogModel();
  const { client, model } = await getLLMClient(ctx);
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: `BLOG POST:\n\n${text.slice(0, MAX_INPUT_CHARS)}` },
    ],
    temperature: 0.2,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
  });

  const parsed = safeJSON<{ claims?: GroundedClaim[] }>(res.choices[0]?.message?.content ?? '');
  const claims = Array.isArray(parsed?.claims) ? parsed.claims : [];

  return claims
    .filter(
      (c): c is GroundedClaim =>
        !!c &&
        typeof c.claim === 'string' &&
        typeof c.snippet === 'string' &&
        typeof c.searchQuery === 'string' &&
        c.claim.trim().length > 0 &&
        c.searchQuery.trim().length > 0,
    )
    .map((c) => ({
      claim: c.claim.trim(),
      snippet: trim(c.snippet, SNIPPET_MAX),
      searchQuery: c.searchQuery.trim(),
    }))
    .slice(0, cap);
}

/** Tavily relevance plus the shared source bonus — reputation, UK provenance,
 *  academic status, less a penalty for a source with an interest in the claim.
 *  Literally the same function the sources panel uses; see
 *  $lib/blog/reputable-domains for the arithmetic and why it is worth ~1 point. */
function rank(results: { url: string; title: string; content: string; score: number }[], subject: string) {
  return rankSources(results, { subject, limit: CANDIDATES_PER_CLAIM }).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: trim(r.snippet, 400),
    score: r.score,
  }));
}

/**
 * Search for one claim and ask the model what the results say about it.
 *
 * One LLM call, over the top four sources only. Feeding it all eight would cost
 * more and read worse: the tail of a Tavily page is where the SEO reprints sit,
 * and a model given a reprint of the claim as a source will happily cite it
 * back as confirmation.
 */
export async function groundClaim(claim: GroundedClaim): Promise<ClaimVerdict> {
  const found = await tavilySearch(claim.searchQuery, {
    maxResults: TAVILY_RESULTS_PER_CLAIM,
    searchDepth: 'advanced',
  });
  const candidates = rank(found.results ?? [], claim.claim);

  // No sources, no verdict call. "Nothing came back" is already the honest
  // answer and paying a model to phrase it would only invite it to answer from
  // its own memory, which is the one thing a grounded check must not do.
  if (!candidates.length) {
    return {
      stance: 'unclear',
      confidence: 0,
      reasoning: 'No search results came back for this claim, so nothing here either supports or contradicts it.',
      evidence: [],
    };
  }

  const sourceBlock = candidates
    .map((c, i) => `[${i}] ${c.title} (${hostnameOf(c.url)})\n${c.snippet}`)
    .join('\n\n');

  const ctx = await resolveBlogModel();
  const { client, model } = await getLLMClient(ctx);
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: VERDICT_SYSTEM },
      {
        role: 'user',
        content: `CLAIM: ${claim.claim}\n\nAS WRITTEN IN THE POST: ${claim.snippet}\n\nSOURCES:\n\n${sourceBlock}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 800,
    response_format: { type: 'json_object' },
  });

  const parsed = safeJSON<{
    stance?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
    sources?: { index?: unknown; stance?: unknown }[];
  }>(res.choices[0]?.message?.content ?? '');

  // Per-source stances default to 'unclear', never to the overall verdict. They
  // mean different things: the verdict is about the claim, a source's stance is
  // about that page, and inheriting one from the other would print "contradicts"
  // beside a source the model never used.
  const perSource = new Map<number, Evidence['stance']>();
  for (const s of parsed?.sources ?? []) {
    const i = Number(s?.index);
    if (Number.isInteger(i) && i >= 0 && i < candidates.length && isStance(s?.stance)) {
      perSource.set(i, s.stance);
    }
  }

  const evidence: Evidence[] = candidates.map((c, i) => ({
    url: c.url,
    title: c.title,
    snippet: c.snippet,
    stance: perSource.get(i) ?? 'unclear',
  }));

  const stance = isStance(parsed?.stance) ? parsed.stance : 'unclear';
  const rawConfidence = Number(parsed?.confidence);
  // An unparseable confidence becomes 0, not 0.5: an unknown reading must not
  // be able to push a finding up a severity band on its own.
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;

  return {
    stance,
    confidence,
    reasoning: typeof parsed?.reasoning === 'string' ? trim(parsed.reasoning, 600) : '',
    evidence,
  };
}

/**
 * Turn a verdict into a checklist finding.
 *
 * SEVERITY RULE, and it is not negotiable: a grounded claim finding is NEVER a
 * 'blocker'. Only the deterministic checks may stop a publish, because only
 * they are reproducible from the post text alone — same input, same finding,
 * every time. A model's reading of four search snippets is not, and the moment
 * it can block, the gate starts refusing to ship posts for reasons nobody can
 * reproduce and the only available fix is to stop trusting the gate. So:
 * 'contradicts' at confidence >= 0.7 is 'review' (worth stopping to read),
 * everything else is 'nit'. The same rule is stated at the top of ./checks.
 *
 * The anchor is the snippet, hashed the same way ./checks hashes its own: a
 * rule id, a NUL, then the identifying text. The rule id costs nothing here —
 * there is only one claim rule today — and it keeps the key shape identical, so
 * a second claim rule can be added later without re-keying every stored
 * finding. The fallback to `claim.claim` matters: an extractor that returns an
 * empty snippet would otherwise hash every claim in the post to one key, and
 * the upsert would collapse them into a single row.
 */
export function verdictToFinding(claim: GroundedClaim, verdict: ClaimVerdict): Finding {
  const severity = verdict.stance === 'contradicts' && verdict.confidence >= 0.7 ? 'review' : 'nit';
  const key = claim.snippet.trim() || claim.claim;

  const title =
    verdict.stance === 'contradicts'
      ? 'Sources disagree with this claim'
      : verdict.stance === 'supports'
        ? 'Claim checks out'
        : 'Claim could not be confirmed';

  const detail = [
    claim.claim,
    verdict.reasoning,
    verdict.evidence.length
      ? `Checked against ${verdict.evidence.length} source${verdict.evidence.length === 1 ? '' : 's'}.`
      : 'No sources were found for it.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    kind: 'claim',
    severity,
    title,
    detail,
    anchorText: claim.snippet || null,
    anchorHash: anchorHash('claim', `claim-grounded\u0000${key}`),
    evidence: verdict.evidence,
  };
}
