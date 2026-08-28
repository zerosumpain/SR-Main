import { describe, it, expect } from 'vitest';
import { activityKey, activityLabel, allActivities, SOURCE_ACTIVITIES } from './activities';
import { WORKLOADS } from '$lib/models/workloads';

describe('activityKey', () => {
  it('prefers the workload tag over the source', () => {
    expect(activityKey('vision', 'gateway')).toBe('vision');
  });

  it('falls back to the source for untagged spend', () => {
    expect(activityKey(null, 'jkai-chat')).toBe('source:jkai-chat');
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

  it('degrades to the raw key rather than throwing on something unknown', () => {
    expect(activityLabel('source:something-new')).toBe('something-new');
    expect(activityLabel('brand-new-role')).toBe('brand-new-role');
  });
});
