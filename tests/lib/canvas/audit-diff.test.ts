import { describe, it, expect } from 'vitest';
import { diffNodePatch, diffWorkflowPatch } from '$lib/canvas/audit-diff';

describe('diffNodePatch', () => {
  const base = {
    label: 'LLM',
    config: { model: 'glm-4', temperature: 0.7, size: { w: 300, h: 200 } },
    position: { x: 0, y: 0 },
  };

  it('returns empty array when only position changes', () => {
    const entries = diffNodePatch(base, { position: { x: 40, y: 60 } });
    expect(entries).toEqual([]);
  });

  it('returns empty array when only config.size changes', () => {
    const entries = diffNodePatch(base, {
      config: { ...base.config, size: { w: 500, h: 400 } },
    });
    expect(entries).toEqual([]);
  });

  it('emits one rename entry when label changes', () => {
    const entries = diffNodePatch(base, { label: 'Claude' });
    expect(entries).toEqual([
      { action: 'rename', details: { old: 'LLM', new: 'Claude' } },
    ]);
  });

  it('emits one config entry per changed config field (excluding size)', () => {
    const entries = diffNodePatch(base, {
      config: {
        ...base.config,
        model: 'glm-4.5',
        temperature: 0.2,
        size: { w: 999, h: 999 },
      },
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        { action: 'config', details: { field: 'model', old: 'glm-4', new: 'glm-4.5' } },
        { action: 'config', details: { field: 'temperature', old: 0.7, new: 0.2 } },
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  it('combines label change and config change into two entries', () => {
    const entries = diffNodePatch(base, {
      label: 'Claude',
      config: { ...base.config, model: 'glm-4.5' },
    });
    expect(entries).toHaveLength(2);
  });
});

describe('diffWorkflowPatch', () => {
  const base = { name: 'canvas:demo', description: 'Old title' };

  it('emits nothing for empty patch', () => {
    expect(diffWorkflowPatch(base, {})).toEqual([]);
  });

  it('emits a rename entry for description change', () => {
    const entries = diffWorkflowPatch(base, { description: 'New title' });
    expect(entries).toEqual([
      { action: 'rename', details: { field: 'description', old: 'Old title', new: 'New title' } },
    ]);
  });

  it('emits a rename entry for name change', () => {
    const entries = diffWorkflowPatch(base, { name: 'canvas:demo2' });
    expect(entries).toEqual([
      { action: 'rename', details: { field: 'name', old: 'canvas:demo', new: 'canvas:demo2' } },
    ]);
  });
});
