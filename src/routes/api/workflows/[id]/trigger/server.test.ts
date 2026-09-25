import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fixtures + capture buffers the db mock reads/writes.
let workflowRow: any;
const workflowUpdates: any[] = [];
const nodeUpdates: any[] = [];
const scheduleInserts: any[] = [];

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
      values: (v: any) => {
        scheduleInserts.push(v);
        return { returning: async () => [{ id: 'sch-1', config: {} }] };
      },
    }),
  };
  return { db };
});

import { PUT } from './+server';

function makeEvent(body: any) {
  return { params: { id: 'wf-1' }, request: { json: async () => body } } as any;
}

beforeEach(() => {
  scheduleInserts.length = 0;
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

describe('PUT /api/workflows/[id]/trigger — cron timezone', () => {
  it('stores a named zone on the trigger and the node, and leaves it off when absent', async () => {
    await PUT(makeEvent({ kind: 'cron', cron: '0 8 * * *', timezone: 'America/New_York' }));
    expect(workflowUpdates[0].trigger).toEqual({ type: 'cron', cron: '0 8 * * *', timezone: 'America/New_York' });
    expect(nodeUpdates[0].config.timezone).toBe('America/New_York');

    workflowUpdates.length = 0;
    await PUT(makeEvent({ kind: 'cron', cron: '0 8 * * *' }));
    expect(workflowUpdates[0].trigger).toEqual({ type: 'cron', cron: '0 8 * * *' });
  });

  it('refuses a zone Intl does not know rather than scheduling it an hour out', async () => {
    const res = await PUT(makeEvent({ kind: 'cron', cron: '0 8 * * *', timezone: 'Mars/Olympus' }));
    expect(res.status).toBe(400);
    expect(workflowUpdates).toHaveLength(0);
  });
});

describe('PUT trigger — event filters', () => {
  it('stores the filter on the schedule, the column and the node, under the canonical type', async () => {
    const filter = [{ key: 'text', op: 'contains', value: 'lights' }];
    const res = await PUT(makeEvent({ kind: 'event', eventType: 'whatsapp.inbound', filter }));
    expect(res.status).toBe(200);
    expect(scheduleInserts[0]).toMatchObject({ type: 'event', config: { eventType: 'whatsapp.inbound', filter } });
    expect(workflowUpdates[0].trigger).toMatchObject({ type: 'event', eventType: 'whatsapp.inbound', filter });
    expect(nodeUpdates[0].config).toMatchObject({ kind: 'event', filter });
  });

  it('saves the old workflow_completed name as workflow.completed', async () => {
    await PUT(makeEvent({ kind: 'event', eventType: 'workflow_completed' }));
    expect(scheduleInserts[0].config.eventType).toBe('workflow.completed');
  });

  it('refuses an unknown event type and a malformed filter', async () => {
    expect((await PUT(makeEvent({ kind: 'event', eventType: 'made.up' }))).status).toBe(400);
    expect((await PUT(makeEvent({ kind: 'event', eventType: 'news.item', filter: 'titles=ai' }))).status).toBe(400);
  });
});
