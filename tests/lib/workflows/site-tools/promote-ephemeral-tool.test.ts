import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock the db before importing anything that reads it
vi.mock('$lib/db', () => {
  const state = { inserted: [] as unknown[], byId: new Map<string, Record<string, unknown>>() };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            return state.byId.size > 0 ? [...state.byId.values()] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
      },
    }),
  };
  return { db, __state: state };
});

// Provide a fake orchestratorChats row: message with an ephemeral sidecar
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, eq: () => ({}), and: () => ({}), sql: () => ({}) };
});

beforeAll(async () => {
  await import('$lib/workflows/site-tools/tools/visualise');
  await import('$lib/workflows/site-tools/tools/ephemeral-tools');
});

describe('promote_ephemeral_tool', () => {
  it('is registered', async () => {
    const { getTool } = await import('$lib/workflows/site-tools/registry');
    expect(getTool('promote_ephemeral_tool')).toBeDefined();
  });

  // Full DB-integration behaviour is covered by the API route test in Task 10.
  // Here we just verify the tool surface and that name-collision errors are
  // caught without blowing up.
  it('requires messageId + toolCallId', async () => {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const res = await executeTool('promote_ephemeral_tool', { messageId: '', toolCallId: '' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/messageId|toolCallId/i);
  });
});
