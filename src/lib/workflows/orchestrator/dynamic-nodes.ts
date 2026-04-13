import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { NodeDefinition, NodeExecutor, NodeResult, ExecutionContext } from '../types';

export const DYNAMIC_NODES_DIR = join(homedir(), '.strange-rambling', 'workflow-nodes');

export interface SyntaxCheckResult {
  valid: boolean;
  error?: string;
}

export function validateExecutorSyntax(code: string): SyntaxCheckResult {
  // Strip ESM export keywords so new Function() can parse them as regular declarations
  const stripped = code.replace(/^export\s+/gm, '');
  try {
    new Function(stripped);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Unknown syntax error',
    };
  }
}

export function saveDynamicNode(
  baseDir: string,
  definition: Omit<NodeDefinition, 'basicConfig' | 'llmDescription' | 'llmExamples'> & {
    llmDescription?: string;
    llmExamples?: Record<string, unknown>[];
  },
  executorCode: string,
): void {
  const nodeDir = join(baseDir, definition.type);
  mkdirSync(nodeDir, { recursive: true });

  writeFileSync(
    join(nodeDir, 'definition.json'),
    JSON.stringify(definition, null, 2),
    'utf-8',
  );

  writeFileSync(
    join(nodeDir, 'executor.js'),
    executorCode,
    'utf-8',
  );
}

export function loadDynamicNodeDefinitions(baseDir: string): NodeDefinition[] {
  if (!existsSync(baseDir)) return [];

  const definitions: NodeDefinition[] = [];
  let entries: string[];

  try {
    entries = readdirSync(baseDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const entryPath = join(baseDir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;

      const defPath = join(entryPath, 'definition.json');
      if (!existsSync(defPath)) continue;

      const raw = readFileSync(defPath, 'utf-8');
      const def = JSON.parse(raw) as NodeDefinition;

      if (!def.type || !def.label || !def.category) continue;

      definitions.push(def);
    } catch {
      continue;
    }
  }

  return definitions;
}

export async function loadDynamicNodeExecutor(
  baseDir: string,
  nodeType: string,
): Promise<NodeExecutor | null> {
  const executorPath = join(baseDir, nodeType, 'executor.js');
  if (!existsSync(executorPath)) return null;

  try {
    const mod = await import(/* @vite-ignore */ `file://${executorPath}`);
    const executeFn = mod.execute || mod.default?.execute;

    if (typeof executeFn !== 'function') {
      console.warn(`[dynamic-nodes] ${nodeType}: no execute function exported`);
      return null;
    }

    return {
      type: nodeType,
      async execute(
        input: Record<string, unknown>,
        config: Record<string, unknown>,
        context: ExecutionContext,
      ): Promise<NodeResult> {
        const result = await executeFn(input, config, context);
        return {
          output: result.output || {},
          logs: result.logs || [],
          metadata: result.metadata,
        };
      },
      getInputSchema() {
        if (typeof mod.getInputSchema === 'function') return mod.getInputSchema();
        return { type: 'object' };
      },
      getOutputSchema() {
        if (typeof mod.getOutputSchema === 'function') return mod.getOutputSchema();
        return { type: 'object' };
      },
    };
  } catch (err) {
    console.error(`[dynamic-nodes] Failed to load executor for ${nodeType}:`, err);
    return null;
  }
}

export function ensureDynamicNodesDir(): void {
  mkdirSync(DYNAMIC_NODES_DIR, { recursive: true });
}
