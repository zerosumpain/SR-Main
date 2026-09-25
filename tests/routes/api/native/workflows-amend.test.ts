import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The phone and the chat must refuse the SAME ops with the SAME words — the
 * native amend route screens through `validateAmendOps`, which is the code the
 * `workflow_amend` tool now calls. And `/ask` must never write.
 */

let paired = true;
let graphVersionNow = 111;

// Boot-time jobs the workflow barrel starts (reapers, prompt sync) read and
// write through this; a chain that resolves to no rows keeps them quiet. The
// assertion that matters is on `applyAmendOps`, below.
vi.mock('$lib/db', () => {
  const chain: any = new Proxy(() => chain, {
    get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown[]) => void) => resolve([]) : chain),
    apply: () => chain,
  });
  return { db: chain };
});
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => (paired ? { id: 'dev-1', ownerEmail: 'owner@example.com' } : null),
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));

const applyAmendOps = vi.fn();
vi.mock('$lib/canvas/amend.server', async (orig) => ({
  ...(await orig<typeof import('$lib/canvas/amend.server')>()),
  applyAmendOps: (...args: unknown[]) => applyAmendOps(...args),
}));

vi.mock('$lib/workflows/native/workflows.server', () => ({
  findCanvas: async (slug: string) => (slug === 'morning' ? { id: 'wf-1', name: 'canvas:morning', description: 'Morning' } : null),
  currentGraphVersion: async () => graphVersionNow,
  loadGraph: async () => ({
    nodes: [
      { id: 'n-trigger', type: 'trigger', label: 'Trigger', config: { kind: 'manual' }, position: { x: 0, y: 0 }, version: 0 },
      { id: 'n-send', type: 'whatsapp', label: 'Send', config: { message: 'hi' }, position: { x: 0, y: 100 }, version: 0 },
    ],
    edges: [{ id: 'e-1', sourceNodeId: 'n-trigger', targetNodeId: 'n-send', sourceHandle: null }],
  }),
}));

const completions: string[] = [];
vi.mock('$lib/llm/workflow-gateway', () => ({
  resilientChatCompletion: vi.fn(async () => ({ choices: [{ message: { content: completions.shift() ?? '' } }] })),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: async () => ({ provider: 'openrouter', modelId: 'test/model' }),
}));
vi.mock('$lib/workflows/orchestrator/grounding', () => ({
  buildNodeGrounding: () => '### Delay (`delay`)',
  buildSiteToolCatalog: async () => '',
}));

import { executeTool } from '$lib/workflows/site-tools/registry';
import '$lib/workflows';

async function amend(body: unknown, slug = 'morning') {
  const mod = await import('../../../../src/routes/api/native/workflows/[slug]/amend/+server');
  const request = new Request(`http://x/api/native/workflows/${slug}/amend`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  });
  return (mod.POST as (e: unknown) => Promise<Response>)({ params: { slug }, request, url: new URL(request.url) });
}

async function ask(instruction: string) {
  const mod = await import('../../../../src/routes/api/native/workflows/[slug]/ask/+server');
  const request = new Request('http://x/api/native/workflows/morning/ask', {
    method: 'POST',
    body: JSON.stringify({ instruction }),
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  });
  return (mod.POST as (e: unknown) => Promise<Response>)({ params: { slug: 'morning' }, request, url: new URL(request.url) });
}

beforeEach(() => {
  paired = true;
  graphVersionNow = 111;
  applyAmendOps.mockReset();
  completions.length = 0;
});

describe('native amend and workflow_amend share one validator', () => {
  const badOps: Array<[string, unknown[]]> = [
    ['an op kind nobody implemented', [{ op: 'set_schedule', cron: '0 9 * * *' }]],
    ['a node type that does not exist', [{ op: 'add_node', type: 'not-a-real-node', label: 'X' }]],
    ['a retype to a node type that does not exist', [{ op: 'update_node', nodeId: 'n-send', type: 'nope-node' }]],
    ['a config key the node does not have', [{ op: 'add_node', type: 'delay', label: 'Wait', config: { bogusKey: 1 } }]],
  ];

  for (const [what, ops] of badOps) {
    it(`both refuse ${what}, in the same words, before any write`, async () => {
      const tool = (await executeTool('workflow_amend', { workflowId: 'wf-1', ops })) as { success: boolean; error?: string };
      const res = await amend({ ops });
      const body = await res.json();

      expect(tool.success).toBe(false);
      expect(res.status).toBe(422);
      expect(body.error).toBe(tool.error);
      expect(applyAmendOps).not.toHaveBeenCalled();
    });
  }

  it('refuses switching on a destructive tool from the phone, naming the field', async () => {
    const res = await amend({ ops: [{ op: 'update_node', nodeId: 'n-send', config: { allowDestructive: true } }] });
    expect(res.status).toBe(422);
    expect((await res.json()).field).toBe('allowDestructive');
    expect(applyAmendOps).not.toHaveBeenCalled();
  });

  it('answers 409 with the current version when expectedVersion is stale, inside the transaction', async () => {
    applyAmendOps.mockImplementation(async (input: { precondition?: (tx: unknown) => Promise<void> }) => {
      await input.precondition?.({});
      return { workflowId: 'wf-1', outcomes: [] };
    });
    const res = await amend({ ops: [{ op: 'update_node', nodeId: 'n-send', label: 'Renamed' }], expectedVersion: 5 });
    expect(res.status).toBe(409);
    expect((await res.json()).version).toBe(111);
  });

  it('applies a valid amend and returns the new version and outcomes without before-images', async () => {
    applyAmendOps.mockResolvedValue({
      workflowId: 'wf-1',
      outcomes: [{ op: 'update_node', summary: 'updated "Send"', nodeId: 'n-send', before: { nodeId: 'n-send', version: 0, changedFields: {} } }],
    });
    const res = await amend({ ops: [{ op: 'update_node', nodeId: 'n-send', label: 'Renamed' }], expectedVersion: 111 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: 111, outcomes: [{ op: 'update_node', summary: 'updated "Send"', nodeId: 'n-send' }] });
    expect(applyAmendOps.mock.calls[0][0]).toMatchObject({ workflowId: 'wf-1', actor: 'native' });
  });

  it('answers 404 for a slug that is not a canvas, and 401 for an unpaired phone', async () => {
    expect((await amend({ ops: [{ op: 'remove_node', nodeId: 'x' }] }, 'nope')).status).toBe(404);
    paired = false;
    expect((await amend({ ops: [{ op: 'remove_node', nodeId: 'x' }] })).status).toBe(401);
  });
});

describe('/ask proposes and never writes', () => {
  it('returns the model’s ops unapplied', async () => {
    completions.push(
      JSON.stringify({
        summary: 'Wait a minute before sending.',
        ops: [{ op: 'insert_between', sourceNodeId: 'n-trigger', targetNodeId: 'n-send', type: 'delay', label: 'Wait', config: { milliseconds: 60000 } }],
      }),
    );
    const res = await ask('wait a minute before sending');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe('Wait a minute before sending.');
    expect(body.ops).toHaveLength(1);
    expect(body.warnings).toEqual([]);
    expect(applyAmendOps).not.toHaveBeenCalled();
  });

  it('quotes a bad proposal back once, then gives up with a warning rather than unusable ops', async () => {
    completions.push(
      JSON.stringify({ summary: 'x', ops: [{ op: 'remove_node', nodeId: 'ghost' }] }),
      JSON.stringify({ summary: 'y', ops: [{ op: 'add_node', type: 'not-a-real-node', label: 'X' }] }),
    );
    const res = await ask('do something odd');
    const body = await res.json();
    expect(body.ops).toEqual([]);
    expect(body.warnings[0]).toMatch(/Unknown node type/);
    expect(applyAmendOps).not.toHaveBeenCalled();
  });

  it('never proposes switching on a destructive tool', async () => {
    completions.push(
      JSON.stringify({ summary: 'x', ops: [{ op: 'update_node', nodeId: 'n-send', config: { allowDestructive: true } }] }),
      JSON.stringify({ summary: 'Renamed it.', ops: [{ op: 'update_node', nodeId: 'n-send', label: 'Ping' }] }),
    );
    const body = await (await ask('let it publish')).json();
    expect(body.ops).toEqual([{ op: 'update_node', nodeId: 'n-send', label: 'Ping' }]);
    expect(applyAmendOps).not.toHaveBeenCalled();
  });
});
