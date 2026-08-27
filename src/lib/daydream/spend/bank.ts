// src/lib/daydream/spend/bank.ts
//
// Turning bank-rail transactions into verified spend rows. PURE — the
// activity does the calling, this file does the reading, so the part that can
// misread a shape is unit-testable against captured payloads.
//
// The owner's D2 decision (2026-08-27): bank rails feed the SAME table the
// email-receipt extractor writes, in the same shape — minor units, local day,
// verbatim evidence. Two deliberate asymmetries with the email path:
//
//   • `verified` is true at birth. The email path quarantines a row until the
//     amount is found verbatim in the source because a model read it; here the
//     bank IS the source and no model is anywhere near the number.
//   • Only money going OUT is kept. The spend table models spending; salary
//     landing in the account is not a purchase, and letting credits in would
//     make every day-level sum meaningless.
//
// Dedupe rides the existing unique `source_note_id` column as
// `truelayer:<id>` / `paypal:<id>` — the column is plain text with no FK, and
// a prefixed id can never collide with an intel note's uuid.

import { LOCAL_TZ } from '../types';

export interface BankSpendRow {
  sourceNoteId: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  day: string;
  evidence: string;
}

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: LOCAL_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function localDayOf(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return dayFmt.format(new Date(ms));
}

function toMinor(value: number): number {
  return Math.round(Math.abs(value) * 100);
}

/**
 * Map one TrueLayer `/transactions` result. Returns null for anything that is
 * not an outgoing, parseable payment — a credit, a zero, a malformed row.
 */
export function fromTrueLayer(tx: Record<string, unknown>): BankSpendRow | null {
  const id = typeof tx.transaction_id === 'string' ? tx.transaction_id : null;
  const iso = typeof tx.timestamp === 'string' ? tx.timestamp : null;
  const amount = typeof tx.amount === 'number' ? tx.amount : null;
  const type = typeof tx.transaction_type === 'string' ? tx.transaction_type.toUpperCase() : null;
  if (!id || !iso || amount == null || amount === 0) return null;
  // TrueLayer marks direction with transaction_type; amounts are typically
  // negative for debits but not reliably so across providers — the type field
  // is the authority, the sign is corroboration.
  if (type !== 'DEBIT') return null;
  const day = localDayOf(iso);
  if (!day) return null;

  const description = typeof tx.description === 'string' ? tx.description : '';
  const merchant =
    (typeof tx.merchant_name === 'string' && tx.merchant_name.trim()) ||
    description.trim() ||
    'unknown merchant';
  const currency = typeof tx.currency === 'string' ? tx.currency : 'GBP';

  return {
    sourceNoteId: `truelayer:${id}`,
    merchant: merchant.slice(0, 200),
    amountMinor: toMinor(amount),
    currency,
    day,
    evidence: `${description || merchant} ${amount} ${currency}`.trim().slice(0, 500),
  };
}

/**
 * Map one PayPal Transaction Search row. PayPal signs the value: negative is
 * money out. Rows without a parseable negative value are dropped.
 */
export function fromPayPal(detail: Record<string, unknown>): BankSpendRow | null {
  const info = (detail.transaction_info ?? detail) as Record<string, unknown>;
  const id = typeof info.transaction_id === 'string' ? info.transaction_id : null;
  const iso =
    typeof info.transaction_initiation_date === 'string' ? info.transaction_initiation_date : null;
  const amountObj = info.transaction_amount as Record<string, unknown> | undefined;
  const valueStr = typeof amountObj?.value === 'string' ? amountObj.value : null;
  const value = valueStr != null ? Number(valueStr) : NaN;
  if (!id || !iso || !Number.isFinite(value) || value >= 0) return null;
  const day = localDayOf(iso);
  if (!day) return null;

  const payee = (detail.payee_info ?? {}) as Record<string, unknown>;
  const payer = (detail.payer_info ?? {}) as Record<string, unknown>;
  const merchant =
    (typeof info.transaction_subject === 'string' && info.transaction_subject.trim()) ||
    (typeof payee.payee_display_name === 'string' && payee.payee_display_name.trim()) ||
    (typeof payer.payer_name === 'object' &&
      typeof (payer.payer_name as Record<string, unknown>)?.alternate_full_name === 'string' &&
      ((payer.payer_name as Record<string, unknown>).alternate_full_name as string)) ||
    'paypal payment';
  const currency = typeof amountObj?.currency_code === 'string' ? amountObj.currency_code : 'GBP';

  return {
    sourceNoteId: `paypal:${id}`,
    merchant: String(merchant).slice(0, 200),
    amountMinor: toMinor(value),
    currency,
    day,
    evidence: `${String(merchant)} ${valueStr} ${currency}`.trim().slice(0, 500),
  };
}

/** The YYYY-MM-DD window for a nightly pull: `days` back to today, local. */
export function pullWindow(now: Date, days: number): { from: string; to: string } {
  return {
    from: dayFmt.format(new Date(now.getTime() - days * 86_400_000)),
    to: dayFmt.format(now),
  };
}
