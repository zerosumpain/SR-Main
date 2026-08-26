// src/lib/daydream/spend/extract.ts
//
// Reading what was actually spent out of what was actually a receipt.
//
// The whole difficulty is telling a payment from an advertisement. An audit of
// production found 605 email notes containing a currency amount and only 34 of
// them receipt-shaped; the rest were prices being offered, not paid — "Price
// reduced by £34.30", "Luxury Escapes From £879pp", "Up to 12 months at 0%". A
// naive extractor over "emails mentioning money" produces a spend series that
// tracks marketing volume, correlates convincingly with all sorts of things,
// and is false in every particular.
//
// Two gates, in this order, and the second is the one that matters:
//
//   1. A free subject-line shortlist. No model sees a message that does not
//      look like a receipt, which also keeps the cost near zero.
//   2. The extracted amount must appear VERBATIM in the source text. A model
//      that invents, mis-reads or helpfully totals something gets its row
//      quarantined rather than stored. Code checks this, never the model.
//
// PURE parts live here; the model call is in ./read.ts.

/** Subject lines that suggest a payment happened. */
export const RECEIPT_SIGNALS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /\b(receipt|invoice)\b/i, name: 'receipt' },
  { re: /\byour (order|purchase|payment|booking)\b/i, name: 'your-order' },
  { re: /\border (confirmation|confirmed|placed|#\d)/i, name: 'order-confirmation' },
  { re: /\b(payment (received|taken|confirmation)|thanks for your (order|payment|purchase))\b/i, name: 'payment' },
  { re: /\b(dispatched|shipped|on its way|out for delivery)\b/i, name: 'dispatch' },
];

/**
 * Subject lines that mean money is being ADVERTISED, not spent.
 *
 * Checked after the signals and allowed to veto, because a marketing subject
 * that happens to contain the word "order" ("order now and save") is far more
 * common than a receipt that happens to contain "sale".
 */
export const ADVERT_SIGNALS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /\b(sale|deal|offer|discount|voucher|promo|% off|save (up to|£|\$))\b/i, name: 'promotion' },
  { re: /\b(price (drop|reduced)|now only|from £|from \$)\b/i, name: 'advertised-price' },
  { re: /\b(newsletter|unsubscribe to stop|recommended for you|you might like)\b/i, name: 'newsletter' },
  { re: /\b(quote|pre-approved|apply now|0% (apr|interest|transfer))\b/i, name: 'finance-marketing' },
  { re: /\b(expiring|last chance|final call|ends (today|soon))\b/i, name: 'urgency-marketing' },
];

export interface Shortlist {
  isCandidate: boolean;
  matched: string[];
  vetoed: string[];
}

/** Does this look like a receipt, cheaply and with no model? */
export function shortlist(subject: string): Shortlist {
  const matched = RECEIPT_SIGNALS.filter((s) => s.re.test(subject)).map((s) => s.name);
  const vetoed = ADVERT_SIGNALS.filter((s) => s.re.test(subject)).map((s) => s.name);
  return { isCandidate: matched.length > 0 && vetoed.length === 0, matched, vetoed };
}

/** Currency symbols this understands, and what they mean. */
const CURRENCY: Record<string, string> = { '£': 'GBP', $: 'USD', '€': 'EUR' };

export interface ParsedAmount {
  amountMinor: number;
  currency: string;
  /** The exact substring it was read from. */
  evidence: string;
}

/**
 * Every currency amount in a body of text, as integer minor units.
 *
 * Minor units on purpose: money in floating point is a rounding error waiting
 * to be summed, and this table exists to be summed.
 */
export function findAmounts(text: string): ParsedAmount[] {
  const out: ParsedAmount[] = [];
  const re = /([£$€])\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const symbol = m[1];
    const whole = Number(m[2].replace(/,/g, ''));
    const pence = m[3] ? Number(m[3]) : 0;
    if (!Number.isFinite(whole)) continue;
    out.push({
      amountMinor: whole * 100 + pence,
      currency: CURRENCY[symbol] ?? 'GBP',
      evidence: m[0],
    });
  }
  return out;
}

/**
 * Does the claimed amount actually appear in the source?
 *
 * The grounding check, and the reason a model is allowed near this at all. It
 * compares VALUES rather than strings, so "£1,234.00" in the mail and 123400
 * from the model agree, while a total the model computed itself — the most
 * likely and most dangerous error — appears nowhere and is rejected.
 */
export function verifyAmount(
  text: string,
  claim: { amountMinor: number; currency: string },
): { ok: boolean; evidence: string | null } {
  for (const found of findAmounts(text)) {
    if (found.amountMinor === claim.amountMinor && found.currency === claim.currency) {
      return { ok: true, evidence: found.evidence };
    }
  }
  return { ok: false, evidence: null };
}

/** Pretty, for the page. Never used for arithmetic. */
export function formatAmount(amountMinor: number, currency = 'GBP'): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  return `${symbol}${(amountMinor / 100).toFixed(2)}`;
}

/**
 * How usable this data is as a daily series.
 *
 * Reported rather than assumed, because the decision to let spend into the
 * correlation sweep should be a number on a page. Four receipts a week is nulls
 * on most days: every question asked of it comes back underpowered at best and
 * spurious at worst.
 */
export const MIN_RECEIPTS_PER_WEEK_FOR_SWEEP = 12;

export function spendDensity(receipts: number, days: number) {
  const perWeek = days > 0 ? (receipts / days) * 7 : 0;
  return {
    receipts,
    days,
    perWeek: Math.round(perWeek * 10) / 10,
    readyForSweep: perWeek >= MIN_RECEIPTS_PER_WEEK_FOR_SWEEP,
    needed: MIN_RECEIPTS_PER_WEEK_FOR_SWEEP,
  };
}
