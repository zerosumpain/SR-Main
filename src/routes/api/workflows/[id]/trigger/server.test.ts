import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fixtures + capture buffers the db mock reads/writes.
let workflowRow: any;
const workflowUpdates: any[] = [];
const nodeUpdates: any[] = [];

vi.mock('$lib/db/schema', () => ({
  workflows: { __t: 'workflows' },
  workflowNodes: { __t: 'workflowNodes' },
  workflowSchedules: { __t: 'workflowSchedules' },
}));

vi.mock('drizzle-orm', () => ({ and: (..._a: any[]) => ({}), eq: (..._a: any[]) => ({}) }));

vi.mock('$lib/workflows/scheduler', () => ({
  registerCronJob: vi.fn(),
  unregisterCronJob: vi.fn(),
}));

vi.mock('$lib/canvas/audit', () => ({ recordAudit: vi.fn(async () => undefined) }));

vi.mock('$lib/db', () => {
  const db = {
    select: () => ({
      from: (table: any) => ({
        where: () => {
          if (table?.__t === 'workflows') return Promise.resolve(workflowRow ? [workflowRow] : []);
          if (table?.__t === 'workflowNodes') return Promise.resolve([{ id: 'node-1' }]);
          return Promise.resolve([]); // schedules
        },
      }),
    }),
    update: (table: any) => ({
      set: (payload: any) => ({
        where: async () => {
          if (table?.__t === 'workflows') workflowUpdates.push(payload);
          if (table?.__t === 'workflowNodes') nodeUpdates.push(payload);
        },
      }),
    }),
    delete: (_t: any) => ({ where: async () => undefined }),
    insert: (_t: any) => ({
      values: (_v: any) => ({ returning: async () => [{ id: 'sch-1', config: {} }] }),
    }),
  };
  return { db };
});

import { PUT } from './+server';

function makeEvent(body: any) {
  return { params: { id: 'wf-1' }, request: { json: async () => body } } as any;
}

beforeEach(() => {
  workflowUpdates.length = 0;
  nodeUpdates.length = 0;
  workflowRow = { id: 'wf-1', trigger: null };
});

describe('PUT /api/workflows/[id]/trigger — webhook secret round-trip', () => {
  it('persists a provided secret to workflows.trigger and the trigger node', async () => {
    const res = await PUT(makeEvent({ kind: 'webhook', secret: 's3cr3t-abc' }));
    const body = await res.json();
    expect(body.trigger).toEqual({ type: 'webhook', secret: 's3cr3t-abc' });
    expect(workflowUpdates[0].trigger).toEqual({ type: 'webhook', secret: 's3cr3t-abc' });
    // Mirrored onto the trigger node config (wrapped as { config }) so the
    // canvas can read it back.
    expect(nodeUpdates[0].config.secret).toBe('s3cr3t-abc');
    expect(nodeUpdates[0].config.kind).toBe('webhook');
  });

  it('preserves the existing top-level secret when the body omits it', async () => {
    workflowRow = { id: 'wf-1', trigger: { type: 'webhook', secret: 'existing' } };
    const res = await PUT(makeEvent({ kind: 'webhook' }));
    const body = await res.json();
    expect(body.trigger.secret).toBe('existing');
    expect(workflowUpdates[0].trigger.secret).toBe('existing');
  });

  it('preserves a nested config.secret (generator-authored) when the body omits it', async () => {
    workflowRow = { id: 'wf-1', trigger: { type: 'webhook', config: { secret: 'nested' } } };
    const res = await PUT(makeEvent({ kind: 'webhook' }));
    const body = await res.json();
    expect(body.trigger.secret).toBe('nested');
  });

  it('clears the secret when the body sends an empty string', async () => {
    workflowRow = { id: 'wf-1', trigger: { type: 'webhook', secret: 'existing' } };
    const res = await PUT(makeEvent({ kind: 'webhook', secret: '' }));
    const body = await res.json();
    expect(body.trigger).toEqual({ type: 'webhook' });
    expect('secret' in body.trigger).toBe(false);
    expect('secret' in workflowUpdates[0].trigger).toBe(false);
  });

  it('drops the secret when switching away from webhook', async () => {
    workflowRow = { id: 'wf-1', trigger: { type: 'webhook', secret: 'existing' } };
    const res = await PUT(makeEvent({ kind: 'manual' }));
    const body = await res.json();
    expect(body.trigger).toEqual({ type: 'manual' });
    expect('secret' in body.trigger).toBe(false);
  });

  it('trims whitespace around a provided secret', async () => {
    const res = await PUT(makeEvent({ kind: 'webhook', secret: '  spaced  ' }));
    const body = await res.json();
    expect(body.trigger.secret).toBe('spaced');
  });
});
