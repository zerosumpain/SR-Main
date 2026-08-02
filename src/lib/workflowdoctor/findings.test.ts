import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  records: [] as Array<{ key: string; data: unknown }>,
  collectionExists: true,
}));

vi.mock('$lib/datastore', () => {
  class DatastoreError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = 'DatastoreError';
    }
  }
  return {
    DatastoreError,
    ensureCollection: vi.fn(async (slug: string) => ({ id: slug })),
    getCollectionBySlug: vi.fn(async () => (h.collectionExists ? { id: 'c1' } : null)),
    getRecordByKey: vi.fn(async (_slug: string, key: string) => {
      const found = h.records.find((r) => r.key === key);
      if (!found) throw new DatastoreError('not_found', `record with key "${key}" not found`);
      return { key: found.key, data: found.data };
    }),
    queryRecords: vi.fn(async () => ({ records: h.records })),
    upsertRecord: vi.fn(async (_slug: string, rec: { key: string; data: unknown }) => {
      const i = h.records.findIndex((r) => r.key === rec.key);
      if (i >= 0) h.records[i] = rec;
      else h.records.push(rec);
      return { id: rec.key };
    }),
  };
});

import { ensureCollection, queryRecords } from '$lib/datastore';
import {
  ensureDoctorCollections,
  getFinding,
  listFindings,
  resolveStaleFindings,
  setFindingStatus,
  upsertFinding,
  type FindingInput,
} from './findings';
import { COLLECTIONS, findingKey, type DoctorFindingData } from './types';

function input(over: Partial<FindingInput> = {}): FindingInput {
  return {
    workflowId: 'wf1',
    workflowName: 'canvas:morning-briefing',
    canvasSlug: 'morning-briefing',
    nodeId: 'n1',
    nodeType: 'whatsapp',
    nodeLabel: 'Send WhatsApp',
    signature: 'Template references unresolved: input.results',
    fixKind: 'broken-input-ref',
    status: 'proposed',
    occurrences: 1,
    symptom: 'This node failed 1 time in the last 7 days.',
    cause: 'The template points at a field the upstream node does not emit.',
    causeSource: 'linter',
    fix: 'Repoint the reference at input.items.',
    runId: 'run-1',
    ...over,
  };
}

/** Seed a stored finding directly, so its timestamps are distinguishable. */
function seed(over: Partial<DoctorFindingData> = {}): string {
  const base = input();
  const key = findingKey(base.workflowId, base.nodeId ?? null, base.signature);
  h.records.push({
    key,
    data: {
      workflowId: base.workflowId,
      workflowName: base.workflowName,
      canvasSlug: base.canvasSlug ?? null,
      nodeId: base.nodeId ?? null,
      nodeType: base.nodeType ?? null,
      nodeLabel: base.nodeLabel ?? null,
      signature: base.signature,
      fixKind: base.fixKind,
      status: 'proposed',
      occurrences: 40,
      firstSeen: '2026-07-01T05:00:00.000Z',
      lastSeen: '2026-08-01T05:00:00.000Z',
      lastRunId: 'run-0',
      symptom: base.symptom,
      cause: base.cause,
      causeSource: base.causeSource,
      fix: base.fix,
      lintIssues: [],
      updatedAt: '2026-08-01T05:00:00.000Z',
      ...over,
    } satisfies DoctorFindingData,
  });
  return key;
}

function stored(key: string): DoctorFindingData {
  return h.records.find((r) => r.key === key)!.data as DoctorFindingData;
}

beforeEach(() => {
  h.records = [];
  h.collectionExists = true;
  vi.clearAllMocks();
});

describe('ensureDoctorCollections', () => {
  it('seeds both system collections and is safe to call twice', async () => {
    await ensureDoctorCollections();
    await ensureDoctorCollections();
    const slugs = vi.mocked(ensureCollection).mock.calls.map((c) => c[0]);
    expect(slugs).toEqual([
      COLLECTIONS.doctorRuns,
      COLLECTIONS.doctorFindings,
      COLLECTIONS.doctorRuns,
      COLLECTIONS.doctorFindings,
    ]);
    expect(vi.mocked(ensureCollection).mock.calls[0][1]).toMatchObject({ isSystem: true });
  });
});

describe('upsertFinding — accumulation is the signal', () => {
  it('adds tonight occurrences to the running total and keeps firstSeen', async () => {
    const key = seed();
    const after = await upsertFinding(input({ occurrences: 13, runId: 'run-2' }));

    expect(after.occurrences).toBe(53);
    expect(after.firstSeen).toBe('2026-07-01T05:00:00.000Z');
    expect(after.lastSeen).not.toBe('2026-08-01T05:00:00.000Z');
    expect(after.lastRunId).toBe('run-2');
    expect(h.records).toHaveLength(1);
    expect(stored(key).occurrences).toBe(53);
  });

  it('writes one record per (workflow, node, signature)', async () => {
    await upsertFinding(input());
    await upsertFinding(input());
    await upsertFinding(input({ nodeId: 'n2' }));
    expect(h.records).toHaveLength(2);
    expect(stored(findingKey('wf1', 'n1', input().signature)).occurrences).toBe(2);
  });

  it('refreshes the plain-English triple and the lint issues', async () => {
    const key = seed();
    await upsertFinding(
      input({
        symptom: 'This node failed 53 times in the last 7 days.',
        cause: 'The node type no longer exists.',
        causeSource: 'signature',
        fix: 'Remap the node to apple-calendar.',
        lintIssues: [{ field: 'type', issue: 'unknown node type', severity: 'error' }],
      }),
    );
    const rec = stored(key);
    expect(rec.symptom).toContain('53 times');
    expect(rec.cause).toBe('The node type no longer exists.');
    expect(rec.causeSource).toBe('signature');
    expect(rec.fix).toBe('Remap the node to apple-calendar.');
    expect(rec.lintIssues).toHaveLength(1);
  });

  it('starts a brand-new finding at tonight count with firstSeen === lastSeen', async () => {
    const rec = await upsertFinding(input({ occurrences: 4 }));
    expect(rec.occurrences).toBe(4);
    expect(rec.firstSeen).toBe(rec.lastSeen);
    expect(rec.status).toBe('proposed');
  });
});

describe('upsertFinding — a human verdict is sticky', () => {
  it('does not push a dismissed finding back to proposed', async () => {
    const key = seed({ status: 'dismissed' });
    const after = await upsertFinding(input({ status: 'proposed', occurrences: 5 }));
    expect(after.status).toBe('dismissed');
    // The count still climbs — the owner dismissed the proposal, not the facts.
    expect(after.occurrences).toBe(45);
    expect(stored(key).status).toBe('dismissed');
  });

  it('does not resolve an accepted finding by observation', async () => {
    seed({ status: 'accepted' });
    const after = await upsertFinding(input({ status: 'resolved' }));
    expect(after.status).toBe('accepted');
  });

  it('still records a real mutation over a verdict', async () => {
    seed({ status: 'accepted' });
    const after = await upsertFinding(input({ status: 'auto_fixed' }));
    expect(after.status).toBe('auto_fixed');
  });
});

describe('upsertFinding — nothing sensitive reaches the record', () => {
  it('stores a signature carrying an API key redacted', async () => {
    const secret = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const rec = await upsertFinding(
      input({
        signature: `OpenRouter rejected key ${secret}`,
        cause: `The stored credential ${secret} is no longer valid.`,
        symptom: 'Reach the owner on +44 7359 228511 said the log.',
        fix: 'Rotate the key in /admin/ai/apis.',
      }),
    );

    expect(rec.signature).toContain('[redacted:api-key]');
    expect(rec.signature).not.toContain(secret);
    expect(rec.cause).not.toContain(secret);
    expect(rec.symptom).toContain('[redacted:phone]');
    expect(JSON.stringify(h.records)).not.toContain(secret);
  });

  it('keeps field NAMES only, stripping a value a caller pasted in', async () => {
    const rec = await upsertFinding(
      input({
        status: 'refused_sensitive',
        fixKind: 'secret-in-node-config',
        sensitiveFields: ['headers.Authorization=Bearer abcdefghijklmnopqrstuvwxyz', 'apiKey', 'apiKey'],
      }),
    );
    expect(rec.sensitiveFields).toEqual(['headers.Authorization', 'apiKey']);
    expect(JSON.stringify(rec)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});

describe('listFindings', () => {
  it('asks for newest-updated first and tolerates an unseeded collection', async () => {
    h.collectionExists = false;
    expect(await listFindings()).toEqual([]);
    expect(vi.mocked(queryRecords)).not.toHaveBeenCalled();

    h.collectionExists = true;
    seed();
    const rows = await listFindings({ limit: 30 });
    expect(rows).toHaveLength(1);
    expect(vi.mocked(queryRecords)).toHaveBeenCalledWith(
      COLLECTIONS.doctorFindings,
      { sort: { field: 'updatedAt', dir: 'desc' }, limit: 30 },
      'system',
    );
  });

  it('filters by status when asked', async () => {
    seed({ status: 'proposed' });
    h.records.push({ ...h.records[0], key: 'other', data: { ...stored(h.records[0].key), status: 'resolved' } });
    expect(await listFindings({ status: 'resolved' })).toHaveLength(1);
    expect(await listFindings({ status: ['proposed', 'resolved'] })).toHaveLength(2);
  });
});

describe('getFinding / setFindingStatus', () => {
  it('returns null for an unknown key rather than throwing', async () => {
    expect(await getFinding('nope')).toBeNull();
    expect(await setFindingStatus('nope', 'dismissed')).toBeNull();
  });

  it('records the verdict and applies the patch through the same scrub', async () => {
    const key = seed();
    const after = await setFindingStatus(key, 'reverted', {
      fix: 'Reverted: the key sk-or-v1-0123456789abcdef0123456789abcdef was in the diff.',
    });
    expect(after?.status).toBe('reverted');
    expect(after?.fix).toContain('[redacted:api-key]');
    expect(after?.occurrences).toBe(40);
    expect(stored(key).status).toBe('reverted');
  });
});

describe('resolveStaleFindings — how a fixed problem stops being reported', () => {
  it('closes only open findings this run did not see again', async () => {
    const seenKey = seed({ status: 'proposed' });
    h.records.push(
      { key: 'stale-proposed', data: { ...stored(seenKey), status: 'proposed' } },
      { key: 'stale-fixed', data: { ...stored(seenKey), status: 'auto_fixed' } },
      { key: 'human-dismissed', data: { ...stored(seenKey), status: 'dismissed' } },
      { key: 'already-resolved', data: { ...stored(seenKey), status: 'resolved' } },
      { key: 'refused', data: { ...stored(seenKey), status: 'refused_sensitive' } },
    );

    const count = await resolveStaleFindings([seenKey], 'run-9');

    expect(count).toBe(2);
    expect(stored(seenKey).status).toBe('proposed');
    expect(stored('stale-proposed').status).toBe('resolved');
    expect(stored('stale-fixed').status).toBe('resolved');
    expect(stored('stale-fixed').lastRunId).toBe('run-9');
    expect(stored('human-dismissed').status).toBe('dismissed');
    expect(stored('already-resolved').status).toBe('resolved');
    expect(stored('refused').status).toBe('refused_sensitive');
  });

  it('preserves the accumulated history of a finding it closes', async () => {
    const key = seed({ status: 'proposed', occurrences: 5053 });
    await resolveStaleFindings(new Set<string>(), 'run-9');
    expect(stored(key)).toMatchObject({
      status: 'resolved',
      occurrences: 5053,
      firstSeen: '2026-07-01T05:00:00.000Z',
    });
  });

  it('returns 0 when the collection has not been seeded yet', async () => {
    h.collectionExists = false;
    expect(await resolveStaleFindings(['x'], 'run-9')).toBe(0);
  });
});
