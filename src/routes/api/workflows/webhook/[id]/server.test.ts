import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable workflow fixture the db mock serves for the workflows table.
let workflowRow: any;

vi.mock('$lib/db/schema', () => ({
  workflows: { __t: 'workflows' },
  workflowNodes: { __t: 'workflowNodes' },
  workflowEdges: { __t: 'workflowEdges' },
  workflowRuns: { __t: 'workflowRuns' },
}));

vi.mock('drizzle-orm', () => ({ eq: (..._a: any[]) => ({}) }));

// engine.execute is fire-and-forget in the route; return a resolved outcome so
// the trailing .then() (which calls db.update) has something to chain on.
const executeMock = vi.fn((..._a: any[]) => Promise.resolve({ status: 'completed', error: null }));
vi.mock('$lib/workflows', () => ({ engine: { execute: (...a: any[]) => executeMock(...a) } }));

vi.mock('$lib/db', () => {
  const db = {
    select: () => ({
      from: (table: any) => ({
        where: () => {
          if (table?.__t === 'workflows') return Promise.resolve(workflowRow ? [workflowRow] : []);
          return Promise.resolve([]); // nodes, edges
        },
      }),
    }),
    insert: (_t: any) => ({
      values: (_v: any) => ({ returning: async () => [{ id: 'run-1' }] }),
    }),
    update: (_t: any) => ({ set: (_v: any) => ({ where: async () => undefined }) }),
  };
  return { db };
});

import { POST } from './+server';

function makeEvent(secretHeader?: string | null) {
  const headers = new Headers();
  if (typeof secretHeader === 'string') headers.set('x-webhook-secret', secretHeader);
  return {
    params: { id: 'wf-1' },
    request: { headers, json: async () => ({ payload: true }) },
  } as any;
}

beforeEach(() => {
  executeMock.mockClear();
  workflowRow = { id: 'wf-1', name: 'Test WF', trigger: { type: 'webhook' } };
});

describe('POST /api/workflows/webhook/[id] — secret matrix', () => {
  it('404s when the workflow is missing', async () => {
    workflowRow = null;
    const res = await POST(makeEvent());
    expect(res.status).toBe(404);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('400s when the trigger is not a webhook', async () => {
    workflowRow = { id: 'wf-1', name: 'x', trigger: { type: 'manual' } };
    const res = await POST(makeEvent());
    expect(res.status).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('no secret configured ⇒ accepts (202), header ignored', async () => {
    const res = await POST(makeEvent());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.runId).toBe('run-1');
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('secret configured + correct header ⇒ 202', async () => {
    workflowRow = { id: 'wf-1', name: 'x', trigger: { type: 'webhook', secret: 's3cr3t' } };
    const res = await POST(makeEvent('s3cr3t'));
    expect(res.status).toBe(202);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('secret configured (nested config) + correct header ⇒ 202', async () => {
    workflowRow = {
      id: 'wf-1',
      name: 'x',
      trigger: { type: 'webhook', config: { secret: 'nested' } },
    };
    const res = await POST(makeEvent('nested'));
    expect(res.status).toBe(202);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('secret configured + missing header ⇒ 401, no run', async () => {
    workflowRow = { id: 'wf-1', name: 'x', trigger: { type: 'webhook', secret: 's3cr3t' } };
    const res = await POST(makeEvent());
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('secret configured + wrong header ⇒ 401, no run', async () => {
    workflowRow = { id: 'wf-1', name: 'x', trigger: { type: 'webhook', secret: 's3cr3t' } };
    const res = await POST(makeEvent('wrong'));
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
