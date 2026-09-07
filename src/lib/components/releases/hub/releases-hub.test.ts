import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ReleasesHub from './ReleasesHub.svelte';
import { weeklyCadence } from '$lib/releases/console';
import type { OwnerReleasesData, PublicReleasesData } from './types';

// /releases serves two documents at one URL, and the anonymous one is the
// reason this file exists. Release summaries are machine-written prose about a
// codebase, so they quote the data that provoked the change — that is how a
// personal phone number reached the public internet on 2026-07-29, faithfully
// reported out of the commit body that carried it as a test case.
//
// The loader is what keeps the owner payload away from an anonymous reader.
// This asserts the second belt: that the TEMPLATE cannot put a sha, a file
// path, a commit body or a summariser control on the page when it was handed a
// public payload — `{#if owner}` is not a boundary, so nothing here may depend
// on one.

const SHA = 'deadbeefcafe1234';
const SECRET_PATH = 'src/lib/server/secrets/vault.ts';
const COMMIT_BODY = 'normalise the JID for the number that kept failing';

function publicData(over: Partial<PublicReleasesData> = {}): PublicReleasesData {
  return {
    mode: 'public',
    totals: {
      releases: 418,
      commits: 2338,
      files: 7249,
      insertions: 690507,
      deletions: 106424,
      shipped: 357,
      firstDeploy: '2026-03-19T09:00:00.000Z',
      lastDeploy: '2026-07-29T13:52:00.000Z',
      days: 133,
    },
    cadence: [{ week: '2026-W30', deploys: 9, shipped: 14 }],
    kindMix: [{ kind: 'feature', count: 1 }],
    kindOptions: ['feature', 'fix', 'improvement', 'content'],
    items: [
      {
        kind: 'feature',
        title: 'Deck editor chart room',
        summary: 'Adds a chart editor to the deck builder.',
        surfaces: ['/decks'],
        version: '2026.07.11.4',
        deployedAt: '2026-07-11T23:37:00.000Z',
      },
    ],
    filters: { kind: 'all', q: '' },
    ...over,
  };
}

function ownerData(over: Partial<OwnerReleasesData> = {}): OwnerReleasesData {
  return {
    mode: 'owner',
    filters: { kind: 'all', impact: 'all', via: 'all', q: '', page: 0 },
    totals: {
      releases: 418,
      commits: 2338,
      files: 7249,
      insertions: 690507,
      deletions: 106424,
      pending: 0,
      failed: 11,
      minDate: '2026-03-19',
      maxDate: '2026-07-29',
    },
    vias: [{ via: 'github-actions', count: 400 }],
    kindDist: [{ kind: 'feature', count: 308 }],
    cadence: [{ week: '2026-W30', deploys: 9, shipped: 14 }],
    items: [
      {
        id: 1,
        version: '2026.07.29.6',
        sha: SHA,
        shortSha: SHA.slice(0, 8),
        prevSha: null,
        via: 'github-actions',
        deployedAt: new Date('2026-07-29T13:52:00.000Z'),
        title: 'Connector health monitoring',
        summary: 'Adds a daily alert.',
        summaryStatus: 'ok',
        summaryError: null,
        summaryModel: 'deepseek/deepseek-v4-flash',
        kinds: ['feature'],
        stats: { commits: 1, files: 10, insertions: 950, deletions: 5, prs: [] },
        commits: [
          {
            sha: SHA,
            short: SHA.slice(0, 8),
            author: 'John',
            date: '2026-07-29T13:52:00.000Z',
            subject: 'fix jid normalisation',
            body: COMMIT_BODY,
            pr: 61,
          },
        ],
        files: [{ path: SECRET_PATH, status: 'M', insertions: 4, deletions: 1 }],
        items: [
          {
            id: 9,
            kind: 'feature',
            impact: 'user-facing',
            title: 'Connector health',
            summary: 'A daily alert.',
            confidence: 'high',
            includes: ['a daily alert'],
            excludes: [],
            surfaces: ['/admin/connections'],
            files: [SECRET_PATH],
            commits: [SHA.slice(0, 8)],
          },
        ],
        itemCount: 1,
      },
    ],
    hasMore: true,
    ...over,
  };
}

const html = (data: OwnerReleasesData | PublicReleasesData) =>
  render(ReleasesHub, { props: { data } }).body;

describe('the public document', () => {
  const body = html(publicData());

  it('renders the record itself', () => {
    expect(body).toContain('Deck editor chart room');
    expect(body).toContain('Adds a chart editor to the deck builder.');
    // The two unfiltered release-level figures plus the one filtered item count.
    expect(body).toContain('418');
    expect(body).toContain('357');
  });

  it('carries the console furniture an anonymous reader is allowed', () => {
    expect(body).toContain('Search');
    expect(body).toContain('All kinds');
    expect(body).toContain('Cadence');
    expect(body).toContain('Capabilities');
  });

  it('offers only the kinds its corpus can actually return', () => {
    // `infra` items are removed wholesale by the public filter, so offering
    // the option would be offering a guaranteed empty result.
    expect(body).toContain('>Feature</option>');
    expect(body).not.toContain('>Infra</option>');
    expect(body).not.toContain('>Chore</option>');
  });

  it('offers no owner control', () => {
    for (const control of [
      'Regenerate summary',
      'Full diff detail',
      'Show commit list',
      'All sources',
      'User-facing',
      'Summarise',
      'Retry',
    ]) {
      expect(body).not.toContain(control);
    }
  });

  it('leaks no sha, file path or commit prose', () => {
    expect(body).not.toContain(SHA);
    expect(body).not.toContain(SHA.slice(0, 8));
    expect(body).not.toContain(SECRET_PATH);
    expect(body).not.toContain(COMMIT_BODY);
  });
});

describe('the owner document', () => {
  const body = html(ownerData());

  it('renders the version log and the owner-only filters', () => {
    expect(body).toContain('2026.07.29.6');
    expect(body).toContain('Connector health monitoring');
    expect(body).toContain('All sources');
    expect(body).toContain('User-facing');
    expect(body).toContain('Older →');
  });

  it('holds the evidence back until a release is opened', () => {
    // Cards render collapsed, so a 25-release page does not ship 25 releases'
    // worth of commit prose and file lists to the browser on first paint.
    expect(body).not.toContain('Regenerate summary');
    expect(body).not.toContain(COMMIT_BODY);
    expect(body).not.toContain(SECRET_PATH);
  });

  it('surfaces the summariser queue when something failed', () => {
    expect(body).toContain('Retry 11 failed');
  });

  it('says nothing about a queue that is empty', () => {
    const clean = html(ownerData({ totals: { ...ownerData().totals, pending: 0, failed: 0 } }));
    expect(clean).toContain('Every release in this view has been summarised.');
    expect(clean).not.toContain('Retry');
  });

  it('is not indexable copy — it names the full read', () => {
    expect(body).toContain('full read');
  });
});

describe('weeklyCadence', () => {
  it('rolls the public per-day series into ISO weeks', () => {
    // 2026-07-27 is a Monday; 2026-08-02 the Sunday that closes the same week.
    const weeks = weeklyCadence([
      { date: '2026-07-27', count: 2, shipped: 5 },
      { date: '2026-07-29', count: 6, shipped: 9 },
      { date: '2026-08-02', count: 1, shipped: 1 },
      { date: '2026-08-03', count: 4, shipped: 2 },
    ]);
    expect(weeks).toEqual([
      { week: '2026-W31', deploys: 9, shipped: 15 },
      { week: '2026-W32', deploys: 4, shipped: 2 },
    ]);
  });

  it('keeps only the most recent weeks, oldest first', () => {
    const days = Array.from({ length: 400 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      count: 1,
      shipped: 1,
    }));
    const weeks = weeklyCadence(days, 40);
    expect(weeks).toHaveLength(40);
    expect(weeks[0].week < weeks[39].week).toBe(true);
  });
});
