// src/lib/daydream/compose.ts
//
// The only step that spends anything.
//
// A rule has already decided there is something here; this turns it into one
// sentence worth reading. Two constraints shape the whole file:
//
//   • **Evidence in, or nothing out.** The composer may look at exactly the
//     evidence the detector named and no more. It cannot go fishing, so it
//     cannot describe a shop it has not been shown or a night it has not been
//     given. Anything it asserts that is not in the FACTS block is a fabrication
//     and the verify pass exists to catch it.
//   • **The rule's explanation survives.** `explanation` is deterministic and
//     already on the row. The model produces `narrative`, which is a nicer way
//     of saying the same thing — never the only record of what was found. If
//     this whole file failed permanently, the ledger would still be readable.
//
// All model access goes through `$lib/llm/client`, never a provider SDK.

import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, jkaiMemories } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { coerceModelContext } from '$lib/constants/default-models';
import { getSetting } from '$lib/server/models/settings';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { describePlaceRhythm } from './places';
import { errMsg } from './types';
import type { EvidenceRef } from './snapshot-types';
import type { DaydreamThought } from '$lib/db/schema';

/** app_settings key for the daydream model carve-out. Declared in
 *  $lib/models/workloads so the picker and the resolver cannot disagree. */
export const DAYDREAM_MODEL_KEY = 'jkai.daydream.model';

/** Short on purpose. A daydream is one or two sentences; a budget that allows
 *  an essay produces one. */
export const MAX_TOKENS = 220;
export const VERIFY_MAX_TOKENS = 120;

export interface ComposeResult {
  narrative: string | null;
  /** Why it was dropped, when it was. */
  droppedReason: string | null;
  verified: boolean;
  tokens: { prompt: number; completion: number };
}

/** The daydream model: its own pin, falling back to the site default. */
export async function resolveDaydreamModel() {
  const v = await getSetting<{ modelId?: string } | null>(DAYDREAM_MODEL_KEY);
  if (v && typeof v === 'object' && typeof v.modelId === 'string' && v.modelId) {
    return coerceModelContext({ modelId: v.modelId });
  }
  return resolveDefaultModel();
}

/**
 * Turn the evidence refs a detector named into text the model may see.
 *
 * This is the boundary. Whatever comes back from here is the entire world the
 * composer gets — it has no tools and no database access of its own, so it
 * cannot widen its own context, and a claim about anything absent from this
 * block is by construction invented.
 */
export async function gatherFacts(evidence: EvidenceRef[]): Promise<string[]> {
  const facts: string[] = [];

  const placeIds = evidence.filter((e) => e.kind === 'place').map((e) => e.id);
  if (placeIds.length) {
    const places = await db
      .select()
      .from(daydreamPlaces)
      .where(inArray(daydreamPlaces.id, placeIds));
    for (const p of places) {
      // Coordinates are deliberately NOT included. The model does not need them
      // to write a sentence, and a lat/lon in a prompt is a lat/lon in a
      // provider's logs.
      facts.push(
        `PLACE: ${p.label ?? 'an unnamed place'}${p.kind !== 'unknown' ? ` (${p.kind})` : ''} — ${describePlaceRhythm(p)}.`,
      );
    }
  }

  const memoryIds = evidence.filter((e) => e.kind === 'memory').map((e) => e.id);
  if (memoryIds.length) {
    const memories = await db
      .select({ content: jkaiMemories.content })
      .from(jkaiMemories)
      .where(inArray(jkaiMemories.id, memoryIds));
    for (const m of memories) facts.push(`MEMORY: ${m.content}`);
  }

  // Everything else travels as the note the detector already wrote. Those notes
  // are rule-generated and therefore trustworthy; resolving them back to live
  // rows here would be a second, unaudited way for data to reach the prompt.
  for (const e of evidence) {
    if (e.kind === 'place' || e.kind === 'memory') continue;
    if (e.note) facts.push(`${e.kind.toUpperCase()}: ${e.note}`);
  }

  return facts;
}

/**
 * What has landed well, and what has not.
 *
 * The third of the three learning mechanisms, and the only one that touches the
 * model. The other two shape SELECTION — which thoughts clear the bar. This
 * shapes PHRASING, by showing the composer what the owner actually kept.
 *
 * Deliberately small: a handful each way. A prompt stuffed with thirty
 * exemplars stops being guidance and starts being a style the model imitates
 * literally, and it costs tokens on every single call — the same argument
 * `briefing/feedback.ts` makes for keeping its feedback line to eight items.
 */
export async function exemplarLines(limit = 4): Promise<string> {
  try {
    const { daydreamThoughts } = await import('$lib/db/schema');
    const { desc, eq, isNotNull, and } = await import('drizzle-orm');

    const pick = async (verdict: 'useful' | 'not_useful') =>
      db
        .select({ title: daydreamThoughts.title, narrative: daydreamThoughts.narrative })
        .from(daydreamThoughts)
        .where(and(eq(daydreamThoughts.feedback, verdict), isNotNull(daydreamThoughts.narrative)))
        .orderBy(desc(daydreamThoughts.feedbackAt))
        .limit(limit);

    const [good, bad] = await Promise.all([pick('useful'), pick('not_useful')]);
    const parts: string[] = [];
    if (good.length) {
      parts.push(
        `These landed well, so match their register:\n${good.map((g) => `- ${g.narrative}`).join('\n')}`,
      );
    }
    if (bad.length) {
      parts.push(
        `These did NOT land. Do not write like this:\n${bad.map((b) => `- ${b.narrative}`).join('\n')}`,
      );
    }
    return parts.join('\n\n');
  } catch {
    // An unreadable ledger costs better phrasing, never the notification.
    return '';
  }
}

const SYSTEM = `You write one short notification for John about something his assistant noticed.

Rules, in order of importance:
1. Use ONLY the FACTS given. If a detail is not in FACTS, it does not exist. Never invent a shop, a time, a number or a name.
2. One or two sentences. Under 200 characters if you can.
3. Low-key and factual. No greeting, no sign-off, no exclamation marks, no emoji, no "just a heads up".
4. Do not instruct him what to do about it. State the thing; he can decide.
5. If the FACTS do not actually support anything worth saying, reply with exactly: SKIP`;

/** Ask for the sentence. */
export async function composeNarrative(
  thought: Pick<DaydreamThought, 'kind' | 'title' | 'explanation' | 'evidence'>,
  opts: { verify: boolean },
): Promise<ComposeResult> {
  const result: ComposeResult = {
    narrative: null,
    droppedReason: null,
    verified: false,
    tokens: { prompt: 0, completion: 0 },
  };

  const facts = await gatherFacts(thought.evidence as EvidenceRef[]);
  if (facts.length === 0) {
    // A detector that named no usable evidence has nothing for a model to work
    // from, and letting it write anyway is exactly how confident nonsense gets
    // produced. Dropped, not phrased.
    result.droppedReason = 'no usable evidence';
    return result;
  }

  const model = await resolveDaydreamModel();
  const { client, model: modelId } = await getLLMClient(model);

  const exemplars = await exemplarLines();

  const prompt = [
    `WHAT WAS NOTICED (rule-generated, already true):`,
    thought.explanation,
    '',
    'FACTS:',
    ...facts.map((f) => `- ${f}`),
    ...(exemplars ? ['', exemplars] : []),
    '',
    'Write the notification.',
  ].join('\n');

  try {
    const res = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
    });
    result.tokens.prompt = res.usage?.prompt_tokens ?? 0;
    result.tokens.completion = res.usage?.completion_tokens ?? 0;

    const text = res.choices[0]?.message?.content?.trim() ?? '';
    if (!text || text === 'SKIP' || text.startsWith('SKIP')) {
      result.droppedReason = 'model judged it not worth saying';
      return result;
    }
    result.narrative = text.slice(0, 400);
  } catch (err) {
    result.droppedReason = `compose failed: ${errMsg(err)}`;
    return result;
  }

  if (!opts.verify) return result;

  // ── Verify ────────────────────────────────────────────────────────────────
  // A second call whose only job is to refuse. It sees the same FACTS and the
  // draft, and answers whether every claim in the draft is supported. This is
  // what the spare quota buys: precision, not volume.
  try {
    const verifyRes = await client.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: 'system',
          content:
            'You check a draft notification against the facts it was written from. ' +
            'Answer with exactly one word: SUPPORTED if every claim in the draft appears in the facts, ' +
            'or UNSUPPORTED if the draft states anything the facts do not. Be strict. Default to UNSUPPORTED when unsure.',
        },
        {
          role: 'user',
          content: `FACTS:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nDRAFT:\n${result.narrative}`,
        },
      ],
      temperature: 0,
      max_tokens: VERIFY_MAX_TOKENS,
    });
    result.tokens.prompt += verifyRes.usage?.prompt_tokens ?? 0;
    result.tokens.completion += verifyRes.usage?.completion_tokens ?? 0;

    const verdict = (verifyRes.choices[0]?.message?.content ?? '').trim().toUpperCase();
    if (verdict.startsWith('SUPPORTED')) {
      result.verified = true;
    } else {
      // Fall back to the rule's own explanation rather than dropping the
      // finding: the RULE was sound, only the phrasing failed to hold up.
      result.narrative = null;
      result.droppedReason = 'phrasing was not supported by the evidence';
    }
  } catch (err) {
    // A verify that could not run is not a pass. Keep the finding, lose the
    // phrasing — the deterministic explanation is still on the row.
    result.narrative = null;
    result.droppedReason = `verify failed: ${errMsg(err)}`;
  }

  return result;
}

/**
 * Store the phrasing against the thought, with what it cost and whether
 * anything checked it.
 *
 * Takes the whole ComposeResult rather than a narrative and a number, because
 * the two facts that were being dropped on the floor here — `verified` and the
 * token counts — are exactly the ones the page needs to stop overstating what
 * it knows. The old signature made discarding them the path of least
 * resistance, and both were duly discarded: every thought in production reads
 * cost 0.000000, and unverified prose was indistinguishable from verified.
 */
export async function saveNarrative(
  thoughtId: string,
  result: Pick<ComposeResult, 'narrative' | 'verified' | 'droppedReason' | 'tokens'>,
  costUsd = 0,
): Promise<void> {
  const { daydreamThoughts } = await import('$lib/db/schema');
  await db
    .update(daydreamThoughts)
    .set({
      narrative: result.narrative,
      // Null when there is no prose at all — "unverified" is a claim about
      // something that exists, and saying it about nothing is its own small lie.
      verified: result.narrative ? result.verified : null,
      narrativeDroppedReason: result.droppedReason,
      promptTokens: result.tokens.prompt,
      completionTokens: result.tokens.completion,
      costUsd: String(costUsd),
      updatedAt: new Date(),
    })
    .where(eq(daydreamThoughts.id, thoughtId));
}
