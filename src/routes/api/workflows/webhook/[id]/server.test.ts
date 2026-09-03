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
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (email: string | null | undefined) => email === 'owner@test' }));

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
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  webhookSignature,
} from '$lib/workflows/webhook-secret';

let requestId = 0;

function makeEvent(options: { secret?: string; signature?: string; owner?: boolean } = {}) {
  const raw = JSON.stringify({ payload: true, nonce: ++requestId });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  if (options.secret) {
    headers.set(WEBHOOK_TIMESTAMP_HEADER, timestamp);
    headers.set(WEBHOOK_SIGNATURE_HEADER, webhookSignature(options.secret, timestamp, raw));
  } else if (options.signature) {
    headers.set(WEBHOOK_TIMESTAMP_HEADER, timestamp);
    headers.set(WEBHOOK_SIGNATURE_HEADER, options.signature);
  }
  return {
    params: { id: 'wf-1' },
    request: new Request('https://example.test/api/workflows/webhook/wf-1', {
      method: 'POST', headers, body: raw,
    }),
    locals: { auth: async () => options.owner ? { user: { email: 'owner@test' } } : null },
    getClientAddress: () => '203.0.113.10',
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

  it('no secret configured ⇒ rejects (401)', async () => {
    const res = await POST(makeEvent());
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('secret configured + correct signature ⇒ 202', async () => {
    workflowRow = { id: 'wf-1', name: 'x', trigger: { type: 'webhook', secret: 's3cr3t' } };
    const res = await POST(makeEvent({ secret: 's3cr3t' }));
    expect(res.status).toBe(202);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('secret configured (nested config) + correct signature ⇒ 202', async () => {
    workflowRow = {
      id: 'wf-1',
      name: 'x',
      trigger: { type: 'webhook', config: { secret: 'nested' } },
    };
    const res = await POST(makeEvent({ secret: 'nested' }));
    expect(res.status).toBe(202);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('secret configured + missing header ⇒ 401, no run', async () => {
    workflowRow = { id: 'wf-1', name: 'x', trigger: { type: 'webhook', secret: 's3cr3t' } };
    const res = await POST(makeEvent());
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('secret configured + wrong signature ⇒ 401, no run', async () => {
    workflowRow = { id: 'wf-1', name: 'x', trigger: { type: 'webhook', secret: 's3cr3t' } };
    const res = await POST(makeEvent({ signature: 'sha256=wrong' }));
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('allows an authenticated owner to test a disabled webhook', async () => {
    const res = await POST(makeEvent({ owner: true }));
    expect(res.status).toBe(202);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
