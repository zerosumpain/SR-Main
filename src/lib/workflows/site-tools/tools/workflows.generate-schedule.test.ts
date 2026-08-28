import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool } from '../registry';
import '$lib/workflows';

/**
 * A generated cron canvas must also be a SCHEDULED one.
 *
 * `workflows.trigger` is metadata; `workflow_schedules` is what the cron runner
 * reads. workflow_build_from_spec wrote both, workflow_generate wrote only the
 * first — so a canvas generated from "remind me at 9 on the 9th" looked right
 * on the canvas, reported a cron trigger, and never ran once. Nothing surfaced
 * it because every canvas John had built by spec did fire.
 *
 * workflow_generate is also the tool the model is told to PREFER, which is why
 * this is the path that matters for "create a workflow from WhatsApp".
 */

const captured = vi.hoisted(() => ({ scheduleInserts: [] as Array<Record<string, unknown>> }));

vi.mock('$lib/db', () => {
  const q: any = { from: () => q, where: () => q, limit: () => [] };
  const insert = (table: unknown) => ({
    values: (vals: Record<string, unknown>) => {
      const name = String((table as any)?.[Symbol.for('drizzle:Name')] ?? '');
      if (name === 'workflow_schedules') captured.scheduleInserts.push(vals);
      return { returning: async () => [{ id: 'sched-1', ...vals }] };
    },
  });
  return {
    db: {
      select: vi.fn(() => q),
      insert: vi.fn(insert),
      // Inside the transaction the canvas row is created with .returning(),
      // while the node/edge inserts are simply awaited — so values() has to be
      // both thenable and .returning()-able.
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: () => ({
            values: () => {
              const p: any = Promise.resolve([{ id: 'wf-new' }]);
              p.returning = async () => [{ id: 'wf-new' }];
              return p;
            },
          }),
        }),
      ),
    },
  };
});

vi.mock('$lib/canvas/adapter.server', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  allocateCanvasName: async () => ({ name: 'canvas:claude-renewal', slug: 'claude-renewal' }),
}));

vi.mock('$lib/workflows/orchestrator', () => ({
  generateWorkflow: async () => ({
    workflow: {
      name: 'Claude renewal reminder',
      description: 'Monthly nudge',
      trigger: { type: 'cron', config: { expression: '0 9 9 * *' } },
      nodes: [{ id: 'n1', type: 'whatsapp', position: { x: 0, y: 0 }, config: { message: 'Claude renews tomorrow.' }, label: 'Notify' }],
      edges: [],
    },
  }),
  saveWorkflowFromGenerated: async () => undefined,
  runWorkflowVerification: () => [],
}));

vi.mock('$lib/workflows/orchestrator/verify', () => ({ formatIssues: () => '' }));

vi.mock('$lib/workflows/scheduler', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  registerCronJob: vi.fn(),
  reloadSchedule: vi.fn(async () => {}),
}));

describe('workflow_generate — new canvas with a cron trigger', () => {
  beforeEach(() => {
    captured.scheduleInserts = [];
  });

  it('writes the workflow_schedules row, not just the trigger column', async () => {
    const res = await executeTool(
      'workflow_generate',
      { prompt: 'Remind me on the 9th of every month at 9am that Claude renews tomorrow' },
      { emit: () => {} },
    );
    expect(res.success).toBe(true);
    expect(captured.scheduleInserts).toHaveLength(1);
    expect(captured.scheduleInserts[0]).toMatchObject({
      workflowId: 'wf-new',
      type: 'cron',
      enabled: true,
      config: { expression: '0 9 9 * *' },
    });
  });
});
