import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Pins (a datastore collection, 64 KB cap), run-from-here's downstream set and
 * the plain-words verdict the chat and the build banner repeat. No DB: the
 * datastore and the definition loader are stubbed, and nothing here deletes.
 */

const store = vi.hoisted(() => ({ upserts: [] as Array<{ key: string; data: Record<string, unknown> }> }));
vi.mock('$lib/datastore', () => ({
  DatastoreError: class extends Error {},
  deleteRecord: vi.fn(() => { throw new Error('no deletes in this test'); }),
  ensureCollection: vi.fn(async () => ({})),
  getCollectionBySlug: vi.fn(async () => ({ id: 'c' })),
  getRecordByKey: vi.fn(),
  queryRecords: vi.fn(async () => ({ records: [] })),
  upsertRecord: vi.fn(async (_slug: string, input: { key: string; data: Record<string, unknown> }) => {
    store.upserts.push(input);
    return input;
  }),
}));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/workflows/start-run', () => ({
  loadDefinition: vi.fn(async () => ({
    id: 'wf', name: 'Flow',
    nodes: ['t', 'a', 'b', 'c', 'side'].map((id) => ({ id, type: 'transform', label: id.toUpperCase(), config: {}, position: { x: 0, y: 0 } })),
    edges: [
      { id: 'e1', sourceNodeId: 't', targetNodeId: 'a' },
      { id: 'e2', sourceNodeId: 'a', targetNodeId: 'b' },
      { id: 'e3', sourceNodeId: 'b', targetNodeId: 'c' },
      { id: 'e4', sourceNodeId: 't', targetNodeId: 'side' },
    ],
  })),
  startRun: vi.fn(),
}));

import { describeVerification, downstreamOf, PIN_MAX_BYTES, setPin, TestRunError, type WorkflowVerification } from '$lib/workflows/test-runs.server';
import { loadDefinition } from '$lib/workflows/start-run';

beforeEach(() => {
  store.upserts.length = 0;
});

describe('pins', () => {
  it('stores the output without test-run markers, keyed by workflow and node', async () => {
    const pin = await setPin('wf', 'a', { output: { x: 1, _pinned: true, _stubbed: true }, handle: 'true' });
    expect(pin).toMatchObject({ workflowId: 'wf', nodeId: 'a', output: { x: 1 }, handle: 'true' });
    expect(store.upserts[0].key).toBe('wf:a');
  });

  it('refuses more than 64 KB, a non-object, and a step the workflow does not have', async () => {
    const big = { text: 'x'.repeat(PIN_MAX_BYTES + 1) };
    await expect(setPin('wf', 'a', { output: big })).rejects.toMatchObject({ status: 413 });
    await expect(setPin('wf', 'a', { output: [1, 2] })).rejects.toBeInstanceOf(TestRunError);
    await expect(setPin('wf', 'nope', { output: {} })).rejects.toMatchObject({ status: 404 });
    expect(store.upserts).toHaveLength(0);
  });
});

describe('run from here', () => {
  it('runs the chosen step and everything after it — nothing beside or before it', async () => {
    const def = (await loadDefinition('wf'))!;
    expect([...downstreamOf(def, 'a')].sort()).toEqual(['a', 'b', 'c']);
    expect([...downstreamOf(def, 'side')]).toEqual(['side']);
  });
});

describe('describeVerification', () => {
  const base: WorkflowVerification = {
    lint: { errors: 0, warnings: 0, issues: [] },
    passed: true,
    testRun: { runId: 'r', status: 'completed', stubbed: ['Send'], pinned: [] },
  };
  it('names the failing step and its error', () => {
    const v = { ...base, passed: false, testRun: { ...base.testRun, status: 'failed', failedNode: 'Fetch', error: 'HTTP 404' } };
    expect(describeVerification(v)).toBe('the test run failed at "Fetch": HTTP 404');
  });
  it('says what was stubbed on a pass, and puts lint first', () => {
    expect(describeVerification(base)).toBe('the test run completed (stubbed: Send)');
    const lint = { ...base, passed: false, lint: { errors: 1, warnings: 0, issues: ['"Send" to: required'] } };
    expect(describeVerification(lint)).toBe('lint found 1 error(s): "Send" to: required');
  });
});
