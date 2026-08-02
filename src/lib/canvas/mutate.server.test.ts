import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Rows every `select()` resolves to. */
  nodeRows: [] as Array<Record<string, unknown>>,
  /** `.set()` payloads, in order — empty means nothing was written. */
  written: [] as Array<Record<string, unknown>>,
  /** false → the UPDATE matches no row, i.e. someone raced us on `version`. */
  updateHits: true,
}));

vi.mock('$lib/db', () => {
  const select = () => {
    const b: Record<string, unknown> = {};
    b.from = () => b;
    b.where = () => Promise.resolve(h.nodeRows);
    return b;
  };
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          h.written.push(values);
          if (!h.updateHits) return [];
          return [{ ...(h.nodeRows[0] ?? {}), ...values }];
        },
      }),
    }),
  });
  return { db: { select, update } };
});

vi.mock('./audit', () => ({
  recordAudit: vi.fn(async () => {}),
  recordAuditBatch: vi.fn(async () => {}),
}));

import { recordAuditBatch } from './audit';
import { diffNodePatch } from './audit-diff';
import {
  mutateNodeConfig,
  revertNodeConfig,
  credentialFields,
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
  h.written = [];
  h.updateHits = true;
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
