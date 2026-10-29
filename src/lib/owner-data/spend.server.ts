// src/lib/owner-data/spend.server.ts
//
// The owner's spend: verified `daydream_spend` rows, RECONCILED — bank and
// PayPal lines are payments, an email is paperwork about one, a bank top-up of
// PayPal funds PayPal payments (`./ledger`). The quarantine
// (`verified = false`) is the extractor's whole point. Shared by the think loop
// (`$lib/daydream/think/reads` re-exports it) and chat's `spend_ledger`
// (`./chat-tools`) — overhaul plan 2026-10-28, P2-2.

import { localDay } from './day';
import { formatLedger, sameMerchant } from './ledger';
import { loadLedger } from './ledger.server';

function clampInt(raw: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
}

export async function spendTool(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const days = clampInt(args.days, 7, 180, 60);
  const q = typeof args.merchant === 'string' ? args.merchant.trim().slice(0, 80) : '';
  const floor = localDay(new Date(now.getTime() - days * 86_400_000));
  // Reconciled BEFORE the merchant filter: a receipt for "Apple" must still
  // find the bank line, and a top-up its PayPal payments (`ledger.ts`).
  const lines = await loadLedger(floor);
  const needle = q.toLowerCase();
  const text = formatLedger(lines, {
    days,
    since: floor,
    filter: q ? (l) => l.merchant.toLowerCase().includes(needle) || sameMerchant(l.merchant, q) : undefined,
  });
  return text || `No verified spend in the last ${days} days${q ? ` matching "${q}"` : ''}. Absence of evidence, not of spending.`;
}
