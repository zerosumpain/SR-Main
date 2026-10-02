// src/lib/daydream/spend/ledger.ts
//
// Which spend rows are money actually leaving, and which are only paperwork
// about it. PURE — the spend tool and the day features read the table, this
// file decides what each row is.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// `daydream_spend` holds three kinds of row in one shape (`bank.ts`):
//
//   • bank lines    `truelayer:<id>` — NatWest. The ledger: the hard truth.
//   • PayPal lines  `paypal:<id>`    — PayPal paying a merchant. Also ledger.
//   • email rows    an intel note id — a receipt, an invoice, a "you will be
//                                      charged" heads-up. Paperwork, never a
//                                      payment on its own.
//
// The spend tool used to strip that apart and total the lot, so a £79 Apple
// charge and the receipt Apple emailed about it read as "Apple: 2× £158", and
// the think loop raised "two £79 Apple charges on consecutive days" (owner,
// 2026-10-02). The Canva false alarm of August was the same misreading.
//
// PayPal is a second layer: it pays merchants itself, then recoups from
// NatWest — sometimes one bank line per purchase, sometimes one roll-up for
// several. Counting the bank's PayPal line AND the PayPal payments it funded
// spends the money twice. So when the PayPal rail is connected, a bank line to
// PayPal is a TOP-UP: matched to the payments it covers and kept out of totals.
// When it is not connected, that bank line is the only record of the purchase
// and counts as one.
//
// The rules, in the owner's words: the bank statement is the ledger of what
// went in and out; an email is either a heads-up of an incoming charge or a
// receipt for one.

export type SpendSource = 'bank' | 'paypal' | 'receipt';

export type LedgerRole =
  /** Money out: a bank line, a PayPal payment, or a bank-to-PayPal line when
   *  PayPal's own feed is not connected. */
  | 'charge'
  /** A bank line moving money to PayPal, covering PayPal payments. */
  | 'paypal_topup'
  /** An email matched to a ledger line — the same payment, seen again. */
  | 'receipt_confirms'
  /** An email with no ledger line: a heads-up, a card that is not connected,
   *  or a charge not taken yet. */
  | 'receipt_unmatched';

export interface SpendRow {
  id: string;
  sourceNoteId: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  day: string;
}

export interface LedgerLine extends SpendRow {
  source: SpendSource;
  role: LedgerRole;
  /** In the spend total for its day. True for charges and for unmatched
   *  emails (the only record of that spend); false for paperwork about a
   *  ledger line and for top-ups that fund PayPal payments. */
  counts: boolean;
  /** Backed by a bank or PayPal line. An unmatched email never is. */
  confirmed: boolean;
  /** Ids of the lines this one is paired with: a receipt's payment, a
   *  payment's receipts, a top-up's PayPal payments, a PayPal payment's top-up. */
  pairedWith: string[];
}

/** How far an email may sit from the ledger line it is about. Receipts tend to
 *  land on the day; bank lines post a day or three later. */
export const RECEIPT_WINDOW_DAYS = 5;
/** A roll-up top-up covers PayPal payments from up to this many days before
 *  it, and an instant top-up can post a little after the payment. */
export const TOPUP_LOOKBACK_DAYS = 10;
export const TOPUP_LOOKAHEAD_DAYS = 3;
/** Subset search over at most this many candidate payments per top-up. */
const TOPUP_MAX_CANDIDATES = 14;

export function spendSource(sourceNoteId: string): SpendSource {
  if (sourceNoteId.startsWith('truelayer:')) return 'bank';
  if (sourceNoteId.startsWith('paypal:')) return 'paypal';
  return 'receipt';
}

/** A bank line whose payee is PayPal. NatWest shows these as "PAYPAL *APPLE",
 *  "PayPal Europe", "PP*1234 …". */
export function isPayPalBankLine(row: Pick<SpendRow, 'sourceNoteId' | 'merchant'>): boolean {
  if (spendSource(row.sourceNoteId) !== 'bank') return false;
  return /pay\s*pal|^pp\s*\*/i.test(row.merchant);
}

const MERCHANT_NOISE = new Set([
  'ltd', 'limited', 'uk', 'gb', 'com', 'co', 'www', 'inc', 'plc', 'llc', 'the', 'bill', 'billing',
  'payment', 'payments', 'pay', 'paypal', 'pp', 'europe', 'sarl', 'online', 'store', 'services',
  'service', 'subscription', 'receipt', 'invoice', 'order', 'your', 'from',
]);

/** The words in a merchant name that identify it. */
export function merchantTokens(merchant: string): string[] {
  return merchant
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !MERCHANT_NOISE.has(t));
}

/** Do two merchant strings name the same business? "APPLE.COM/BILL" and
 *  "Apple Services" do; "PAYPAL *STEAM" and "Steam Games" do. */
export function sameMerchant(a: string, b: string): boolean {
  const ta = new Set(merchantTokens(a));
  if (!ta.size) return false;
  return merchantTokens(b).some((t) => ta.has(t));
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/**
 * Smallest set of payments that sums exactly to `target`, or null. Candidates
 * are few (≤ TOPUP_MAX_CANDIDATES), so an exhaustive search is cheap and,
 * unlike a greedy one, never misses a roll-up of non-adjacent payments.
 */
function subsetSumming(candidates: LedgerLine[], target: number): LedgerLine[] | null {
  const n = Math.min(candidates.length, TOPUP_MAX_CANDIDATES);
  let best: number | null = null;
  let bestCount = Infinity;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += candidates[i].amountMinor;
        count++;
      }
    }
    if (sum === target && count < bestCount) {
      best = mask;
      bestCount = count;
    }
  }
  if (best == null) return null;
  return candidates.slice(0, n).filter((_, i) => best! & (1 << i));
}

/**
 * Classify every row. Input order does not matter; output is newest first.
 *
 * `paypalConnected` is whether PayPal's own feed has EVER written a row — not
 * whether this window holds one. A quiet PayPal month must not turn every
 * top-up back into a purchase.
 */
export function reconcileSpend(rows: SpendRow[], opts: { paypalConnected: boolean }): LedgerLine[] {
  const lines: LedgerLine[] = rows
    .map((r) => {
      const source = spendSource(r.sourceNoteId);
      const topup = opts.paypalConnected && isPayPalBankLine(r);
      const role: LedgerRole = source === 'receipt' ? 'receipt_unmatched' : topup ? 'paypal_topup' : 'charge';
      return { ...r, source, role, counts: role !== 'paypal_topup', confirmed: source !== 'receipt', pairedWith: [] };
    })
    .sort((a, b) => (a.day === b.day ? a.id.localeCompare(b.id) : a.day < b.day ? 1 : -1));

  // ── Top-ups → the PayPal payments they fund ──
  // Oldest top-up first, so each payment is claimed by the earliest top-up
  // that can cover it.
  const funded = new Set<string>();
  const topups = lines.filter((l) => l.role === 'paypal_topup').reverse();
  for (const t of topups) {
    const td = dayNumber(t.day);
    const candidates = lines
      .filter(
        (l) =>
          l.source === 'paypal' &&
          !funded.has(l.id) &&
          l.currency === t.currency &&
          dayNumber(l.day) >= td - TOPUP_LOOKBACK_DAYS &&
          dayNumber(l.day) <= td + TOPUP_LOOKAHEAD_DAYS,
      )
      .sort((a, b) => Math.abs(dayNumber(a.day) - td) - Math.abs(dayNumber(b.day) - td));
    const single = candidates.find((c) => c.amountMinor === t.amountMinor);
    const covered = single ? [single] : subsetSumming(candidates, t.amountMinor);
    if (!covered) continue;
    for (const p of covered) {
      funded.add(p.id);
      p.pairedWith.push(t.id);
      t.pairedWith.push(p.id);
    }
  }

  // ── Emails → the ledger line each is about ──
  // A receipt pairs with a payment of the same amount nearby, preferring the
  // same merchant, then the nearest day. First pass one-to-one, so two real
  // charges with two receipts stay two charges; a second pass lets a leftover
  // email (an invoice AND a receipt for one payment) attach to a line that is
  // already confirmed — it is still paperwork, never a second payment.
  const ledger = lines.filter((l) => l.role === 'charge' || l.role === 'paypal_topup');
  const receipts = lines.filter((l) => l.source === 'receipt').reverse();
  const score = (r: LedgerLine, l: LedgerLine): number | null => {
    if (l.amountMinor !== r.amountMinor || l.currency !== r.currency) return null;
    const gap = Math.abs(dayNumber(l.day) - dayNumber(r.day));
    if (gap > RECEIPT_WINDOW_DAYS) return null;
    // A top-up is only a fall-back target: the receipt is for the merchant,
    // and PayPal's own line for that merchant is the better match.
    return (sameMerchant(r.merchant, l.merchant) ? 0 : 100) + (l.role === 'paypal_topup' ? 50 : 0) + gap;
  };
  const pair = (r: LedgerLine, allowTaken: boolean) => {
    let best: LedgerLine | null = null;
    let bestScore = Infinity;
    for (const l of ledger) {
      if (!allowTaken && l.pairedWith.some((id) => receipts.some((x) => x.id === id))) continue;
      const s = score(r, l);
      if (s != null && s < bestScore) {
        best = l;
        bestScore = s;
      }
    }
    if (!best) return false;
    r.role = 'receipt_confirms';
    r.counts = false;
    r.confirmed = true;
    r.pairedWith.push(best.id);
    best.pairedWith.push(r.id);
    return true;
  };
  const left = receipts.filter((r) => !pair(r, false));
  for (const r of left) pair(r, true);

  return lines;
}

// ── Words ──────────────────────────────────────────────────────────────────

/** The tags the spend tool prints. The double-check's money rule looks for
 *  them, so a "holds" verdict on a money claim is only kept when a ledger
 *  line was actually in front of the checker. */
export const LEDGER_TAGS = {
  bank: '[bank]',
  paypal: '[PayPal]',
  topup: '[bank→PayPal top-up]',
  receipt: '[email]',
} as const;

/** A dated line carrying a ledger tag — not the rule, which names the tags too. */
export function hasLedgerLine(text: string): boolean {
  return text
    .split('\n')
    .some((l) => /^\s+\d{4}-\d{2}-\d{2} /.test(l) && (l.includes(LEDGER_TAGS.bank) || l.includes(LEDGER_TAGS.paypal)));
}

export function money(minor: number, currency: string): string {
  return `${currency === 'GBP' ? '£' : `${currency} `}${(minor / 100).toFixed(2)}`;
}

/** The rule as the model reads it, at the head of every spend result. */
export const LEDGER_RULE =
  'The bank is the ledger: only [bank] and [PayPal] lines are payments. An [email] is a heads-up or a receipt — it confirms a payment, it is never a second one. PayPal is topped up from the bank, so a [bank→PayPal top-up] funds PayPal payments and is not a purchase of its own. Two payments means two ledger lines.';

/**
 * The spend tool's text. `filter` narrows what is SHOWN, never what is
 * reconciled — a receipt for Apple must still find the bank line that would
 * not match a merchant search, and a top-up must still find its payments.
 */
export function formatLedger(
  lines: LedgerLine[],
  opts: { days: number; since: string; filter?: (l: LedgerLine) => boolean; maxLines?: number },
): string {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const inWindow = lines.filter((l) => l.day >= opts.since);
  const shown = opts.filter
    ? inWindow.filter((l) => opts.filter!(l) || l.pairedWith.some((id) => byId.get(id) && opts.filter!(byId.get(id)!)))
    : inWindow;
  const max = opts.maxLines ?? 50;
  if (!shown.length) return '';

  const payments = shown.filter((l) => l.role === 'charge');
  const unmatched = shown.filter((l) => l.role === 'receipt_unmatched');
  const ledgerAny = lines.some((l) => l.source !== 'receipt');

  const out = [`Spend, last ${opts.days} days.`, LEDGER_RULE];
  if (!ledgerAny) {
    out.push('No bank or PayPal lines at all in this window — the bank feed may be off, so NOTHING below is confirmed.');
  }

  if (payments.length) {
    const byMerchant = new Map<string, { n: number; total: number; cur: string }>();
    for (const p of payments) {
      const m = byMerchant.get(p.merchant) ?? { n: 0, total: 0, cur: p.currency };
      m.n++;
      m.total += p.amountMinor;
      byMerchant.set(p.merchant, m);
    }
    out.push('Payments by merchant (ledger lines only, count, total):');
    for (const [name, m] of [...byMerchant.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
      out.push(`  ${name}: ${m.n}× ${money(m.total, m.cur)}`);
    }
  }

  const describe = (l: LedgerLine): string => {
    const head = `  ${l.day} ${l.merchant} ${money(l.amountMinor, l.currency)}`;
    const paired = l.pairedWith.map((id) => byId.get(id)).filter((x): x is LedgerLine => !!x);
    const ref = (p: LedgerLine) => `${p.merchant} ${money(p.amountMinor, p.currency)} on ${p.day}`;
    switch (l.role) {
      case 'paypal_topup':
        return paired.length
          ? `${head} ${LEDGER_TAGS.topup} — funds ${paired.length} PayPal payment${paired.length === 1 ? '' : 's'} (${paired.map(ref).join('; ')}). Not a purchase.`
          : `${head} ${LEDGER_TAGS.topup} — the PayPal payments it covers are outside this window. Not a purchase.`;
      case 'receipt_confirms':
        return `${head} ${LEDGER_TAGS.receipt} — about the ledger line ${paired.map(ref).join('; ')}. The same payment, not another.`;
      case 'receipt_unmatched':
        return `${head} ${LEDGER_TAGS.receipt} — no bank or PayPal line matches. A heads-up, a card that is not connected, or not taken yet. Unconfirmed.`;
      case 'charge': {
        const tag = l.source === 'paypal' ? LEDGER_TAGS.paypal : LEDGER_TAGS.bank;
        const via = l.source === 'bank' && isPayPalBankLine(l) ? ' Paid through PayPal (PayPal feed not connected).' : '';
        const topup = paired.find((p) => p.role === 'paypal_topup');
        const emails = paired.filter((p) => p.source === 'receipt');
        return `${head} ${tag}${via}${topup ? ` Funded by the bank top-up on ${topup.day}.` : ''}${emails.length ? ` ${emails.length === 1 ? 'An email' : `${emails.length} emails`} about it.` : ''}`;
      }
    }
  };

  const ledgerShown = shown.filter((l) => l.role === 'charge' || l.role === 'paypal_topup' || l.role === 'receipt_confirms');
  if (ledgerShown.length) {
    out.push('Lines, newest first:');
    for (const l of ledgerShown.slice(0, max)) out.push(describe(l));
  }
  if (unmatched.length) {
    out.push('Emails with no ledger line (NOT confirmed payments):');
    for (const l of unmatched.slice(0, Math.max(10, max - ledgerShown.length))) out.push(describe(l));
  }
  return out.join('\n');
}
