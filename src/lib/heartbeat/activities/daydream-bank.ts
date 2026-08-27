import { getSetting } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { daydreamSpend } from '$lib/db/schema';
import { fromPayPal, fromTrueLayer, pullWindow, type BankSpendRow } from '$lib/daydream/spend/bank';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-bank';

/** Off by default — the owner's D2 decision put the rails behind a toggle. */
export const BANK_ENABLED_KEY = 'daydream.bank.enabled';

interface BankConfig {
  /** Days of history each nightly pull covers. Overlap is free: rows dedupe
   *  on source id, so a wide window heals gaps rather than double-counting. */
  windowDays?: number;
}

const DEFAULTS: Required<BankConfig> = { windowDays: 7 };

async function upsertRows(rows: BankSpendRow[]): Promise<number> {
  let written = 0;
  for (const row of rows) {
    const inserted = await db
      .insert(daydreamSpend)
      .values({
        ...row,
        // The bank IS the source; no model touched the number. See bank.ts.
        verified: true,
      })
      .onConflictDoNothing({ target: daydreamSpend.sourceNoteId })
      .returning({ id: daydreamSpend.id });
    written += inserted.length;
  }
  return written;
}

/** A 401/403 from a rail is a dead token, and a dead token must be LOUD:
 *  TrueLayer rotates its refresh token on every exchange, so once it slips it
 *  stays slipped until the owner re-links at /admin/connections. */
function isAuthFailure(status: number | undefined, error: string | undefined): boolean {
  if (status === 401 || status === 403) return true;
  return /invalid_grant|unauthorized|expired/i.test(error ?? '');
}

/**
 * Nightly pull of real spend from the bank rails into the verified-spend
 * table — the same rows, the same units, the same day-keying the email
 * receipt extractor writes, so everything downstream reads one table.
 *
 * Deliberately NOT in SPENDING_ACTIONS: it never calls a model, so it has no
 * quota to attribute — the caps meter model spend, not HTTP.
 */
export const daydreamBank: ActivityHandler = {
  name: NAME,
  description:
    'Pulls TrueLayer and PayPal transactions into the verified-spend table nightly. Off by default (daydream.bank.enabled); debits only, minor units, deduped on the transaction id. Fails LOUD on a dead token — TrueLayer rotation means silence would never heal. No LLM.',
  defaultCadenceSeconds: 24 * 3600,
  defaultEnabled: true,
  defaultActiveHours: { start: '05:00', end: '07:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as BankConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }
    // Unset means OFF here, the inverse of the daydream master switch: bank
    // access is the one feed the owner opted to arm explicitly.
    const bankEnabled = await getSetting<boolean>(BANK_ENABLED_KEY);
    if (bankEnabled !== true) {
      return { outcome: 'skipped', summary: `bank rails off (${BANK_ENABLED_KEY} not true)` };
    }

    const { callIntegration } = await import('$lib/apis/integrations');
    const now = new Date(ctx.now);
    const window = pullWindow(now, cfg.windowDays);
    const notes: string[] = [];
    const errors: string[] = [];
    let authDead = false;
    let written = 0;

    // ── TrueLayer: accounts, then transactions per account ──
    try {
      const accounts = await callIntegration({ key: 'truelayer-accounts' });
      if (!accounts.success) {
        if (isAuthFailure(accounts.status, accounts.error)) authDead = true;
        errors.push(`truelayer-accounts: ${accounts.error ?? `status ${accounts.status}`}`);
      } else {
        const list = ((accounts.json as { results?: unknown[] })?.results ?? []) as Array<
          Record<string, unknown>
        >;
        for (const account of list) {
          const accountId = typeof account.account_id === 'string' ? account.account_id : null;
          if (!accountId) continue;
          const res = await callIntegration({
            key: 'truelayer-transactions',
            params: { account_id: accountId, from: window.from, to: window.to },
          });
          if (!res.success) {
            if (isAuthFailure(res.status, res.error)) authDead = true;
            errors.push(`truelayer ${accountId.slice(0, 8)}: ${res.error ?? `status ${res.status}`}`);
            continue;
          }
          const txs = ((res.json as { results?: unknown[] })?.results ?? []) as Array<
            Record<string, unknown>
          >;
          const rows = txs.map(fromTrueLayer).filter((r): r is BankSpendRow => r !== null);
          written += await upsertRows(rows);
          notes.push(`tl:${accountId.slice(0, 8)} ${txs.length}→${rows.length}`);
        }
      }
    } catch (err) {
      errors.push(`truelayer: ${errMsg(err)}`);
    }

    // ── PayPal ──
    try {
      const res = await callIntegration({
        key: 'paypal-transactions',
        params: {
          start_date: `${window.from}T00:00:00Z`,
          end_date: `${window.to}T23:59:59Z`,
        },
      });
      if (!res.success) {
        if (isAuthFailure(res.status, res.error)) authDead = true;
        errors.push(`paypal: ${res.error ?? `status ${res.status}`}`);
      } else {
        const details = ((res.json as { transaction_details?: unknown[] })?.transaction_details ??
          []) as Array<Record<string, unknown>>;
        const rows = details.map(fromPayPal).filter((r): r is BankSpendRow => r !== null);
        written += await upsertRows(rows);
        notes.push(`pp ${details.length}→${rows.length}`);
      }
    } catch (err) {
      errors.push(`paypal: ${errMsg(err)}`);
    }

    const summary = [
      `${written} new spend rows (${window.from}..${window.to})`,
      ...notes,
      ...(authDead
        ? ['TOKEN DEAD — re-link at /admin/connections; this will not heal on its own']
        : []),
      ...(errors.length && !authDead ? [errors[0]] : []),
    ].join(' · ');

    // A dead token or a run where every rail failed is a fault worth a red
    // pulse. A rail returning zero transactions in a quiet week is not.
    const outcome = authDead || (errors.length > 0 && written === 0 && notes.length === 0) ? 'error' : 'ok';
    return { outcome, summary, details: { written, window, notes, errors, authDead } };
  },
};
