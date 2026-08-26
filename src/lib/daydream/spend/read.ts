// src/lib/daydream/spend/read.ts
//
// The model reads the merchant; code checks the money.
//
// A deliberately small job for a model. Finding "what shop was this" in a wall
// of marketing HTML is exactly what a language model is good at and a regex is
// not; deciding whether £46.49 was really charged is exactly the reverse. So
// the model returns a merchant and a claimed amount, and `verifyAmount` refuses
// the row unless that amount appears verbatim in the source.
//
// All model access goes through $lib/jkai/llm-client, never a provider SDK.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamSpend, intelNotes } from '$lib/db/schema';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDaydreamModel } from '../compose';
import { DEFAULT_SUBJECT, LOCAL_TZ, errMsg } from '../types';
import { shortlist, verifyAmount } from './extract';

export const MAX_TOKENS = 220;
/** How much of a message the model sees. Receipts put the total near the top,
 *  and a whole marketing email is mostly footer. */
export const BODY_CHARS = 2500;

export interface ExtractResult {
  considered: number;
  shortlisted: number;
  written: number;
  /** Extracted but the amount was nowhere in the source — quarantined. */
  unverified: number;
  skipped: number;
  tokens: number;
  errors: string[];
}

export const EMPTY_EXTRACT: ExtractResult = {
  considered: 0, shortlisted: 0, written: 0, unverified: 0, skipped: 0, tokens: 0, errors: [],
};

const SYSTEM = `You read one email and say what was bought and for how much.

Reply with ONE line of JSON and nothing else:
{"merchant": "<shop name>", "amountMinor": <integer pence>, "currency": "GBP"|"USD"|"EUR"}

Rules:
- amountMinor is the TOTAL CHARGED, in minor units: £42.50 is 4250.
- Copy a total that is written in the email. Never add anything up yourself; a
  figure you calculated will be rejected and the whole reading discarded.
- merchant is the shop or service, as a person would say it. Not the sender's
  full legal name, not the email address.
- If this is an advert, a quote, a price list, a statement, or anything where no
  money actually changed hands, reply exactly: {"none": true}
- If you cannot find a clear total that is written down, reply {"none": true}.`;

function localDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Work through recent unprocessed mail and record what was actually paid.
 *
 * The shortlist runs first and costs nothing, so the model only ever sees
 * something that already looks like a receipt. At production density that is a
 * handful of messages a week.
 */
export async function extractSpend(
  opts: { limit?: number; sinceDays?: number; subject?: string } = {},
): Promise<ExtractResult> {
  const limit = opts.limit ?? 15;
  const sinceDays = opts.sinceDays ?? 30;
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const result: ExtractResult = { ...EMPTY_EXTRACT, errors: [] };
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  let notes;
  try {
    notes = await db
      .select({
        id: intelNotes.id,
        title: intelNotes.title,
        body: intelNotes.rawContent,
        observedAt: intelNotes.observedAt,
        createdAt: intelNotes.createdAt,
      })
      .from(intelNotes)
      .where(
        and(
          eq(intelNotes.source, 'email'),
          gte(intelNotes.createdAt, since),
          // Not already read. One row per source message, enforced by a unique
          // index as well — this is the cheap half.
          sql`not exists (select 1 from ${daydreamSpend} s where s.source_note_id = ${intelNotes.id})`,
        ),
      )
      .orderBy(desc(intelNotes.createdAt))
      .limit(200);
  } catch (err) {
    result.errors.push(`read failed: ${errMsg(err)}`);
    return result;
  }

  const candidates = notes
    .filter((n) => {
      result.considered++;
      return shortlist(n.title ?? '').isCandidate;
    })
    .slice(0, limit);
  result.shortlisted = candidates.length;
  if (candidates.length === 0) return result;

  const model = await resolveDaydreamModel();
  const { client, model: modelId } = await getLLMClient(model);

  for (const note of candidates) {
    const body = (note.body ?? '').slice(0, BODY_CHARS);
    if (!body.trim()) {
      result.skipped++;
      continue;
    }

    try {
      const res = await client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `SUBJECT: ${note.title ?? ''}\n\n${body}` },
        ],
        temperature: 0,
        max_tokens: MAX_TOKENS,
      });
      result.tokens += (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);

      const raw = (res.choices[0]?.message?.content ?? '')
        .trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      if (!raw) { result.skipped++; continue; }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.none === true) { result.skipped++; continue; }

      const merchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim().slice(0, 120) : '';
      const amountMinor = typeof parsed.amountMinor === 'number' ? Math.round(parsed.amountMinor) : NaN;
      const currency = typeof parsed.currency === 'string' ? parsed.currency : 'GBP';
      if (!merchant || !Number.isFinite(amountMinor) || amountMinor <= 0) {
        result.skipped++;
        continue;
      }

      // The grounding check. A total the model computed itself appears nowhere
      // in the message and is refused here — which is the single most likely
      // way this could quietly start inventing money.
      const check = verifyAmount(body, { amountMinor, currency });
      if (!check.ok) {
        result.unverified++;
        continue;
      }

      const when = note.observedAt ?? note.createdAt;
      await db
        .insert(daydreamSpend)
        .values({
          subject,
          sourceNoteId: note.id,
          merchant,
          amountMinor,
          currency,
          day: localDay(when),
          evidence: check.evidence ?? '',
          verified: true,
        })
        .onConflictDoNothing({ target: daydreamSpend.sourceNoteId });
      result.written++;
    } catch (err) {
      result.errors.push(`${note.id}: ${errMsg(err)}`);
    }
  }

  return result;
}
