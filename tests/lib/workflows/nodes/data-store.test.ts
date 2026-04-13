import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock $lib/db before importing the executor
const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockReturning = vi.fn();
const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
const mockInsertValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

vi.mock('$lib/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
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

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
}));

const { dataStoreExecutor, dataStoreDef } = await import('$lib/workflows/nodes/data-store');

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: 'wf-123',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chain mocks
  mockWhere.mockResolvedValue([]);
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockReturning.mockResolvedValue([{ id: '1' }]);
  mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
  mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockInsert.mockReturnValue({ values: mockInsertValues });
});

describe('dataStoreExecutor', () => {
  it('has correct type', () => {
    expect(dataStoreExecutor.type).toBe('data-store');
  });

  describe('get operation', () => {
    it('returns value and found:true when key exists', async () => {
      mockWhere.mockResolvedValue([{ value: { count: 5 } }]);

      const result = await dataStoreExecutor.execute(
        {},
        { operation: 'get', key: 'my-key' },
        mockContext,
      );

      expect(result.output.found).toBe(true);
      expect(result.output.value).toEqual({ count: 5 });
      expect(mockSelect).toHaveBeenCalled();
    });

    it('returns value:null and found:false when key does not exist', async () => {
      mockWhere.mockResolvedValue([]);

      const result = await dataStoreExecutor.execute(
        {},
        { operation: 'get', key: 'missing-key' },
        mockContext,
      );

      expect(result.output.found).toBe(false);
      expect(result.output.value).toBeNull();
    });

    it('interpolates template variables in key', async () => {
      mockWhere.mockResolvedValue([{ value: 'hello' }]);

      const result = await dataStoreExecutor.execute(
        { userId: '42' },
        { operation: 'get', key: 'user-{{input.userId}}' },
        mockContext,
      );

      // The eq mock captures calls — verify the interpolated key was used
      const { eq } = await import('drizzle-orm');
      const calls = vi.mocked(eq).mock.calls;
      const keyCall = calls.find((c) => c[1] === 'user-42');
      expect(keyCall).toBeDefined();
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
      expect(result.output.key).toBe('greeting');
      expect(result.output.value).toBe('hello world');
    });

    it('stores whole input when input.value is undefined', async () => {
      const input = { name: 'alice', age: 30 };
      const result = await dataStoreExecutor.execute(
        input,
        { operation: 'set', key: 'person' },
        mockContext,
      );

      expect(result.output.value).toEqual(input);
      expect(result.output.stored).toBe(true);
    });

    it('uses valuePath to extract nested value', async () => {
      const result = await dataStoreExecutor.execute(
        { user: { id: 'u-99', name: 'Bob' } },
        { operation: 'set', key: 'last-user-id', valuePath: 'user.id' },
        mockContext,
      );

      expect(result.output.value).toBe('u-99');
      expect(result.output.stored).toBe(true);
    });
  });

  it('returns error output for unknown operation', async () => {
    const result = await dataStoreExecutor.execute(
      {},
      { operation: 'delete', key: 'x' },
      mockContext,
    );
    expect(result.output.error).toMatch(/Unknown operation/);
  });

  it('returns error output when workflowId is missing', async () => {
    const contextNoWorkflow = { ...mockContext, workflowId: '' };
    const result = await dataStoreExecutor.execute({}, { operation: 'get', key: 'x' }, contextNoWorkflow);
    expect(result.output.error).toMatch(/workflowId/);
  });
});

describe('dataStoreDef', () => {
  it('is core category', () => {
    expect(dataStoreDef.category).toBe('core');
  });

  it('has operation and key in configSchema', () => {
    expect(dataStoreDef.configSchema.properties?.operation).toBeDefined();
    expect(dataStoreDef.configSchema.properties?.key).toBeDefined();
  });

  it('has data-store type', () => {
    expect(dataStoreDef.type).toBe('data-store');
  });

  it('has correct default config', () => {
    expect(dataStoreDef.defaultConfig.operation).toBe('get');
  });
});
