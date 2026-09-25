import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Describe-it builds run the orchestrator's own generator, keep the canvas's
 * address, schedule a cron they produce, and leave a durable marker saying how
 * it went.
 */

const markers: Array<{ workflowId: string; status: string; error?: string }> = [];
vi.mock('$lib/workflows/build-state.server', () => ({
  recordBuildState: vi.fn(async (workflowId: string, status: string, _content: string, extra?: { error?: string }) => {
    markers.push({ workflowId, status, error: extra?.error });
  }),
}));

const saved: Array<{ workflowId: string; generated: { name: string; description?: string } }> = [];
const generateWorkflow = vi.fn();
const verify = vi.fn(() => [] as Array<{ severity: string; nodeLabel: string; issue: string }>);
vi.mock('$lib/workflows/orchestrator', () => ({
  generateWorkflow: (...a: unknown[]) => generateWorkflow(...a),
  saveWorkflowFromGenerated: vi.fn(async (workflowId: string, generated: { name: string }) => {
    saved.push({ workflowId, generated });
  }),
  runWorkflowVerification: () => verify(),
}));

const triggerSaves: unknown[] = [];
vi.mock('$lib/workflows/trigger-save.server', () => ({
  saveWorkflowTrigger: vi.fn(async (_id: string, body: unknown) => {
    triggerSaves.push(body);
    return { ok: true, trigger: {} };
  }),
}));

vi.mock('$lib/db', () => {
  const rows = [{ name: 'canvas:morning-news' }];
  const chain: any = new Proxy(() => chain, {
    get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown[]) => void) => resolve(rows) : chain),
    apply: () => chain,
  });
  return { db: chain };
});
vi.mock('$lib/jkai/workflow-updates-bus', () => ({ publishWorkflowUpdate: vi.fn() }));
vi.mock('$lib/workflows/native/workflows.server', () => ({ loadGraph: vi.fn() }));
vi.mock('$lib/workflows/native/amend.server', () => ({ screenNativeOps: vi.fn() }));

// The proof: a test run (side effects stubbed) with one repair round, mocked here.
const passing = { lint: { errors: 0, warnings: 0, issues: [] }, passed: true, testRun: { runId: 'r1', status: 'completed', stubbed: [], pinned: [] } };
const prove = vi.fn(async () => passing as Record<string, unknown>);
vi.mock('$lib/workflows/test-runs.server', () => ({
  proveWithRepair: () => prove(),
  describeVerification: (v: { passed: boolean; testRun: { failedNode?: string; error?: string } }) =>
    v.passed ? 'the test run completed' : `the test run failed at "${v.testRun.failedNode}": ${v.testRun.error}`,
}));

import { buildInBackground } from '$lib/workflows/build-from-prompt.server';

const generated = (over: Record<string, unknown> = {}) => ({
  workflow: {
    name: 'Morning News',
    description: 'Sends the news at 8',
    nodes: [{ id: 'a', type: 'trigger', label: 'T', config: {}, position: { x: 0, y: 0 } }],
    edges: [],
    explanation: 'Done.',
    trigger: { type: 'cron', config: { expression: '0 8 * * *' } },
    ...over,
  },
  messages: [],
});

beforeEach(() => {
  markers.length = 0;
  saved.length = 0;
  triggerSaves.length = 0;
  generateWorkflow.mockReset();
  verify.mockReset();
  verify.mockReturnValue([]);
  prove.mockReset();
  prove.mockResolvedValue(passing);
});

describe('buildInBackground', () => {
  it('saves under the canvas name, schedules the cron and marks it done', async () => {
    generateWorkflow.mockResolvedValue(generated());
    await buildInBackground('wf-1', 'every morning at 8 send me the news', null);

    // The generator runs as workflow_generate runs it for a NEW canvas.
    expect(generateWorkflow.mock.calls[0]).toEqual(['every morning at 8 send me the news', null]);
    expect(prove).toHaveBeenCalledTimes(1);
    expect(saved[0].generated.name).toBe('canvas:morning-news');
    expect(saved[0].generated.description).toBe('Sends the news at 8');
    expect(triggerSaves).toEqual([{ kind: 'cron', cron: '0 8 * * *', timezone: undefined, enabled: true }]);
    expect(markers).toEqual([{ workflowId: 'wf-1', status: 'done', error: undefined }]);
  });

  it('keeps a title the owner gave over the generator’s', async () => {
    generateWorkflow.mockResolvedValue(generated());
    await buildInBackground('wf-1', 'news', 'My news');
    expect(saved[0].generated.description).toBe('My news');
  });

  it('refuses to save a graph holding a credential', async () => {
    generateWorkflow.mockResolvedValue(
      generated({ nodes: [{ id: 'a', type: 'http-request', label: 'H', config: { apiKey: 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef' }, position: {} }] }),
    );
    await buildInBackground('wf-1', 'call it', null);
    expect(saved).toHaveLength(0);
    expect(markers[0].status).toBe('failed');
    expect(markers[0].error).toMatch(/password or API key/);
  });

  it('says "built, but" when the test run fails, and keeps the proof on the marker', async () => {
    generateWorkflow.mockResolvedValue(generated());
    const failing = { ...passing, passed: false, testRun: { runId: 'r2', status: 'failed', failedNode: 'Fetch', error: 'HTTP 404', stubbed: ['Send'], pinned: [] } };
    prove.mockResolvedValue(failing);
    await buildInBackground('wf-1', 'every morning at 8 send me the news', null);
    expect(markers).toEqual([{ workflowId: 'wf-1', status: 'failed', error: 'built, but the test run failed at "Fetch": HTTP 404' }]);
    const { recordBuildState } = await import('$lib/workflows/build-state.server');
    expect(vi.mocked(recordBuildState).mock.calls.at(-1)?.[3]?.verification).toBe(failing);
  });

  it('marks an empty graph, a lint error and a crash as failures', async () => {
    generateWorkflow.mockResolvedValueOnce({ workflow: null, messages: [] });
    await buildInBackground('wf-1', '?', null);
    generateWorkflow.mockResolvedValueOnce(generated());
    verify.mockReturnValueOnce([{ severity: 'error', nodeLabel: 'Send', issue: 'message is empty' }]);
    await buildInBackground('wf-1', 'send', null);
    generateWorkflow.mockRejectedValueOnce(new Error('gateway down'));
    await buildInBackground('wf-1', 'x', null);

    expect(markers.map((m) => m.status)).toEqual(['failed', 'failed', 'failed']);
    expect(markers[1].error).toContain('“Send”: message is empty');
    expect(markers[2].error).toContain('gateway down');
  });

  it('a clarifying question waits for the owner (needs_input), carrying what to rebuild from', async () => {
    generateWorkflow.mockResolvedValueOnce({ workflow: null, followUp: 'What calendar date should the jokes stop at?', messages: [] });
    await buildInBackground('wf-1', 'a joke every hour till 6pm today', 'Jokes');
    const { recordBuildState } = await import('$lib/workflows/build-state.server');
    const [, status, content, extra] = vi.mocked(recordBuildState).mock.calls.at(-1)!;
    expect(status).toBe('needs_input');
    expect(content).toBe('jkai has a question before it can build this: What calendar date should the jokes stop at?');
    expect(extra).toEqual({
      question: 'What calendar date should the jokes stop at?',
      resume: { prompt: 'a joke every hour till 6pm today', title: 'Jokes', attempt: 1, qa: [] },
    });
    expect(saved).toHaveLength(0);
  });

  it('sends the original prompt plus every answer, and fails once three questions are spent', async () => {
    const qa = [{ q: 'Which city?', a: 'Leeds' }, { q: 'Which day?', a: '' }];
    generateWorkflow.mockResolvedValueOnce({ workflow: null, followUp: 'What time?', messages: [] });
    await buildInBackground('wf-1', 'weather', null, qa);
    expect(generateWorkflow.mock.calls[0][0]).toBe(
      'weather\n\nEarlier questions and your answers:\nQ: Which city?\nA: Leeds\nQ: Which day?\nA: (skipped)' +
        '\n\nMake reasonable assumptions for anything unspecified and state them in the description.',
    );
    expect(markers.at(-1)?.status).toBe('needs_input');

    const three = [...qa, { q: 'What time?', a: '9am' }];
    generateWorkflow.mockResolvedValueOnce({ workflow: null, followUp: 'And the units?', messages: [] });
    await buildInBackground('wf-1', 'weather', null, three);
    expect(generateWorkflow.mock.calls[1][0]).toMatch(/Do not ask any more questions: proceed with your best assumptions/);
    expect(markers.at(-1)).toMatchObject({ status: 'failed', error: expect.stringContaining('And the units?') });
  });
});
