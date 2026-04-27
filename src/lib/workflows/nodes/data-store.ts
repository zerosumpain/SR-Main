import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export { dataStoreDef } from './data-store.def';

export async function getStoreValue(
  workflowId: string,
  key: string,
): Promise<{ value: unknown; found: boolean }> {
  const [row] = await db
    .select()
    .from(workflowDataStore)
    .where(and(eq(workflowDataStore.workflowId, workflowId), eq(workflowDataStore.key, key)));

  return {
    value: row?.value ?? null,
    found: row !== undefined,
  };
}

export async function setStoreValue(
  workflowId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(workflowDataStore)
    .values({ workflowId, key, value: value as Parameters<typeof db.insert>[0], updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [workflowDataStore.workflowId, workflowDataStore.key],
      set: { value: value as Parameters<typeof db.insert>[0], updatedAt: new Date() },
    });
}

export const dataStoreExecutor: NodeExecutor = {
  type: 'data-store',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const rawOp = ((config.operation as string) || 'get').toLowerCase().trim();
    // Absorb the two LLM hallucinations that bite most often instead of
    // hard-failing the run: read→get, write→set. Saving still validates
    // against the canonical enum so the node config in storage stays clean,
    // but a stray "read"/"write" at execute time runs as you'd expect.
    const operation = rawOp === 'read' ? 'get' : rawOp === 'write' ? 'set' : rawOp;
    const key = interpolateTemplate((config.key as string) || '', input);
    const workflowId = context.workflowId;

    if (!workflowId) {
      throw new Error('data-store: workflowId not available in context');
    }
    if (!key) {
      throw new Error('data-store: key is required (supports {{input.field}} templates)');
    }
    if (operation !== 'get' && operation !== 'set') {
      throw new Error(
        `data-store: operation must be "get" or "set" (got ${JSON.stringify(rawOp)}).`,
      );
    }

    if (operation === 'get') {
      const result = await getStoreValue(workflowId, key);
      return { output: result, rowCount: 1 };
    }

    if (operation === 'set') {
      // valuePath lets config specify a dot-path into input; defaults to input.value or whole input
      const valuePath = config.valuePath as string | undefined;
      let value: unknown;

      if (valuePath) {
        value = resolvePath(input, valuePath);
      } else {
        value = input.value !== undefined ? input.value : input;
      }

      if (context.dryRun) {
        return {
          output: { simulated: true, would_write: { key, value } },
          rowCount: 1,
          logs: [`[dry-run] would set data-store key "${key}"`],
        };
      }

      await setStoreValue(workflowId, key, value);
      return { output: { key, value, stored: true }, rowCount: 1 };
    }

    return { output: { error: `Unknown operation: ${operation}` }, rowCount: 1 };
  },

  getInputSchema(_config: Record<string, unknown>) {
    return {
      type: 'object',
      description:
        'For set: input.value is stored (or use valuePath config to extract a nested field). Key supports {{input.field}} templates.',
    };
  },

  getOutputSchema(config: Record<string, unknown>) {
    if (config.operation === 'set') {
      return {
        type: 'object',
        properties: {
          key: { type: 'string' } as const,
          value: { type: 'any' } as const,
          stored: { type: 'boolean' } as const,
        } as Record<string, import('../types').JsonSchema>,
      };
    }
    return {
      type: 'object',
      properties: {
        value: { type: 'any', description: 'Stored value, or null if not found' } as const,
        found: { type: 'boolean' } as const,
      } as Record<string, import('../types').JsonSchema>,
    };
  },
};

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
