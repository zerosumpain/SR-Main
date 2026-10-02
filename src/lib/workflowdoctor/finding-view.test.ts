import { describe, expect, it } from 'vitest';
import { toFindingView } from './finding-view';
import type { DoctorFindingData } from './types';

const base = {
  workflowId: 'w1', workflowName: 'Monthly burn', canvasSlug: 'monthly-burn', nodeId: 'n1', nodeType: 'http', nodeLabel: 'Fetch',
  fixKind: 'config', status: 'auto_fixed', occurrences: 3, firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z', symptom: 's', cause: 'c', causeSource: 'linter', fix: 'f',
} as unknown as DoctorFindingData;

describe('toFindingView', () => {
  it('names the changed fields of a before-image but never carries their old values', () => {
    const view = toFindingView({ key: 'k', data: { ...base, beforeImage: { changedFields: { apiKey: 'SECRET-OLD-VALUE', url: 'https://old' } } } as unknown as DoctorFindingData });
    expect(view.changedFields).toEqual(['apiKey', 'url']);
    expect(view.revertKind).toBe('node');
    expect(JSON.stringify(view)).not.toContain('SECRET-OLD-VALUE');
    expect(JSON.stringify(view)).not.toContain('https://old');
  });

  it('reads a paused schedule as a schedule undo, and no before-image as nothing to undo', () => {
    expect(toFindingView({ key: 'k', data: { ...base, beforeImage: { scheduleId: 's1', changedFields: {} } } as unknown as DoctorFindingData }).revertKind).toBe('schedule');
    expect(toFindingView({ key: 'k', data: base }).revertKind).toBeNull();
  });
});
