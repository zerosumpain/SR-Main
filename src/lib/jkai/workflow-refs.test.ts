import { describe, expect, it } from 'vitest';
import { collectWorkflowRefs, finishWorkflowRefs } from './workflow-refs';

describe('collectWorkflowRefs', () => {
  it('takes slug and name from a builder result and dedupes by workflow', () => {
    const refs = collectWorkflowRefs([
      {
        tool: 'workflow_generate',
        result: {
          success: true,
          data: { workflowId: 'w1', slug: 'news-digest', name: 'News digest', url: 'https://x/jkai/canvas/news-digest' },
        },
      },
      { tool: 'workflow_amend', args: { workflowId: 'w1' }, result: { success: true, data: { workflowId: 'w1' } } },
    ]);
    expect(refs).toEqual([{ workflowId: 'w1', slug: 'news-digest', name: 'News digest' }]);
  });

  it('keeps a generate that saved a graph needing fixes (success false, data present)', () => {
    const refs = collectWorkflowRefs([
      { tool: 'workflow_generate', result: { success: false, error: 'needs fix', data: { workflowId: 'w2', url: '/jkai/canvas/abc' } } },
    ]);
    expect(refs).toEqual([{ workflowId: 'w2', slug: 'abc', name: null }]);
  });

  it('falls back to the args workflowId for an edit tool, only when it succeeded', () => {
    const steps = [
      { tool: 'workflow_add_node', args: { workflowId: 'w3' }, result: { success: true, data: { id: 'n1' } } },
      { tool: 'workflow_add_edge', args: { workflowId: 'w4' }, result: { success: false, error: 'nope' } },
    ];
    expect(collectWorkflowRefs(steps).map((r) => r.workflowId)).toEqual(['w3']);
  });

  it('unwraps monitor_create and ignores read-only tools', () => {
    const refs = collectWorkflowRefs([
      { tool: 'workflow_inspect', result: { success: true, data: { workflowId: 'w9', url: '/jkai/canvas/z' } } },
      { tool: 'monitor_create', result: { success: true, data: { monitor: { workflowId: 'w5', slug: 'watch-x' } } } },
    ]);
    expect(refs).toEqual([{ workflowId: 'w5', slug: 'watch-x', name: null }]);
  });
});

describe('finishWorkflowRefs', () => {
  it('fills slug and title from the canvas row and drops non-canvas workflows', () => {
    const out = finishWorkflowRefs(
      [
        { workflowId: 'w3', slug: null, name: null },
        { workflowId: 'w6', slug: null, name: null },
      ],
      [
        { id: 'w3', name: 'canvas:morning', description: 'Morning briefing' },
        { id: 'w6', name: 'legacy-flow', description: null },
      ],
    );
    expect(out).toEqual([
      { workflowId: 'w3', slug: 'morning', name: 'Morning briefing', url: '/jkai/canvas/morning' },
    ]);
  });
});
