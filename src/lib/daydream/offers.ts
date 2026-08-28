// src/lib/daydream/offers.ts
//
// Turning "you have a voucher" from a guess into a fact.
//
// Two stages, and the split is the point. There are 1,073 bulk emails in the
// last ninety days on production and most of them are newsletters; handing that
// pile to a model would be expensive, slow, and mostly wasted. So a free
// rule-based filter over subject lines picks a shortlist, and only the
// shortlist is extracted.
//
// Same shape as the rest of daydreaming: rules narrow, the model only does the
// bit rules genuinely cannot — reading prose. The extraction spends against the
// same Codex caps as the composer (see SPENDING_ACTIONS in budget.ts).
//
// ── The column that matters ──────────────────────────────────────────────────
//
// `expiresAt`. An EXPIRED voucher is worse than no voucher, because it sends
// you into a shop for nothing. A null expiry means the email stated no date,
// which is NOT the same as "does not expire" and is treated as weaker evidence
// rather than as a generous one.

import { and, desc, eq, gte, isNotNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamOffers, intelNotes } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { resolveDaydreamModel } from './compose';
import { errMsg } from './types';

/** How far back to look for offers. Anything older has almost certainly
 *  expired, and scanning it costs the same as scanning something useful. */
export const SCAN_DAYS = 45;
/** Ceiling on how many emails one run hands to the model. */
export const MAX_EXTRACT_PER_RUN = 12;

/**
 * Words that make a subject line look like an offer.
 *
 * Weighted, not boolean: "sale" alone is a newsletter, "sale" plus a percentage
 * plus an expiry is a voucher. Deliberately conservative — a false positive
 * here costs a model call, and worse, risks a confident sentence about a
 * discount that does not exist.
 */
export const OFFER_SIGNALS: ReadonlyArray<{ re: RegExp; weight: number; name: string }> = [
  { re: /\b\d{1,3}\s?% ?(off|discount)\b/i, weight: 3, name: 'percent_off' },
  { re: /[£$€]\s?\d+(\.\d{2})?\s*(off|back|credit|voucher|reward|cash)/i, weight: 3, name: 'amount_off' },
  // A bare currency amount, wherever it sits. Weaker on its own — a price in a
  // subject line is not an offer — but it is what carries a real voucher whose
  // noun follows the number rather than preceding it. "Your £10 Hotels.comCash
  // is expiring" scored 2 without this and was dropped, which is exactly the
  // email the whole detector exists for.
  { re: /[£$€]\s?\d+(\.\d{2})?\b/, weight: 2, name: 'currency_amount' },
  { re: /\bvoucher|coupon|promo(?:\s|-)?code\b/i, weight: 3, name: 'voucher' },
  { re: /\buse code\b|\bcode:\s*[A-Z0-9]{4,}/i, weight: 3, name: 'code' },
  { re: /\bcashback\b/i, weight: 2, name: 'cashback' },
  { re: /\bexpir(es|ing|y)\b|\bends (today|tonight|soon|tomorrow)\b|\blast chance\b|\bfinal call\b/i, weight: 2, name: 'expiry' },
  { re: /\b(free|complimentary) (delivery|shipping|returns)\b/i, weight: 2, name: 'free_delivery' },
  { re: /\b(sale|clearance|deal|offer|discount|save)\b/i, weight: 1, name: 'sale_word' },
  { re: /\bmember(s)? (price|only|exclusive)\b|\bexclusive\b/i, weight: 1, name: 'exclusive' },
];

/**
 * Subjects that carry offer words but are never an actionable voucher.
 * A digest of deals is not a deal you hold.
 */
export const OFFER_ANTI_SIGNALS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /\b(newsletter|digest|round[- ]?up|weekly|monthly)\b/i, name: 'digest' },
  { re: /\bunsubscrib/i, name: 'unsubscribe' },
  { re: /\b(receipt|invoice|order (confirmation|shipped|dispatched)|your order)\b/i, name: 'transactional' },
  { re: /\b(security|password|verify your|sign[- ]?in)\b/i, name: 'account' },
];

/** Minimum score before an email is worth a model call. */
export const MIN_OFFER_SCORE = 3;

export interface OfferSignal {
  score: number;
  matched: string[];
  blocked: string[];
}

/**
 * Does this subject line look like it carries an offer? PURE — the whole point
 * of stage one is that it costs nothing and can be tested exhaustively.
 */
export function scoreOfferSubject(subject: string | null | undefined): OfferSignal {
  const text = (subject ?? '').trim();
  if (!text) return { score: 0, matched: [], blocked: [] };

  const blocked = OFFER_ANTI_SIGNALS.filter((s) => s.re.test(text)).map((s) => s.name);
  const matched = OFFER_SIGNALS.filter((s) => s.re.test(text));
  const score = matched.reduce((a, s) => a + s.weight, 0);

  // An anti-signal does not veto outright — "Final call: your £10 Hotels.com
  // Cash is expiring" is a real voucher inside what is technically a marketing
  // blast. It costs points, so a weak match falls below the bar and a strong
  // one survives.
  return {
    score: Math.max(0, score - blocked.length * 2),
    matched: matched.map((s) => s.name),
    blocked,
  };
}

/** Stable identity for an offer, so a merchant re-sending it does not create a
 *  second row. Day-resolution on the expiry: the same voucher quoted at
 *  different times of day is one voucher. */
export function offerDedupeKey(o: {
  merchant: string;
  code?: string | null;
  expiresAt?: Date | null;
}): string {
  const merchant = o.merchant.trim().toLowerCase().replace(/\s+/g, ' ');
  const code = (o.code ?? '').trim().toUpperCase();
  const day = o.expiresAt ? o.expiresAt.toISOString().slice(0, 10) : 'nodate';
  return `${merchant}|${code}|${day}`;
}

export interface ExtractedOffer {
  merchant: string;
  summary: string;
  code: string | null;
  expiresAt: Date | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Parse the extractor's JSON. Separated out and pure so the failure modes are
 * testable — a model returning prose, a fenced block, a null merchant, or a
 * date it invented.
 */
export function parseExtraction(raw: string, now: Date): ExtractedOffer | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (obj.isOffer === false) return null;

  const merchant = typeof obj.merchant === 'string' ? obj.merchant.trim() : '';
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  // No merchant means nothing can ever match a place to it, so the row would
  // sit there forever being useless. Dropped rather than stored.
  if (!merchant || !summary) return null;

  let expiresAt: Date | null = null;
  if (typeof obj.expiresAt === 'string' && obj.expiresAt.trim()) {
    const d = new Date(obj.expiresAt.trim());
    if (!Number.isNaN(d.getTime())) {
      // A date more than a year out is a model hallucinating a far-future
      // default rather than reading one. Treated as no date at all.
      const yearOut = now.getTime() + 365 * 86_400_000;
      expiresAt = d.getTime() > yearOut ? null : d;
    }
  }

  const conf = typeof obj.confidence === 'string' ? obj.confidence.toLowerCase() : 'medium';
  const confidence: ExtractedOffer['confidence'] =
    conf === 'high' ? 'high' : conf === 'low' ? 'low' : 'medium';

  return {
    merchant: merchant.slice(0, 120),
    summary: summary.slice(0, 300),
    code: typeof obj.code === 'string' && obj.code.trim() ? obj.code.trim().slice(0, 60) : null,
    expiresAt,
    confidence,
  };
}

const EXTRACT_SYSTEM = `You read one marketing email and extract the offer, if there is one.

Reply with ONLY a JSON object, no prose and no code fence:
{"isOffer": true|false, "merchant": string, "summary": string, "code": string|null, "expiresAt": "YYYY-MM-DD"|null, "confidence": "high"|"medium"|"low"}

Rules:
- "merchant" is the BRAND as a person would say it — "Sports Direct", not "email.sportsdirect.com".
- "summary" is the offer in under 12 words, e.g. "£10 off orders over £50".
- "expiresAt" ONLY if the email states a date. Never estimate one, never assume 30 days. Null if unstated.
- "code" ONLY if a literal discount code appears. Null otherwise.
- "confidence" is "high" only when merchant AND a specific discount are both unambiguous.
- If this is a newsletter, a receipt, or general advertising with no specific redeemable offer, reply {"isOffer": false}.`;

export interface ScanCandidate {
  noteId: string;
  title: string;
  body: string;
  senderDomain: string | null;
  sourceUrl: string | null;
  observedAt: Date | null;
  signal: OfferSignal;
}

/** Stage one: bulk email from the window, scored, best first. Free. */
export async function findOfferCandidates(limit = MAX_EXTRACT_PER_RUN): Promise<ScanCandidate[]> {
  const since = new Date(Date.now() - SCAN_DAYS * 86_400_000);

  const rows = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      rawContent: intelNotes.rawContent,
      metadata: intelNotes.metadata,
      observedAt: intelNotes.observedAt,
      createdAt: intelNotes.createdAt,
    })
    .from(intelNotes)
    .where(
      and(
        eq(intelNotes.source, 'email'),
        // The ingest already classified these; re-running the classifier here
        // would be a second opinion nobody asked for.
        sql`${intelNotes.metadata}->>'emailKind' = 'bulk'`,
        isNotNull(intelNotes.title),
        gte(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`, since),
      ),
    )
    .orderBy(desc(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`))
    .limit(400);

  // Already-known notes are skipped, so a nightly scan does not re-extract the
  // same email every night for a month.
  const seen = new Set(
    (await db.select({ noteId: daydreamOffers.noteId }).from(daydreamOffers))
      .map((r) => r.noteId)
      .filter((v): v is string => !!v),
  );

  return rows
    .filter((r) => !seen.has(r.id))
    .map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        noteId: r.id,
        title: r.title ?? '',
        body: (r.rawContent ?? '').slice(0, 2500),
        senderDomain: typeof meta.senderDomain === 'string' ? meta.senderDomain : null,
        sourceUrl: typeof meta.sourceUrl === 'string' ? meta.sourceUrl : null,
        observedAt: r.observedAt ?? r.createdAt,
        signal: scoreOfferSubject(r.title),
      };
    })
    .filter((c) => c.signal.score >= MIN_OFFER_SCORE)
    .sort((a, b) => b.signal.score - a.signal.score)
    .slice(0, limit);
}

/** Stage two: hand one candidate to the model. */
export async function extractOffer(
  candidate: ScanCandidate,
  now = new Date(),
): Promise<{ offer: ExtractedOffer | null; tokens: number; error: string | null }> {
  try {
    const model = await resolveDaydreamModel();
    const { client, model: modelId } = await getLLMClient(model);
    const res = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        {
          role: 'user',
          content: `FROM: ${candidate.senderDomain ?? 'unknown'}\nSUBJECT: ${candidate.title}\n\n${candidate.body}`,
        },
      ],
      temperature: 0,
      max_tokens: 220,
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const tokens = (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);
    return { offer: parseExtraction(raw, now), tokens, error: null };
  } catch (err) {
    return { offer: null, tokens: 0, error: errMsg(err) };
  }
}

/** Store one, or update the row a re-send matches. */
export async function saveOffer(
  offer: ExtractedOffer,
  candidate: ScanCandidate,
): Promise<'created' | 'updated'> {
  const dedupeKey = offerDedupeKey(offer);
  const existing = await db
    .select({ id: daydreamOffers.id })
    .from(daydreamOffers)
    .where(eq(daydreamOffers.dedupeKey, dedupeKey))
    .limit(1);

  const values = {
    merchant: offer.merchant,
    summary: offer.summary,
    code: offer.code,
    expiresAt: offer.expiresAt,
    confidence: offer.confidence,
    noteId: candidate.noteId,
    sourceUrl: candidate.sourceUrl,
    senderDomain: candidate.senderDomain,
    dedupeKey,
    observedAt: candidate.observedAt,
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db.update(daydreamOffers).set(values).where(eq(daydreamOffers.id, existing[0].id));
    return 'updated';
  }
  await db.insert(daydreamOffers).values(values).onConflictDoNothing({ target: daydreamOffers.dedupeKey });
  return 'created';
}

/** Mark anything past its stated date. Runs before every read, so an expired
 *  voucher cannot be offered even if the sweep has not run. */
export async function expireOffers(now = new Date()): Promise<number> {
  const rows = await db
    .update(daydreamOffers)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(daydreamOffers.status, 'active'),
        isNotNull(daydreamOffers.expiresAt),
        lt(daydreamOffers.expiresAt, now),
      ),
    )
    .returning({ id: daydreamOffers.id });
  return rows.length;
}

/**
 * Offers the snapshot may show a detector.
 *
 * Low-confidence rows are excluded outright rather than passed through with a
 * flag: `near_offer` is a push-by-default detector, and "I am fairly sure you
 * have a voucher" is not worth a buzz in a pocket.
 */
export async function listActiveOffers(limit = 50) {
  await expireOffers();
  return db
    .select()
    .from(daydreamOffers)
    .where(
      and(
        eq(daydreamOffers.status, 'active'),
        or(eq(daydreamOffers.confidence, 'high'), eq(daydreamOffers.confidence, 'medium')),
      ),
    )
    .orderBy(desc(daydreamOffers.observedAt))
    .limit(limit);
}
