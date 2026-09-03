import { describe, it, expect } from 'vitest';
import { activityKey, activityLabel, allActivities, SOURCE_ACTIVITIES } from './activities';
import { WORKLOADS } from '$lib/models/workloads';

describe('activityKey', () => {
  it('prefers the workload tag over the source', () => {
    expect(activityKey('vision', 'gateway')).toBe('vision');
  });

  it('folds the two sources that NAME a role onto that role', () => {
    // Not a guess: usage-capture writes `jkai-chat` only inside a chat turn and
    // `workflow` only inside a workflow run, and both of those roles now have a
    // settings key. Folding them makes the row that reports the money the row
    // that changes it — and it reaches history, which no re-tagging could.
    expect(activityKey(null, 'jkai-chat')).toBe('chat');
    expect(activityKey(null, 'workflow')).toBe('workflow-node');
  });

  it('leaves the sources that name no single role alone', () => {
    // `research` knows a run spent it but not WHICH tier, and the tiers have
    // different models; `gateway` is by definition unclaimed. Picking one would
    // be inventing the half that matters.
    expect(activityKey(null, 'research')).toBe('source:research');
    expect(activityKey(null, 'gateway')).toBe('source:gateway');
  });

  it('still prefers an explicit tag over the fold', () => {
    expect(activityKey('embeddings', 'jkai-chat')).toBe('embeddings');
    expect(activityKey('intel-analysis', 'workflow')).toBe('intel-analysis');
  });

  it('folds only onto roles that exist, or the switch would 404', () => {
    for (const source of ['jkai-chat', 'workflow']) {
      const key = activityKey(null, source);
      expect(WORKLOADS.some((w) => w.id === key), `${source} → ${key}`).toBe(true);
    }
  });

  it('does not fold pre-tagging rows into a role they may not belong to', () => {
    // The honest bucket. Guessing here would back-date an attribution.
    expect(activityKey(null, null)).toBe('source:unknown');
  });
});

describe('allActivities', () => {
  it('names every workload, so no spender is unlabelled', () => {
    const keys = new Set(allActivities().map((a) => a.key));
    for (const w of WORKLOADS) expect(keys.has(w.id)).toBe(true);
  });

  it('offers a switch only where there is one model to switch', () => {
    for (const a of allActivities()) {
      const isSourceRow = a.key.startsWith('source:');
      expect(a.workloadId === null).toBe(isSourceRow);
    }
    expect(SOURCE_ACTIVITIES.every((a) => a.workloadId === null)).toBe(true);
  });

  it('keeps a source row only where nothing can be switched', () => {
    // The invariant behind the 2026-09-03 change: a `source:` row means "no
    // role owns this", so it must not name one that SOURCE_ROLE has folded.
    // Leaving `source:jkai-chat` here after the fold would print an unreachable
    // row that never receives spend again.
    const keys = SOURCE_ACTIVITIES.map((a) => a.key);
    expect(keys).not.toContain('source:jkai-chat');
    expect(keys).not.toContain('source:workflow');
  });

  it('names the last four roles that used to be unswitchable', () => {
    const keys = new Set(allActivities().map((a) => a.key));
    for (const id of ['chat', 'workflow-node', 'daydream-review', 'notebook-review']) {
      expect(keys.has(id), `${id} has no row`).toBe(true);
    }
  });

  it('includes the canvas image tool, which used to be settable only by env var', () => {
    expect(allActivities().some((a) => a.key === 'image-tool')).toBe(true);
  });
});

describe('activityLabel', () => {
  it('reads a registered label', () => {
    expect(activityLabel('vision')).toBe('Vision / OCR');
  });

  it('says plainly when a row predates tagging', () => {
    expect(activityLabel('source:unknown')).toBe('Unattributed (pre-tagging)');
  });

  it('labels the folded sources with their role, not their source', () => {
    expect(activityLabel(activityKey(null, 'jkai-chat'))).toBe('jkai chat turns');
    expect(activityLabel(activityKey(null, 'workflow'))).toBe('Canvas LLM nodes');
  });

  it('degrades to the raw key rather than throwing on something unknown', () => {
    expect(activityLabel('source:something-new')).toBe('something-new');
    expect(activityLabel('brand-new-role')).toBe('brand-new-role');
  });
});
