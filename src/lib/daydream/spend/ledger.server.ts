// src/lib/daydream/spend/ledger.server.ts
//
// The one read behind every reconciled view of spend. Rules in `ledger.ts`.

import { and, eq, gte, like, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamSpend } from '$lib/db/schema';
import { reconcileSpend, TOPUP_LOOKBACK_DAYS, RECEIPT_WINDOW_DAYS, type LedgerLine } from './ledger';

/** Rows read before the window so a line on its first day can still find its
 *  receipt or its top-up's payments. */
const MARGIN_DAYS = Math.max(TOPUP_LOOKBACK_DAYS, RECEIPT_WINDOW_DAYS);
/** A day's spend rows number in the tens; this is a ceiling, not a page. */
const ROW_CAP = 2000;

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Has PayPal's own feed ever written a row? Decides whether a bank line to
 *  PayPal is a top-up or the only record of a purchase. */
async function paypalConnected(): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(daydreamSpend)
    .where(like(daydreamSpend.sourceNoteId, 'paypal:%'))
    .limit(1);
  return rows.length > 0;
}

/** Every verified row from `sinceDay` (local), reconciled — plus a margin
 *  before it, read so a line on the first day can still find its partner.
 *  Callers cut to their window AFTER reconciling (`formatLedger` takes
 *  `since`); cutting first would orphan exactly those pairs. */
export async function loadLedger(sinceDay: string): Promise<LedgerLine[]> {
  const [rows, paypal] = await Promise.all([
    db
      .select({
        id: daydreamSpend.id,
        sourceNoteId: daydreamSpend.sourceNoteId,
        merchant: daydreamSpend.merchant,
        amountMinor: daydreamSpend.amountMinor,
        currency: daydreamSpend.currency,
        day: daydreamSpend.day,
      })
      .from(daydreamSpend)
      .where(and(eq(daydreamSpend.verified, true), gte(daydreamSpend.day, shiftDay(sinceDay, -MARGIN_DAYS))))
      .limit(ROW_CAP),
    paypalConnected(),
  ]);
  return reconcileSpend(rows, { paypalConnected: paypal });
}
