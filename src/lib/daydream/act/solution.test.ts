import { describe, expect, it } from 'vitest';
import { APPLE_SERIES, WHOOP_SERIES } from '$lib/owner-data/health.server';
import { checkSolve, pageAllowed, readSolve, solutionView, solveLabel, storeSolve, TRACK_METRICS, withSolve } from './solution';

const cited = 'light.study is on (since 21:04)\nswitch.hall_lamp on\nlock.front_door locked\nUnsubscribe: https://groupon.example/unsub?u=1';
const pages = new Set(['/trips', '/health', '/home']);
const ctx = { citedText: cited, sitePages: pages };

describe('checkSolve', () => {
  it('every tracker metric is a series the health reader knows (or time with family)', () => {
    for (const m of TRACK_METRICS) {
      if (m === 'familyMinutes') continue;
      expect(m in APPLE_SERIES || m in WHOOP_SERIES, m).toBe(true);
    }
  });

  it('takes a well-formed tracker and refuses a made-up series or a silly length', () => {
    expect(checkSolve({ kind: 'track', metric: 'sleep_hours', goal: 'at_least', target: 7.5, days: 21, label: 'Sleep 7.5 hours a night' }, ctx).ok).toBe(true);
    expect(checkSolve({ kind: 'track', metric: 'happiness', goal: 'at_least', target: 1, days: 21, label: 'x y z' }, ctx)).toMatchObject({ ok: false });
    expect(checkSolve({ kind: 'track', metric: 'steps', goal: 'at_least', target: 8000, days: 400, label: 'Walk more' }, ctx)).toMatchObject({ ok: false });
  });

  it('turns off only lights and switches the cited cards name', () => {
    expect(checkSolve({ kind: 'home', entities: ['light.study', 'switch.hall_lamp'] }, ctx)).toMatchObject({ ok: true });
    // A lock in the cards is still not a light or a switch.
    expect(checkSolve({ kind: 'home', entities: ['lock.front_door'] }, ctx)).toMatchObject({ ok: false });
    // A light the cards never named.
    expect(checkSolve({ kind: 'home', entities: ['light.kitchen'] }, ctx)).toMatchObject({ ok: false });
    expect(checkSolve({ kind: 'home', entities: ['light.a', 'light.b', 'light.c', 'light.d', 'light.e', 'light.f'] }, ctx)).toMatchObject({ ok: false });
  });

  it('opens only listed site pages, or a link the cards carry', () => {
    expect(checkSolve({ kind: 'open', url: '/trips', label: 'Open your trips' }, ctx)).toMatchObject({ ok: true });
    expect(checkSolve({ kind: 'open', url: '/trips/abc', label: 'Open it' }, ctx)).toMatchObject({ ok: true });
    expect(checkSolve({ kind: 'open', url: '/admin/secrets', label: 'x' }, ctx)).toMatchObject({ ok: false });
    expect(checkSolve({ kind: 'open', url: 'https://groupon.example/unsub?u=1', label: 'Unsubscribe' }, ctx)).toMatchObject({ ok: true });
    expect(checkSolve({ kind: 'open', url: 'https://evil.example/x', label: 'x' }, ctx)).toMatchObject({ ok: false });
    expect(checkSolve({ kind: 'open', url: '//evil.example/x', label: 'x' }, ctx)).toMatchObject({ ok: false });
    expect(pageAllowed('/tripsfoo', pages)).toBe(false);
  });

  it('needs words for a build and a watch', () => {
    expect(checkSolve({ kind: 'build', title: 'Away lights', what: 'short' }, ctx)).toMatchObject({ ok: false });
    expect(checkSolve({ kind: 'build', title: 'Away-mode lights check', what: 'Each evening the house is empty, list lights left on.' }, ctx)).toMatchObject({ ok: true });
    expect(checkSolve({ kind: 'watch', description: 'Tell me when the thermostat stops reporting.' }, ctx)).toMatchObject({ ok: true });
    expect(checkSolve({ kind: 'pay', amount: 5 }, ctx)).toMatchObject({ ok: false });
  });
});

describe('storing and showing a solution', () => {
  const plan = { kind: 'track' as const, metric: 'sleep_hours' as const, goal: 'at_least' as const, target: 7.5, days: 21, label: 'Sleep 7.5 hours a night' };

  it('labels the press in his terms', () => {
    expect(solveLabel(plan)).toBe('Track it for 21 days: sleep ≥ 7.5 h');
    expect(solveLabel({ kind: 'home', entities: ['light.study'] })).toBe('Turn off study');
    expect(solveLabel({ kind: 'home', entities: ['light.a', 'light.b'] })).toBe('Turn off 2 lights');
  });

  it('round-trips, replaces itself, and leaves other actions alone', () => {
    const other = { kind: 'reminder', label: 'x', payload: '{}' };
    let actions = withSolve([other], storeSolve(plan));
    expect(readSolve(actions)?.plan).toEqual(plan);
    expect(solutionView(actions)).toMatchObject({ state: 'ready', kind: 'track' });
    actions = withSolve(actions, storeSolve(plan, { at: '2026-10-29T10:00:00Z', ref: 't1', href: '/jkai/daydreams/solutions#tracker-t1', undoneAt: null }));
    expect(actions).toHaveLength(2);
    expect(solutionView(actions)).toMatchObject({ state: 'done', undoable: true, href: '/jkai/daydreams/solutions#tracker-t1' });
  });
});
