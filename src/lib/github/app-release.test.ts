import { describe, expect, it } from 'vitest';
import { adhocDrafts, runOfTag, type AdhocDraft } from '$lib/github/adhoc-builds';
import { buildState, chooseReleased, readRelease, released, type AppRelease } from './app-release';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

function draft(run: number, commit: string | null): AdhocDraft {
  return {
    run,
    commit,
    createdAt: `2026-10-${String(run - 110).padStart(2, '0')}T08:00:00Z`,
    ipa: { id: run * 10, name: 'SRAppleApp.ipa', size: 1 },
    meta: { id: run * 10 + 1, name: 'build.json', size: 1 },
  };
}

const release = (build: number, commit: string | null): AppRelease => ({ build, commit, at: '2026-10-21T00:00:00Z', by: null, history: [] });

describe('the ad-hoc drafts GitHub holds', () => {
  it('reads the build number off the tag, and nothing else', () => {
    expect(runOfTag('adhoc-133')).toBe(133);
    expect(runOfTag('v1.0')).toBeNull();
    expect(runOfTag(undefined)).toBeNull();
  });

  it('keeps only complete ad-hoc drafts, newest build first', () => {
    const asset = (name: string, id: number) => ({ id, name, size: 1 });
    const list = adhocDrafts([
      { id: 1, name: 'Ad-hoc build', draft: true, tag_name: 'adhoc-120', target_commitish: A, assets: [asset('x.ipa', 1), asset('build.json', 2)] },
      { id: 2, name: 'Ad-hoc build', draft: true, tag_name: 'adhoc-131', target_commitish: B, assets: [asset('x.ipa', 3), asset('build.json', 4)] },
      // A published release, another draft, and one missing its build.json are none of ours.
      { id: 3, name: 'Ad-hoc build', draft: false, tag_name: 'adhoc-140', assets: [asset('x.ipa', 5), asset('build.json', 6)] },
      { id: 4, name: 'Notes', draft: true, tag_name: 'adhoc-141', assets: [asset('x.ipa', 7), asset('build.json', 8)] },
      { id: 5, name: 'Ad-hoc build', draft: true, tag_name: 'adhoc-142', target_commitish: 'main', assets: [asset('x.ipa', 9)] },
    ]);
    expect(list.map((d) => d.run)).toEqual([131, 120]);
    expect(list[0].commit).toBe(B);
  });
});

describe('which copy the family are offered', () => {
  const drafts = [draft(135, C), draft(133, B), draft(132, A), draft(131, A)];

  it('holds a newer build back until it is released', () => {
    expect(chooseReleased(drafts, release(131, A))?.run).toBe(132);
    expect(chooseReleased(drafts, release(133, B))?.run).toBe(133);
  });

  it('follows a rebuild of the released commit — the same app with another phone in it', () => {
    expect(chooseReleased(drafts, release(131, A))?.run).toBe(132);
  });

  it('offers the newest copy of the released commit once the build itself is gone', () => {
    expect(chooseReleased([draft(135, C), draft(132, A)], release(130, A))?.run).toBe(132);
  });

  it('offers nothing rather than a build nobody released', () => {
    expect(chooseReleased([draft(135, C)], release(131, A))).toBeNull();
    expect(chooseReleased([draft(135, C)], release(131, null))).toBeNull();
  });

  it('says where each copy stands', () => {
    const r = release(131, A);
    const offered = chooseReleased(drafts, r);
    expect(drafts.map((d) => buildState(d, r, offered))).toEqual(['waiting', 'waiting', 'released', 'older']);
  });
});

describe('the release record', () => {
  it('logs a release, and calls an earlier build a rollback', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    const first = released(null, draft(131, A), null, now, 'pinned');
    expect(first.history[0]).toMatchObject({ build: 131, kind: 'pinned', by: null });
    const up = released(first, draft(133, B), 'john@example.test', now);
    expect(up).toMatchObject({ build: 133, commit: B, by: 'john@example.test' });
    expect(up.history.map((h) => h.kind)).toEqual(['release', 'pinned']);
    const back = released(up, draft(131, A), 'john@example.test', now);
    expect(back.history[0].kind).toBe('rollback');
  });

  it('keeps twenty releases', () => {
    let r: AppRelease | null = null;
    for (let i = 0; i < 25; i++) r = released(r, draft(100 + i, A), null, new Date());
    expect(r?.history).toHaveLength(20);
    expect(r?.history[0].build).toBe(124);
  });

  it('reads a malformed record as none', () => {
    expect(readRelease(null)).toBeNull();
    expect(readRelease({ build: 'x' })).toBeNull();
    expect(readRelease({ build: 0 })).toBeNull();
    expect(readRelease({ build: 131, commit: A })).toMatchObject({ build: 131, commit: A, history: [] });
  });
});
