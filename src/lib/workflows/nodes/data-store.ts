import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

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
    const operation = (config.operation as string) || 'get';
    const key = interpolateTemplate((config.key as string) || '', input);
    const workflowId = context.workflowId;

    if (!workflowId) {
      return { output: { error: 'workflowId not available in context' } };
    }

    if (operation === 'get') {
      const result = await getStoreValue(workflowId, key);
      return { output: result };
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

      await setStoreValue(workflowId, key, value);
      return { output: { key, value, stored: true } };
    }

    return { output: { error: `Unknown operation: ${operation}` } };
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

export const dataStoreDef: NodeDefinition = {
  type: 'data-store',
  label: 'Data Store',
  category: 'core',
  description: 'Read or write a value in the workflow-scoped key-value store. Persists across runs.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: "'get' or 'set'" },
      key: { type: 'string', description: 'Key name. Supports {{input.field}} templates.' },
      valuePath: {
        type: 'string',
        description: "Dot-path into input to extract the value to store (set only). Defaults to input.value or whole input.",
      },
    },
    required: ['operation', 'key'],
  },
  defaultConfig: { operation: 'get', key: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
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
