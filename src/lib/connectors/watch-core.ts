/**
 * The connector watcher's decisions, with no I/O — so every one of them can be
 * tested without a database, a probe or a phone.
 *
 * `planWatch` takes what the probes just saw and what the watcher last wrote
 * down, and answers: which connectors are newly broken, which are still broken,
 * which recovered, and which of the broken ones are due a message now.
 */

import { isAuthLapse, needsOwner, type ConnectorReport } from './types';

export const SITE_URL = 'https://strangeramblings.com';
export const DASHBOARD_PATH = '/admin/connections';

/**
 * What the watcher remembers about one connector that needs the owner.
 *
 * Stored as the snapshot of a `notification_watermarks` row, id
 * `connector:<key>`. A connector with no row is fine; the row is deleted on
 * recovery, so the table only ever holds what is currently waiting on you.
 */
export interface ConnectorMark {
  key: string;
  label: string;
  group: string;
  /** True when the fix is signing in again, not waiting for something to come back. */
  auth: boolean;
  detail: string;
  fixHint: string | null;
  fixUrl: string | null;
  /** First check that saw it broken, ISO. */
  brokenSince: string;
  /** Consecutive checks that have seen it broken. */
  strikes: number;
  /** When the owner was last told, ISO; null means not yet. */
  lastNotifiedAt: string | null;
  checkedAt: string;
}

/**
 * How many consecutive broken checks an OUTAGE needs before it is reported.
 *
 * A lapsed grant is deterministic — Google says `invalid_grant` every time
 * until someone signs in again — so it is reported on the first sighting. An
 * outage is often not: one timed-out Home Assistant round trip over Tailscale
 * is not worth a WhatsApp at 3am. Two checks is half an hour; the old daily
 * monitor would have taken up to a day.
 */
export const OUTAGE_STRIKES = 2;

/** Is this mark something the owner should be told about (and shown) yet? */
export function isConfirmed(mark: Pick<ConnectorMark, 'auth' | 'strikes'>): boolean {
  return mark.auth || mark.strikes >= OUTAGE_STRIKES;
}

export interface WatchPlan {
  /** Every connector that needs the owner, as it should now be stored. */
  marks: ConnectorMark[];
  /** Keys whose stored mark should be deleted — recovered, or no longer probed. */
  clear: string[];
  /** Became confirmed on this check: emit `connector.broken`. */
  broke: ConnectorMark[];
  /** Were confirmed, and the probe now says they are not broken: emit `connector.recovered`. */
  recovered: ConnectorMark[];
  /** Confirmed and due a message now (first time, or the reminder is due). */
  due: ConnectorMark[];
}

export function planWatch(
  reports: ConnectorReport[],
  previous: ReadonlyMap<string, ConnectorMark>,
  now: Date,
  remindAfterMs: number,
): WatchPlan {
  const at = now.toISOString();
  const marks: ConnectorMark[] = [];
  const broke: ConnectorMark[] = [];
  const due: ConnectorMark[] = [];
  const seen = new Set<string>();

  for (const report of reports) {
    seen.add(report.key);
    if (!needsOwner(report)) continue;
    const prior = previous.get(report.key);
    const mark: ConnectorMark = {
      key: report.key,
      label: report.label,
      group: report.group,
      auth: isAuthLapse(report),
      detail: report.detail,
      fixHint: report.fixHint ?? null,
      fixUrl: report.fixUrl ?? null,
      brokenSince: prior?.brokenSince ?? at,
      strikes: (prior?.strikes ?? 0) + 1,
      lastNotifiedAt: prior?.lastNotifiedAt ?? null,
      checkedAt: report.checkedAt || at,
    };
    marks.push(mark);

    if (!isConfirmed(mark)) continue;
    if (!prior || !isConfirmed(prior)) broke.push(mark);

    const last = mark.lastNotifiedAt ? Date.parse(mark.lastNotifiedAt) : NaN;
    if (!Number.isFinite(last) || now.getTime() - last >= remindAfterMs) due.push(mark);
  }

  const stillBroken = new Set(marks.map((m) => m.key));
  const clear: string[] = [];
  const recovered: ConnectorMark[] = [];
  for (const [key, prior] of previous) {
    if (stillBroken.has(key)) continue;
    clear.push(key);
    // A connector that vanished from the probes (an account disconnected) was
    // not repaired, so it gets no "recovered" — just forgotten.
    if (seen.has(key) && isConfirmed(prior)) recovered.push(prior);
  }

  return { marks, clear, broke, recovered, due };
}

/** Site-relative → absolute, for a phone that has no base URL to resolve against. */
export function absoluteUrl(path: string | null | undefined): string {
  const target = path && path.trim() ? path.trim() : DASHBOARD_PATH;
  if (/^https?:\/\//i.test(target)) return target;
  return SITE_URL + (target.startsWith('/') ? target : `/${target}`);
}

/** The notification for one mark. */
export function alertFor(mark: ConnectorMark): { title: string; body: string; url: string } {
  const title = mark.auth ? `${mark.label} needs re-authorising` : `${mark.label} is down`;
  const lines = [mark.detail];
  if (mark.fixHint) lines.push('', mark.fixHint);
  return { title, body: lines.join('\n'), url: absoluteUrl(mark.fixUrl) };
}

/** What `/api/native/connections` and the Today card show for one mark. */
export interface NeedsAttentionItem {
  id: string;
  label: string;
  group: string;
  status: 'auth_expired' | 'broken';
  detail: string;
  fixHint: string | null;
  fixUrl: string;
  since: string | null;
}

export function toAttentionItem(mark: ConnectorMark): NeedsAttentionItem {
  return {
    id: mark.key,
    label: mark.label,
    group: mark.group,
    status: mark.auth ? 'auth_expired' : 'broken',
    detail: mark.detail,
    fixHint: mark.fixHint,
    fixUrl: absoluteUrl(mark.fixUrl),
    since: mark.brokenSince ?? null,
  };
}

/**
 * The homepage banner's names, with everything the watcher is holding added.
 *
 * The banner reads stored state (no network on the front door), so on its own
 * it can miss a connector that only a live probe sees as broken — a dead Home
 * Assistant, a refused Whoop grant. Folding the watcher's confirmed marks in
 * guarantees that anything you were alerted about is also on the banner.
 * Gmail is named once however many accounts are marked, because the stored
 * half already says "Gmail".
 */
export function mergeBannerNames(stored: readonly string[], marks: readonly ConnectorMark[]): string[] {
  const names = [...stored];
  const have = new Set(names.map((n) => n.toLowerCase()));
  for (const mark of marks) {
    if (!isConfirmed(mark)) continue;
    const name = mark.key.startsWith('gmail') ? 'Gmail' : mark.label;
    if (have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}
