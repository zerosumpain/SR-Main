import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Rows a `select()` on workflow_nodes resolves to. */
  nodeRows: [] as Array<Record<string, unknown>>,
  /** Rows a `select()` on workflow_edges resolves to. */
  edgeRows: [] as Array<Record<string, unknown>>,
  /** `.set()` payloads, in order — empty means nothing was written. */
  written: [] as Array<Record<string, unknown>>,
  /** `.values()` payloads, per table. */
  inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
  /** Tables a DELETE ran against, in order. */
  deleted: [] as string[],
  /** false → the UPDATE matches no row, i.e. someone raced us on `version`. */
  updateHits: true,
  /** A second, identical connection standing in for a caller's transaction. */
  tx: null as unknown,
}));

vi.mock('$lib/db', () => {
  // Drizzle stamps every table with its SQL name; the writers now touch two
  // tables, so the mock has to tell them apart.
  const nameOf = (t: unknown): string =>
    (t as Record<symbol, string>)?.[Symbol.for('drizzle:Name')] ?? 'unknown';
  const rowsFor = (table: string) => (table === 'workflow_edges' ? h.edgeRows : h.nodeRows);

  const select = () => {
    const b: Record<string, unknown> = {};
    let table = 'workflow_nodes';
    b.from = (t: unknown) => {
      table = nameOf(t);
      return b;
    };
    b.where = () => Promise.resolve(rowsFor(table));
    return b;
  };
  const update = (t: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          h.written.push(values);
          if (!h.updateHits) return [];
          return [{ ...(rowsFor(nameOf(t))[0] ?? {}), ...values }];
        },
      }),
    }),
  });
  const insert = (t: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        const table = nameOf(t);
        h.inserted.push({ table, values });
        return [{ id: `${table}-new`, ...values }];
      },
    }),
  });
  const del = (t: unknown) => ({
    where: async () => {
      h.deleted.push(nameOf(t));
    },
  });
  const makeConn = () => ({ select, update, insert, delete: del });
  h.tx = makeConn();
  return { db: makeConn() };
});

vi.mock('./audit', () => ({
  recordAudit: vi.fn(async () => {}),
  recordAuditBatch: vi.fn(async () => {}),
}));

import { recordAudit, recordAuditBatch } from './audit';
import { diffNodePatch } from './audit-diff';
import {
  mutateNodeConfig,
  revertNodeConfig,
  createNode,
  deleteNode,
  createEdge,
  deleteEdge,
  credentialFields,
  EdgeEndpointError,
  EdgeNotFoundError,
  NodeNotFoundError,
  SensitiveRefusalError,
  VersionConflictError,
} from './mutate.server';

/** A syntactically real OpenRouter key. Never a live one. */
const SECRET = `sk-or-v1-${'a'.repeat(40)}`;

function node(config: Record<string, unknown>, version = 3) {
  return {
    id: 'n1',
    workflowId: 'w1',
    type: 'llm-call',
    label: 'Ask the model',
    position: { x: 0, y: 0 },
    config,
    version,
  };
}

function auditJson(): string {
  return JSON.stringify(vi.mocked(recordAuditBatch).mock.calls);
}

beforeEach(() => {
  h.nodeRows = [];
  h.edgeRows = [];
  h.written = [];
  h.inserted = [];
  h.deleted = [];
  h.updateHits = true;
  vi.mocked(recordAudit).mockClear();
  vi.mocked(recordAuditBatch).mockClear();
});

describe('mutateNodeConfig', () => {
  it('merges the patch and keeps untouched keys', async () => {
    h.nodeRows = [node({ model: 'a', userPrompt: 'keep me', temperature: 0.2 })];

    const res = await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { model: 'b' },
      actor: 'system',
      reason: 'test',
    });

    expect(h.written[0].config).toEqual({ model: 'b', userPrompt: 'keep me', temperature: 0.2 });
    expect(res.before.changedFields).toEqual({ model: 'a' });
    expect(res.before.addedKeys).toBeUndefined();
  });

  it('deletes removeKeys and records them for the revert', async () => {
    h.nodeRows = [node({ model: 'a', bogusKey: 'orphan' })];

    const res = await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      removeKeys: ['bogusKey'],
      actor: 'system',
      reason: 'unknown-config-key',
    });

    expect(h.written[0].config).toEqual({ model: 'a' });
    expect(res.before.changedFields).toEqual({ bogusKey: 'orphan' });
  });

  it('records a key the patch introduced as added, not changed', async () => {
    h.nodeRows = [node({ model: 'a' })];

    const res = await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { userPrompt: 'filled in' },
      actor: 'system',
      reason: 'empty-required-field',
    });

    expect(res.before.changedFields).toEqual({});
    expect(res.before.addedKeys).toEqual(['userPrompt']);
  });

  it('bumps version by exactly 1', async () => {
    h.nodeRows = [node({ model: 'a' }, 7)];

    const res = await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { model: 'b' },
      expectedVersion: 7,
      actor: 'system',
      reason: 'test',
    });

    expect(h.written[0].version).toBe(8);
    expect(res.before.version).toBe(7);
    expect(res.after.version).toBe(8);
  });

  it('throws VersionConflictError and writes nothing on a stale expectedVersion', async () => {
    h.nodeRows = [node({ model: 'a' }, 5)];

    await expect(
      mutateNodeConfig({
        workflowId: 'w1',
        nodeId: 'n1',
        patch: { model: 'b' },
        expectedVersion: 4,
        actor: 'system',
        reason: 'test',
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);

    expect(h.written).toHaveLength(0);
    expect(recordAuditBatch).not.toHaveBeenCalled();
  });

  it('reports a conflict when the row moves between the read and the write', async () => {
    h.nodeRows = [node({ model: 'a' }, 5)];
    h.updateHits = false;

    await expect(
      mutateNodeConfig({
        workflowId: 'w1',
        nodeId: 'n1',
        patch: { model: 'b' },
        expectedVersion: 5,
        actor: 'system',
        reason: 'test',
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('throws NodeNotFoundError when the node is gone', async () => {
    h.nodeRows = [];

    await expect(
      mutateNodeConfig({
        workflowId: 'w1',
        nodeId: 'n1',
        patch: { model: 'b' },
        actor: 'system',
        reason: 'test',
      }),
    ).rejects.toBeInstanceOf(NodeNotFoundError);
    expect(h.written).toHaveLength(0);
  });
});

describe('the credential refusal gate', () => {
  it('refuses a node whose stored config holds a key, and writes nothing', async () => {
    h.nodeRows = [node({ model: 'a', apiKey: SECRET })];

    const err = await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { model: 'b' },
      actor: 'system',
      reason: 'test',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SensitiveRefusalError);
    expect(err.fields).toEqual(['apiKey']);
    // The refusal names the field and quotes nothing — it is a log surface too.
    expect(err.message).not.toContain(SECRET);
    expect(h.written).toHaveLength(0);
    expect(recordAuditBatch).not.toHaveBeenCalled();
  });

  it('refuses a patch that would introduce a key', async () => {
    h.nodeRows = [node({ model: 'a' })];

    await expect(
      mutateNodeConfig({
        workflowId: 'w1',
        nodeId: 'n1',
        patch: { apiKey: SECRET },
        actor: 'owner',
        reason: 'canvas edit',
      }),
    ).rejects.toBeInstanceOf(SensitiveRefusalError);
    expect(h.written).toHaveLength(0);
  });

  it('does not block a rename on a node that holds a credential', async () => {
    // A label change publishes no config value, and stranding the node would
    // leave no way to mark it before it is deleted and recreated.
    h.nodeRows = [node({ apiKey: SECRET })];

    await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      label: 'DELETE ME — holds a secret',
      actor: 'owner',
      reason: 'canvas edit',
    });

    expect(h.written[0].label).toBe('DELETE ME — holds a secret');
    expect(h.written[0].config).toBeUndefined();
  });

  it('lets ordinary personal data and big numbers through', async () => {
    // The live regression this guards: nine whatsapp recipients, one email
    // recipient and a `maxTokensPerHour: 1000000` all trip the personal-data
    // patterns. Refusing them would make those canvases uneditable.
    h.nodeRows = [node({ to: 'someone@example.com', maxTokensPerHour: 1000000 })];

    await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { to: 'other@example.com' },
      actor: 'owner',
      reason: 'canvas edit',
    });

    expect(h.written).toHaveLength(1);
  });

  it('credentialFields names the field and never the value', () => {
    expect(credentialFields({ model: 'a', apiKey: SECRET, to: 'x@example.com' })).toEqual([
      'apiKey',
    ]);
  });
});

describe('the audit entry', () => {
  it('placeholders both sides of a sensitive value and keeps the field name', async () => {
    h.nodeRows = [node({ to: 'leaked@example.com' })];

    await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { to: 'other@example.com' },
      actor: 'owner',
      reason: 'canvas edit',
    });

    const json = auditJson();
    expect(json).toContain('[redacted:email]');
    expect(json).toContain('"field":"to"');
    expect(json).not.toContain('leaked@example.com');
    expect(json).not.toContain('other@example.com');
  });

  it('leaves an ordinary value verbatim', async () => {
    h.nodeRows = [node({ model: 'gemini' })];

    await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { model: 'deepseek' },
      actor: 'owner',
      reason: 'canvas edit',
    });

    expect(auditJson()).toContain('deepseek');
    expect(auditJson()).not.toContain('[redacted:');
  });
});

describe('diffNodePatch redaction', () => {
  it('never writes a credential into the audit details, on either side', () => {
    // The live incident: clearing a key republished it as `old`.
    const entries = diffNodePatch(
      { label: 'n', config: { apiKey: SECRET } },
      { config: { apiKey: '' } },
    );

    expect(JSON.stringify(entries)).not.toContain(SECRET);
    expect(entries).toEqual([
      { action: 'config', details: { field: 'apiKey', old: '[redacted:api-key]', new: '[redacted:api-key]' } },
    ]);
  });

  it('still reports a change between two different secrets', () => {
    const entries = diffNodePatch(
      { label: 'n', config: { apiKey: SECRET } },
      { config: { apiKey: `sk-or-v1-${'b'.repeat(40)}` } },
    );
    expect(entries).toHaveLength(1);
  });
});

describe('composing with a caller transaction', () => {
  // The whole atomicity story rests on this: a writer that closes over the
  // module-level `db` runs on a DIFFERENT connection inside
  // db.transaction(), so a rollback leaves its rows behind and its audit rows
  // land for an edit that never committed.
  const tx = h.tx as never;

  it('mutateNodeConfig passes the caller tx to the audit write', async () => {
    h.nodeRows = [node({ model: 'a' })];

    await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { model: 'b' },
      actor: 'chat',
      reason: 'workflow_amend',
      tx,
    });

    expect(vi.mocked(recordAuditBatch).mock.calls[0][1]).toBe(tx);
  });

  it('createNode and deleteNode pass it too', async () => {
    await createNode({
      workflowId: 'w1',
      type: 'delay',
      label: 'Wait',
      position: { x: 0, y: 0 },
      actor: 'chat',
      reason: 'workflow_amend',
      tx,
    });
    expect(vi.mocked(recordAudit).mock.calls[0][1]).toBe(tx);

    h.nodeRows = [node({})];
    await deleteNode({ workflowId: 'w1', nodeId: 'n1', actor: 'chat', reason: 'r', tx });
    expect(vi.mocked(recordAuditBatch).mock.calls[0][1]).toBe(tx);
  });

  it('leaves the tx undefined when the caller passes none', async () => {
    h.nodeRows = [node({ model: 'a' })];

    await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      patch: { model: 'b' },
      actor: 'owner',
      reason: 'canvas edit',
    });

    expect(vi.mocked(recordAuditBatch).mock.calls[0][1]).toBeUndefined();
  });
});

describe('mutateNodeConfig retype', () => {
  it('writes the new type and records it as its own audit entry', async () => {
    h.nodeRows = [node({ model: 'a' })];

    await mutateNodeConfig({
      workflowId: 'w1',
      nodeId: 'n1',
      type: 'http-request',
      actor: 'chat',
      reason: 'workflow_update_node',
    });

    expect(h.written[0].type).toBe('http-request');
    const entries = vi.mocked(recordAuditBatch).mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toMatchObject({ field: 'type', old: 'llm-call', new: 'http-request' });
  });
});

describe('createNode', () => {
  it('refuses a credential in the config, and writes nothing', async () => {
    const err = await createNode({
      workflowId: 'w1',
      type: 'http-request',
      label: 'Call the API',
      config: { apiKey: SECRET },
      position: { x: 0, y: 0 },
      actor: 'chat',
      reason: 'workflow_add_node',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SensitiveRefusalError);
    expect(err.fields).toEqual(['apiKey']);
    expect(err.message).not.toContain(SECRET);
    expect(h.inserted).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('inserts and audits the creation with the actor and reason', async () => {
    const created = await createNode({
      workflowId: 'w1',
      type: 'delay',
      label: 'Wait 5m',
      config: { seconds: 300 },
      position: { x: 10, y: 20 },
      actor: 'chat',
      reason: 'let the scrape settle',
    });

    expect(created.label).toBe('Wait 5m');
    expect(h.inserted[0]).toMatchObject({ table: 'workflow_nodes' });
    expect(vi.mocked(recordAudit).mock.calls[0][0]).toMatchObject({
      entity: 'node',
      action: 'create',
      details: { nodeType: 'delay', label: 'Wait 5m', actor: 'chat', reason: 'let the scrape settle' },
    });
  });
});

describe('deleteNode', () => {
  it('returns the edges it took with it and audits every one', async () => {
    h.nodeRows = [node({ apiKey: SECRET })];
    h.edgeRows = [
      { id: 'e1', workflowId: 'w1', sourceNodeId: 'up', targetNodeId: 'n1' },
      { id: 'e2', workflowId: 'w1', sourceNodeId: 'n1', targetNodeId: 'down' },
    ];

    const res = await deleteNode({
      workflowId: 'w1',
      nodeId: 'n1',
      actor: 'chat',
      reason: 'workflow_remove_node',
    });

    // Not credential-gated: "delete the node, never edit it" is the prescribed
    // remedy, so refusing here would strand exactly the nodes that need going.
    expect(res.edges).toHaveLength(2);
    expect(h.deleted).toEqual(['workflow_edges', 'workflow_nodes']);
    const entries = vi.mocked(recordAuditBatch).mock.calls[0][0];
    expect(entries.map((e) => e.entity)).toEqual(['node', 'edge', 'edge']);
    expect(JSON.stringify(entries)).not.toContain(SECRET);
  });

  it('throws NodeNotFoundError when the node is not in that workflow', async () => {
    h.nodeRows = [];
    await expect(
      deleteNode({ workflowId: 'w1', nodeId: 'n1', actor: 'chat', reason: 'r' }),
    ).rejects.toBeInstanceOf(NodeNotFoundError);
    expect(h.deleted).toHaveLength(0);
  });
});

describe('createEdge', () => {
  const endpoints = [
    { id: 'a', workflowId: 'w1', type: 'llm-call', label: 'Ask' },
    { id: 'b', workflowId: 'w1', type: 'whatsapp', label: 'Send' },
  ];

  it('refuses an endpoint that is not a node of this workflow', async () => {
    // The live hole: the handler inserted source/target straight from the
    // model's arguments, so a borrowed id wired two canvases together.
    h.nodeRows = [endpoints[0]];

    const err = await createEdge({
      workflowId: 'w1',
      sourceNodeId: 'a',
      targetNodeId: 'from-another-canvas',
      actor: 'chat',
      reason: 'workflow_add_edge',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(EdgeEndpointError);
    expect(err.nodeIds).toEqual(['from-another-canvas']);
    expect(h.inserted).toHaveLength(0);
  });

  it('refuses a node piping to itself', async () => {
    await expect(
      createEdge({
        workflowId: 'w1',
        sourceNodeId: 'a',
        targetNodeId: 'a',
        actor: 'chat',
        reason: 'workflow_add_edge',
      }),
    ).rejects.toBeInstanceOf(EdgeEndpointError);
  });

  it('inserts and audits both endpoint labels', async () => {
    h.nodeRows = endpoints;
    h.edgeRows = [];

    const edge = await createEdge({
      workflowId: 'w1',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      actor: 'chat',
      reason: 'workflow_add_edge',
    });

    expect(edge.sourceNodeId).toBe('a');
    expect(vi.mocked(recordAudit).mock.calls[0][0]).toMatchObject({
      entity: 'edge',
      action: 'create',
      details: { from: 'a', to: 'b', fromLabel: 'Ask', toLabel: 'Send' },
    });
  });

  it('returns the existing edge rather than duplicating it', async () => {
    h.nodeRows = endpoints;
    h.edgeRows = [{ id: 'e1', workflowId: 'w1', sourceNodeId: 'a', targetNodeId: 'b' }];

    const edge = await createEdge({
      workflowId: 'w1',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      actor: 'chat',
      reason: 'workflow_add_edge',
    });

    expect(edge.id).toBe('e1');
    expect(h.inserted).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('wires an error branch alongside the success edge between the same pair', async () => {
    // Deduping on the pair alone handed back the existing handle-less edge and
    // reported it as wired, so a condition node's error route was never
    // connected and nothing said so. Handles are part of the identity.
    h.nodeRows = endpoints;
    h.edgeRows = [
      {
        id: 'e1',
        workflowId: 'w1',
        sourceNodeId: 'a',
        targetNodeId: 'b',
        sourceHandle: null,
        targetHandle: null,
      },
    ];

    const edge = await createEdge({
      workflowId: 'w1',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      sourceHandle: 'error',
      actor: 'chat',
      reason: 'workflow_add_edge',
    });

    expect(edge.id).not.toBe('e1');
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0].values).toMatchObject({ sourceHandle: 'error', targetHandle: null });
  });

  it('still dedupes when the handles match too', async () => {
    h.nodeRows = endpoints;
    h.edgeRows = [
      {
        id: 'e1',
        workflowId: 'w1',
        sourceNodeId: 'a',
        targetNodeId: 'b',
        sourceHandle: 'error',
        targetHandle: null,
      },
    ];

    const edge = await createEdge({
      workflowId: 'w1',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      sourceHandle: 'error',
      actor: 'chat',
      reason: 'workflow_add_edge',
    });

    expect(edge.id).toBe('e1');
    expect(h.inserted).toHaveLength(0);
  });
});

describe('deleteEdge', () => {
  it('refuses an edge id that belongs to another workflow', async () => {
    h.edgeRows = [];
    await expect(
      deleteEdge({ workflowId: 'w1', edgeId: 'e9', actor: 'chat', reason: 'r' }),
    ).rejects.toBeInstanceOf(EdgeNotFoundError);
    expect(h.deleted).toHaveLength(0);
  });
});

describe('revertNodeConfig', () => {
  it('replays the before-image and expects the version the fix left behind', async () => {
    h.nodeRows = [node({ mode: 'browse', extra: 'added' }, 5)];

    await revertNodeConfig(
      { nodeId: 'n1', version: 4, changedFields: { mode: 'interactive' }, addedKeys: ['extra'] },
      'system',
    );

    expect(h.written[0].config).toEqual({ mode: 'interactive' });
    expect(h.written[0].version).toBe(6);
  });

  it('conflicts rather than clobbering a human edit made since the fix', async () => {
    h.nodeRows = [node({ mode: 'browse' }, 9)];

    await expect(
      revertNodeConfig({ nodeId: 'n1', version: 4, changedFields: { mode: 'interactive' } }, 'system'),
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect(h.written).toHaveLength(0);
  });
});
