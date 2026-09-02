// The money room's own rollup: 30 days of verified spend, grouped.
//
// `loadMoney()` already returns the 30-day TOTAL and the top merchants by
// value, but the rows it hands the page are `slice(0, 40)` — a display cap.
// The source split (bank / PayPal / receipt) lives in `source_note_id`'s
// prefix and was only ever derived on those forty rows, so counting it in the
// browser would have quietly reported a fortnight of receipts as "the last
// forty rows". These are grouped queries over the whole window instead: three
// numbers per source, five merchants with a row count each.
//
// Room-local by design. Nothing outside `/jkai/daydreams/money` reads it, and
// `ledger.ts` is not the place for a query one page needs.
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "$lib/db";
import { daydreamSpend } from "$lib/db/schema";

/** The three rails a verified row can arrive on, in the order they render. */
export const SPEND_SOURCES = ["bank", "paypal", "receipt"] as const;
export type SpendSource = (typeof SPEND_SOURCES)[number];

export interface SourceRollup {
  source: SpendSource;
  /** Rows in the window. A zero is a fact: it says that rail delivered nothing. */
  count: number;
  minor: number;
}

export interface MerchantRollup {
  merchant: string;
  minor: number;
  count: number;
}

export interface SpendRollup {
  sources: SourceRollup[];
  merchants: MerchantRollup[];
  /** Every verified row in the window, not the forty the table shows. */
  totalCount: number;
}

export function emptySpendRollup(): SpendRollup {
  return { sources: [], merchants: [], totalCount: 0 };
}

/**
 * Thirty days of verified spend, split by rail and by merchant.
 *
 * Same window and same predicate as `loadMoney` — verified rows only, day on
 * or after the floor — so the cells add up to the deck's headline figure
 * rather than to something near it.
 */
export async function loadSpendRollup(): Promise<SpendRollup> {
  const floor30 = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const inWindow = and(
    eq(daydreamSpend.verified, true),
    gte(daydreamSpend.day, floor30),
  );

  // The prefix convention is written by the bank pull and the PayPal reader;
  // anything without one came from the email receipt reader.
  const sourceExpr = sql<string>`case
    when ${daydreamSpend.sourceNoteId} like 'truelayer:%' then 'bank'
    when ${daydreamSpend.sourceNoteId} like 'paypal:%' then 'paypal'
    else 'receipt' end`;

  const [bySource, byMerchant] = await Promise.all([
    db
      .select({
        source: sourceExpr,
        count: sql<number>`count(*)::int`,
        minor: sql<number>`coalesce(sum(${daydreamSpend.amountMinor}), 0)::int`,
      })
      .from(daydreamSpend)
      .where(inWindow)
      .groupBy(sourceExpr),
    db
      .select({
        merchant: daydreamSpend.merchant,
        count: sql<number>`count(*)::int`,
        minor: sql<number>`coalesce(sum(${daydreamSpend.amountMinor}), 0)::int`,
      })
      .from(daydreamSpend)
      .where(inWindow)
      .groupBy(daydreamSpend.merchant)
      .orderBy(sql`coalesce(sum(${daydreamSpend.amountMinor}), 0) desc`)
      .limit(5),
  ]);

  const found = new Map(bySource.map((r) => [r.source, r]));
  return {
    // Padded to all three, always. A rail that produced nothing is the fact
    // the money tab exists to show — hiding its cell makes an unarmed bank
    // pull look exactly like a working one.
    sources: SPEND_SOURCES.map((source) => ({
      source,
      count: Number(found.get(source)?.count ?? 0),
      minor: Number(found.get(source)?.minor ?? 0),
    })),
    merchants: byMerchant.map((m) => ({
      merchant: m.merchant,
      minor: Number(m.minor),
      count: Number(m.count),
    })),
    totalCount: bySource.reduce((a, r) => a + Number(r.count), 0),
  };
}
