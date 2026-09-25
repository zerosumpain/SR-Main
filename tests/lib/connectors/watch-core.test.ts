import { describe, it, expect } from 'vitest';
import {
  absoluteUrl,
  alertFor,
  mergeBannerNames,
  planWatch,
  toAttentionItem,
  type ConnectorMark,
} from '$lib/connectors/watch-core';
import { brokenOf, isAuthLapse, needsOwner, type ConnectorReport } from '$lib/connectors/types';

const HOUR = 60 * 60 * 1000;
const REMIND = 12 * HOUR;
const T0 = new Date('2026-09-25T07:40:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

const r = (over: Partial<ConnectorReport>): ConnectorReport => ({
  key: 'k',
  label: 'Thing',
  group: 'G',
  tier: 'account',
  status: 'ok',
  detail: 'fine',
  live: true,
  checkedAt: T0.toISOString(),
  ms: 10,
  ...over,
});

const gmailBroken = r({
  key: 'gmail:1',
  label: 'Gmail · me@example.com',
  group: 'Email',
  status: 'broken',
  detail: 'Gmail token refresh failed: invalid_grant',
  fixUrl: '/api/gmail/connect',
  fixHint: 'Re-authorise me@example.com',
});
const haDown = r({
  key: 'home-assistant',
  label: 'Home Assistant',
  group: 'Home',
  tier: 'service',
  status: 'broken',
  detail: 'http://ha returned 502 Bad Gateway',
  fixHint: 'Check the Tailscale route and that the token is still valid',
});

const asMap = (marks: ConnectorMark[]) => new Map(marks.map((m) => [m.key, m]));

/** Run one check and carry the marks forward, stamping what the watcher would stamp. */
function step(reports: ConnectorReport[], prev: Map<string, ConnectorMark>, at: Date) {
  const plan = planWatch(reports, prev, at, REMIND);
  for (const m of plan.due) m.lastNotifiedAt = at.toISOString();
  return { plan, next: asMap(plan.marks) };
}

describe('planWatch — when the owner is told', () => {
  it('tells exactly once on the transition into broken', () => {
    const { plan } = step([gmailBroken, r({ key: 'ok' })], new Map(), T0);
    expect(plan.due.map((m) => m.key)).toEqual(['gmail:1']);
    expect(plan.broke.map((m) => m.key)).toEqual(['gmail:1']);
    expect(plan.due[0].brokenSince).toBe(T0.toISOString());
  });

  it('stays quiet while still broken inside the reminder window', () => {
    const first = step([gmailBroken], new Map(), T0);
    for (const at of [later(30 * 60_000), later(6 * HOUR), later(REMIND - 60_000)]) {
      const { plan } = step([gmailBroken], first.next, at);
      expect(plan.due).toEqual([]);
      expect(plan.broke).toEqual([]);
      // brokenSince is kept, not reset each tick.
      expect(plan.marks[0].brokenSince).toBe(T0.toISOString());
    }
  });

  it('reminds once the window has passed, and then waits again', () => {
    const first = step([gmailBroken], new Map(), T0);
    const second = step([gmailBroken], first.next, later(REMIND));
    expect(second.plan.due.map((m) => m.key)).toEqual(['gmail:1']);
    expect(second.plan.broke).toEqual([]); // a reminder, not a new breakage
    const third = step([gmailBroken], second.next, later(REMIND + HOUR));
    expect(third.plan.due).toEqual([]);
  });

  it('clears the watermark on recovery and says nothing', () => {
    const first = step([gmailBroken], new Map(), T0);
    const { plan } = step([{ ...gmailBroken, status: 'ok', detail: 'authenticated' }], first.next, later(HOUR));
    expect(plan.due).toEqual([]);
    expect(plan.marks).toEqual([]);
    expect(plan.clear).toEqual(['gmail:1']);
    expect(plan.recovered.map((m) => m.key)).toEqual(['gmail:1']);
  });

  it('forgets a connector that is no longer probed without calling it recovered', () => {
    const first = step([gmailBroken], new Map(), T0);
    const { plan } = step([r({ key: 'other' })], first.next, later(HOUR));
    expect(plan.clear).toEqual(['gmail:1']);
    expect(plan.recovered).toEqual([]);
  });

  it('never alerts on unconfigured, degraded or dormant', () => {
    const reports = [
      r({ key: 'a', status: 'unconfigured', detail: 'no account connected', fixHint: 'Connect a Google account' }),
      r({ key: 'b', status: 'degraded', detail: 'invalid_grant soon', fixHint: 'Re-authorise' }),
      r({ key: 'c', status: 'dormant' }),
    ];
    let prev = new Map<string, ConnectorMark>();
    for (let i = 0; i < 4; i++) {
      const { plan, next } = step(reports, prev, later(i * REMIND));
      expect(plan.due).toEqual([]);
      expect(plan.marks).toEqual([]);
      prev = next;
    }
  });

  it('waits for a second broken check before calling an OUTAGE, but not an auth lapse', () => {
    const first = step([haDown, gmailBroken], new Map(), T0);
    expect(first.plan.due.map((m) => m.key)).toEqual(['gmail:1']);
    expect(first.plan.marks.map((m) => m.key).sort()).toEqual(['gmail:1', 'home-assistant']);

    const second = step([haDown, gmailBroken], first.next, later(30 * 60_000));
    expect(second.plan.due.map((m) => m.key)).toEqual(['home-assistant']);
    expect(second.plan.broke.map((m) => m.key)).toEqual(['home-assistant']);
    // It has been down since the first sighting, not the confirming one.
    expect(second.plan.due[0].brokenSince).toBe(T0.toISOString());
  });

  it('does not call a one-check blip "recovered" — nothing was ever said about it', () => {
    const first = step([haDown], new Map(), T0);
    const { plan } = step([{ ...haDown, status: 'ok' }], first.next, later(30 * 60_000));
    expect(plan.clear).toEqual(['home-assistant']);
    expect(plan.recovered).toEqual([]);
  });

  it('marks exactly the needsOwner set — the one predicate everything shares', () => {
    const reports = [
      gmailBroken,
      haDown,
      r({ key: 'x', status: 'degraded' }),
      r({ key: 'y', status: 'unconfigured' }),
      r({ key: 'z', status: 'ok' }),
    ];
    const { plan } = step(reports, new Map(), T0);
    expect(plan.marks.map((m) => m.key)).toEqual(reports.filter(needsOwner).map((x) => x.key));
    expect(brokenOf(reports).map((x) => x.key)).toEqual(reports.filter(needsOwner).map((x) => x.key));
  });
});

describe('what the alert says', () => {
  it('says "needs re-authorising" for a refused grant, with the fix and an absolute link', () => {
    const { plan } = step([gmailBroken], new Map(), T0);
    const alert = alertFor(plan.due[0]);
    expect(alert.title).toBe('Gmail · me@example.com needs re-authorising');
    expect(alert.body).toContain('invalid_grant');
    expect(alert.body).toContain('Re-authorise me@example.com');
    expect(alert.url).toBe('https://strangeramblings.com/api/gmail/connect');
  });

  it('says "is down" when it is not an auth problem', () => {
    const first = step([haDown], new Map(), T0);
    const { plan } = step([haDown], first.next, later(30 * 60_000));
    expect(alertFor(plan.due[0]).title).toBe('Home Assistant is down');
    expect(alertFor(plan.due[0]).url).toBe('https://strangeramblings.com/admin/connections');
  });
});

describe('isAuthLapse', () => {
  it('reads a refused grant as a lapse', () => {
    expect(isAuthLapse(gmailBroken)).toBe(true);
    expect(isAuthLapse(r({ status: 'broken', detail: 'token refresh failed: Whoop token refresh failed: 400 - invalid_grant' }))).toBe(true);
    expect(isAuthLapse(r({ status: 'broken', detail: 'sync 401', fixHint: 'reconnect to re-grant access' }))).toBe(true);
  });

  it('does not read a timeout as a lapse, even under a re-authorise hint', () => {
    expect(isAuthLapse(r({ status: 'broken', detail: 'Gmail token refresh failed: ETIMEDOUT', fixHint: 'Re-authorise x' }))).toBe(false);
  });

  it('does not read "reconnecting will not help" as a lapse', () => {
    expect(
      isAuthLapse(
        r({
          status: 'broken',
          detail: 'Whoop has marked the API application inactive',
          fixHint: 'Reconnecting will not help — re-activate it in the Whoop developer settings.',
        }),
      ),
    ).toBe(false);
  });

  it('is never true for something that is not broken', () => {
    expect(isAuthLapse({ ...gmailBroken, status: 'degraded' })).toBe(false);
  });
});

describe('the phone and the homepage banner see the same set', () => {
  it('shapes an item for the phone with an absolute fix URL', () => {
    const { plan } = step([gmailBroken], new Map(), T0);
    expect(toAttentionItem(plan.marks[0])).toEqual({
      id: 'gmail:1',
      label: 'Gmail · me@example.com',
      group: 'Email',
      status: 'auth_expired',
      detail: 'Gmail token refresh failed: invalid_grant',
      fixHint: 'Re-authorise me@example.com',
      fixUrl: 'https://strangeramblings.com/api/gmail/connect',
      since: T0.toISOString(),
    });
  });

  it('puts every confirmed mark on the homepage banner, naming Gmail once', () => {
    const first = step([gmailBroken, { ...gmailBroken, key: 'gmail:2' }, haDown], new Map(), T0);
    const second = step([gmailBroken, { ...gmailBroken, key: 'gmail:2' }, haDown], first.next, later(30 * 60_000));
    expect(mergeBannerNames(['Gmail', 'Whoop'], second.plan.marks)).toEqual(['Gmail', 'Whoop', 'Home Assistant']);
    expect(mergeBannerNames([], second.plan.marks)).toEqual(['Gmail', 'Home Assistant']);
  });

  it('leaves an unconfirmed outage off the banner, as it is off the phone', () => {
    const { plan } = step([haDown], new Map(), T0);
    expect(mergeBannerNames([], plan.marks)).toEqual([]);
  });

  it('absoluteUrl keeps absolute links and defaults to the dashboard', () => {
    expect(absoluteUrl('https://developer.whoop.com/')).toBe('https://developer.whoop.com/');
    expect(absoluteUrl(null)).toBe('https://strangeramblings.com/admin/connections');
    expect(absoluteUrl('/admin/connections/health')).toBe('https://strangeramblings.com/admin/connections/health');
  });
});
