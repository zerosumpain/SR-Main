import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock $lib/db before importing the executor.
const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockReturning = vi.fn();
const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
const mockInsertValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockExecute = vi.fn();

vi.mock('$lib/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    execute: mockExecute,
  },
}));

vi.mock('$lib/db/schema', () => ({
  workflowDataStore: {
    workflowId: 'workflow_id',
    key: 'key',
    value: 'value',
    updatedAt: 'updated_at',
    id: 'id',
  },
}));

// Keep the REAL `sql` tag (the atomic helpers build raw SQL) but spy on the
// comparison operators so the interpolation test can assert on them.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    and: vi.fn((...args) => ({ type: 'and', args })),
    eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  };
});

const { dataStoreExecutor, dataStoreDef, addToSetAtomic } = await import(
  '$lib/workflows/nodes/data-store'
);

const dialect = new PgDialect();
/** Render the SQL object last passed to db.execute() to a plain string. */
function lastExecuteSql(): string {
  const call = mockExecute.mock.calls.at(-1);
  if (!call) throw new Error('db.execute was not called');
  return dialect.sqlToQuery(call[0]).sql;
}

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: 'wf-123',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
  getOutgoingEdges: () => [],
  getIncomingEdges: () => [],
  getNodeConfig: () => undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockResolvedValue([]);
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockReturning.mockResolvedValue([{ id: '1' }]);
  mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
  mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockExecute.mockResolvedValue({ rows: [] });
});

describe('dataStoreExecutor', () => {
  it('has correct type', () => {
    expect(dataStoreExecutor.type).toBe('data-store');
  });

  describe('get operation', () => {
    it('returns value and found:true when key exists', async () => {
      mockWhere.mockResolvedValue([{ value: { count: 5 } }]);
      const result = await dataStoreExecutor.execute({}, { operation: 'get', key: 'my-key' }, mockContext);
      expect(result.output.found).toBe(true);
      expect(result.output.value).toEqual({ count: 5 });
    });

    it('returns value:null and found:false when key does not exist', async () => {
      mockWhere.mockResolvedValue([]);
      const result = await dataStoreExecutor.execute({}, { operation: 'get', key: 'missing' }, mockContext);
      expect(result.output.found).toBe(false);
      expect(result.output.value).toBeNull();
    });

    it('returns config.default when not found', async () => {
      mockWhere.mockResolvedValue([]);
      const result = await dataStoreExecutor.execute(
        {},
        { operation: 'get', key: 'cursor', default: '0' },
        mockContext,
      );
      expect(result.output.found).toBe(false);
      expect(result.output.value).toBe('0');
    });

    it('passthrough merges the value into the input under outputKey', async () => {
      mockWhere.mockResolvedValue([{ value: 'abc' }]);
      const result = await dataStoreExecutor.execute(
        { query: 'news', page: 2 },
        { operation: 'get', key: 'cursor', passthrough: true, outputKey: 'sinceId' },
        mockContext,
      );
      expect(result.output).toEqual({ query: 'news', page: 2, sinceId: 'abc', found: true });
    });

    it('interpolates template variables in key', async () => {
      mockWhere.mockResolvedValue([{ value: 'hello' }]);
      const result = await dataStoreExecutor.execute(
        { userId: '42' },
        { operation: 'get', key: 'user-{{input.userId}}' },
        mockContext,
      );
      const { eq } = await import('drizzle-orm');
      const calls = vi.mocked(eq).mock.calls;
      expect(calls.find((c) => c[1] === 'user-42')).toBeDefined();
      expect(result.output.found).toBe(true);
    });
  });

  describe('set operation', () => {
    it('stores input.value and returns stored:true', async () => {
      const result = await dataStoreExecutor.execute(
        { value: 'hello world' },
        { operation: 'set', key: 'greeting' },
        mockContext,
      );
      expect(mockInsert).toHaveBeenCalled();
      expect(result.output.stored).toBe(true);
      expect(result.output.value).toBe('hello world');
    });

    it('uses valuePath to extract nested value', async () => {
      const result = await dataStoreExecutor.execute(
        { user: { id: 'u-99' } },
        { operation: 'set', key: 'last-user-id', valuePath: 'user.id' },
        mockContext,
      );
      expect(result.output.value).toBe('u-99');
    });
  });

  describe('append operation', () => {
    it('pushes input.value and returns the resulting array', async () => {
      mockExecute.mockResolvedValue({ rows: [{ value: ['a', 'b'] }] });
      const result = await dataStoreExecutor.execute(
        { value: 'b' },
        { operation: 'append', key: 'log' },
        mockContext,
      );
      expect(result.output.value).toEqual(['a', 'b']);
      expect(result.output.count).toBe(2);
      const q = lastExecuteSql();
      expect(q).toMatch(/INSERT INTO workflow_data_store/);
      expect(q).toMatch(/ON CONFLICT/);
      expect(q).toMatch(/workflow_data_store\.value/); // atomic — no JS read-modify-write
    });

    it('applies maxItems trim in the same statement', async () => {
      mockExecute.mockResolvedValue({ rows: [{ value: ['x'] }] });
      await dataStoreExecutor.execute(
        { value: 'x' },
        { operation: 'append', key: 'log', maxItems: 3 },
        mockContext,
      );
      expect(lastExecuteSql()).toMatch(/ORDER BY ord DESC\s+LIMIT/);
    });
  });

  describe('add_to_set operation', () => {
    it('unions an array value and dedupes inside the UPDATE expression', async () => {
      mockExecute.mockResolvedValue({ rows: [{ value: ['a', 'b', 'c'] }] });
      const result = await dataStoreExecutor.execute(
        { value: ['b', 'c'] },
        { operation: 'add_to_set', key: 'seen' },
        mockContext,
      );
      expect(result.output.value).toEqual(['a', 'b', 'c']);
      const q = lastExecuteSql();
      expect(q).toMatch(/DISTINCT ON/); // dedupe inside the statement
      expect(q).toMatch(/ON CONFLICT/);
      expect(q).toMatch(/workflow_data_store\.value/);
    });

    it('is atomic under concurrency — each writer issues one single statement', async () => {
      mockExecute.mockResolvedValue({ rows: [{ value: ['a', 'b', 'c'] }] });
      await Promise.all([
        addToSetAtomic('wf-123', 'seen', ['a', 'b']),
        addToSetAtomic('wf-123', 'seen', ['b', 'c']),
      ]);
      expect(mockExecute).toHaveBeenCalledTimes(2);
      for (const call of mockExecute.mock.calls) {
        const s = dialect.sqlToQuery(call[0]).sql;
        // Exactly one upsert per call, referencing the live row (no lost update).
        expect(s.match(/INSERT INTO workflow_data_store/g)).toHaveLength(1);
        expect(s).toMatch(/DO UPDATE SET value =[\s\S]*workflow_data_store\.value/);
      }
    });
  });

  describe('has operation', () => {
    it('returns true when the value is in the stored set', async () => {
      mockWhere.mockResolvedValue([{ value: ['a', 'b'] }]);
      const result = await dataStoreExecutor.execute(
        { value: 'a' },
        { operation: 'has', key: 'seen' },
        mockContext,
      );
      expect(result.output.value).toBe(true);
      expect(result.output.key).toBe('seen');
    });

    it('returns false when the value is absent', async () => {
      mockWhere.mockResolvedValue([{ value: ['a', 'b'] }]);
      const result = await dataStoreExecutor.execute(
        { value: 'z' },
        { operation: 'has', key: 'seen' },
        mockContext,
      );
      expect(result.output.value).toBe(false);
    });
  });

  describe('increment operation', () => {
    it('adds config.amount atomically and returns the new value', async () => {
      mockExecute.mockResolvedValue({ rows: [{ value: 6 }] });
      const result = await dataStoreExecutor.execute(
        {},
        { operation: 'increment', key: 'counter', amount: 5 },
        mockContext,
      );
      expect(result.output.value).toBe(6);
      const q = lastExecuteSql();
      expect(q).toMatch(/to_jsonb/);
      expect(q).toMatch(/workflow_data_store\.value/);
    });
  });

  describe('delete operation', () => {
    it('returns deleted:true when a row was removed', async () => {
      mockExecute.mockResolvedValue({ rows: [{ id: '1' }] });
      const result = await dataStoreExecutor.execute({}, { operation: 'delete', key: 'k' }, mockContext);
      expect(result.output.deleted).toBe(true);
      expect(lastExecuteSql()).toMatch(/DELETE FROM workflow_data_store/);
    });

    it('returns deleted:false when nothing matched', async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      const result = await dataStoreExecutor.execute({}, { operation: 'delete', key: 'k' }, mockContext);
      expect(result.output.deleted).toBe(false);
    });
  });

  describe('dry run', () => {
    it('does not write for append', async () => {
      const result = await dataStoreExecutor.execute(
        { value: 'x' },
        { operation: 'append', key: 'log' },
        { ...mockContext, dryRun: true },
      );
      expect(mockExecute).not.toHaveBeenCalled();
      expect(result.output.simulated).toBe(true);
    });
  });

  describe('operation aliases + validation', () => {
    it('maps read → get', async () => {
      mockWhere.mockResolvedValue([{ value: 1 }]);
      const result = await dataStoreExecutor.execute({}, { operation: 'read', key: 'k' }, mockContext);
      expect(result.output.found).toBe(true);
    });

    it('throws on a genuinely unknown operation', async () => {
      await expect(
        dataStoreExecutor.execute({}, { operation: 'frobnicate', key: 'x' }, mockContext),
      ).rejects.toThrow(/operation must be one of/);
    });

    it('throws when workflowId is missing', async () => {
      const ctx = { ...mockContext, workflowId: '' };
      await expect(
        dataStoreExecutor.execute({}, { operation: 'get', key: 'x' }, ctx),
      ).rejects.toThrow(/workflowId not available/);
    });
  });
});

describe('dataStoreDef', () => {
  it('is core category', () => {
    expect(dataStoreDef.category).toBe('core');
  });

  it('lists the new operations in configSchema enum', () => {
    const enumVals = dataStoreDef.configSchema.properties?.operation?.enum as string[];
    expect(enumVals).toEqual(
      expect.arrayContaining(['get', 'set', 'append', 'add_to_set', 'has', 'increment', 'delete']),
    );
  });

  it('llmExamples use {{input.*}} template syntax (not trigger.output)', () => {
    const serialised = JSON.stringify(dataStoreDef.llmExamples ?? []);
    expect(serialised).not.toMatch(/trigger\.output/);
  });
});
