import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { safeFunction } from '$lib/utils/safe-eval';
import { getPath as resolvePath } from '../expressions';
import { FatalError } from '../errors';

export { loopDef } from './loop.def';

/** One entry in the subworkflow-mode results array. */
interface LoopItemResult {
  index: number;
  status: 'succeeded' | 'failed';
  output?: Record<string, unknown>;
  error?: string;
}

/**
 * `subworkflow` mode — per-item fan-out. For each element of the input array,
 * invoke a saved sub-workflow with input `{ item, index }` through the SAME
 * primitive the sub-workflow node uses (`runSubWorkflowDefinition`), collecting
 * a per-item result. Bounded concurrency (default 3, max 10), a hard maxItems
 * cap (default 50), and a failure policy ('continue' default | 'stop').
 *
 * Guards: rejects a missing/self-referential sub-workflow id; honours
 * `context.abortSignal` between items; in a test run each child is a test run.
 *
 * Each item is a child run (its own workflow_runs row). Children never take a
 * top-level run slot, so a fan-out cannot deadlock behind MAX_CONCURRENT_RUNS.
 * A child that pauses for a person counts as a failed item: a loop cannot wait.
 */
async function executeSubworkflowMode(
  input: Record<string, unknown>,
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<NodeResult> {
  const arrayPath = (config.arrayPath as string) || '';
  const array = resolvePath(input, arrayPath);

  if (!Array.isArray(array)) throw new FatalError(`Not an array at path "${arrayPath}"`);

  const subWorkflowId = String(config.subWorkflowId ?? '').trim();
  if (!subWorkflowId) throw new FatalError('No subWorkflowId configured');

  // Hard self-recursion reject: a loop must never invoke its own workflow.
  if (subWorkflowId === context.workflowId) {
    throw new FatalError(`Self-recursion rejected: loop cannot invoke its own workflow (${subWorkflowId})`);
  }

  // maxItems: hard cap on how many elements we fan out (default 50).
  const rawMax = Number(config.maxItems);
  const maxItems = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 50;
  const truncated = array.length > maxItems;
  const items = truncated ? array.slice(0, maxItems) : array;

  // concurrency: default 3, clamped to [1, 10].
  const rawConc = Number(config.concurrency);
  const concurrency =
    Number.isFinite(rawConc) && rawConc >= 1 ? Math.min(10, Math.floor(rawConc)) : 3;

  const failurePolicy = config.failurePolicy === 'stop' ? 'stop' : 'continue';

  const { loadSubWorkflowDefinition, runSubWorkflowDefinition } = await import(
    '$lib/workflows/nodes/sub-workflow'
  );

  const definition = await loadSubWorkflowDefinition(subWorkflowId);
  if (!definition) throw new FatalError(`Sub-workflow not found: ${subWorkflowId}`);

  // Sparse array — each worker writes its result at the item's original index,
  // so output order matches input order regardless of completion order.
  const results = new Array<LoopItemResult | undefined>(items.length);
  let next = 0;
  let stopped = false; // failurePolicy === 'stop' tripped a hard halt
  let aborted = false; // context.abortSignal fired mid-pool

  const worker = async (): Promise<void> => {
    while (true) {
      if (stopped) return;
      if (context.abortSignal.aborted) {
        aborted = true;
        return;
      }
      const i = next++;
      if (i >= items.length) return;

      try {
        const res = await runSubWorkflowDefinition(definition, { item: items[i], index: i }, context);
        if (res.status !== 'completed') {
          const error = res.status === 'awaiting_human' ? 'Sub-workflow paused for a person; loop items cannot wait' : res.error;
          results[i] = { index: i, status: 'failed', error: error || 'Sub-workflow error' };
          if (failurePolicy === 'stop') {
            stopped = true;
            return;
          }
        } else {
          results[i] = { index: i, status: 'succeeded', output: res.output };
        }
      } catch (err) {
        results[i] = {
          index: i,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
        if (failurePolicy === 'stop') {
          stopped = true;
          return;
        }
      }
    }
  };

  const pool = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));

  // `filter` skips holes, so only actually-processed items are reported.
  const collected: LoopItemResult[] = results.filter((r): r is LoopItemResult => r !== undefined);
  const succeeded = collected.filter((r) => r.status === 'succeeded').length;
  const failed = collected.filter((r) => r.status === 'failed').length;

  const logs: string[] = [];
  if (truncated) {
    logs.push(
      `Loop truncated: ${array.length} items exceeded maxItems=${maxItems}; processed first ${items.length}.`,
    );
  }
  if (stopped) logs.push('Loop halted early on first failure (failurePolicy=stop).');
  if (aborted) logs.push('Loop aborted mid-run (abort signal).');

  return {
    output: {
      results: collected,
      succeeded,
      failed,
      count: collected.length,
      truncated,
      totalItems: array.length,
    },
    logs: logs.length ? logs : undefined,
    rowCount: collected.length,
  };
}

export const loopExecutor: NodeExecutor = {
  type: 'loop',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    if (config.mode === 'subworkflow') {
      return executeSubworkflowMode(input, config, context);
    }

    // ---- map mode (default, unchanged) --------------------------------------
    const arrayPath = (config.arrayPath as string) || '';
    const array = resolvePath(input, arrayPath);

    if (!Array.isArray(array)) throw new FatalError(`Not an array at path "${arrayPath}"`);

    // Compile the per-item expression once (it is synchronous: `new Function`).
    const fn = config.expression
      ? safeFunction(['item', 'index', 'input'], config.expression as string)
      : null;

    // Apply the transform to one element. Wrapped so a worker can `await` it —
    // the body is synchronous today, but awaiting keeps the pool correct if an
    // expression ever returns a Promise.
    const runOne = async (item: unknown, index: number): Promise<unknown> =>
      fn ? fn(item, index, input) : item;

    // Bounded-concurrency pool. `concurrency` (default 1) caps how many items
    // are in flight at once. With concurrency === 1 this is a plain sequential
    // for-loop — byte-for-byte identical to the previous implementation and to
    // an unset config — so existing canvases are unaffected. Results are always
    // written back at their original index, so output order matches input order
    // regardless of the bound.
    const rawConcurrency = Number(config.concurrency);
    const concurrency =
      Number.isFinite(rawConcurrency) && rawConcurrency >= 1
        ? Math.floor(rawConcurrency)
        : 1;

    const results: unknown[] = new Array(array.length);

    if (concurrency === 1) {
      for (let i = 0; i < array.length; i++) {
        results[i] = await runOne(array[i], i);
      }
    } else {
      let next = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const i = next++;
          if (i >= array.length) return;
          results[i] = await runOne(array[i], i);
        }
      };
      const pool = Math.min(concurrency, array.length);
      await Promise.all(Array.from({ length: pool }, () => worker()));
    }

    return { output: { results, count: results.length }, rowCount: results.length };
  },

  getInputSchema() {
    return { type: 'object', description: 'Input object containing the array to iterate' };
  },

  getOutputSchema(config: Record<string, unknown>): JsonSchema {
    if (config?.mode === 'subworkflow') {
      return {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            description:
              'Per-item results: { index, status: "succeeded"|"failed", output?, error? }',
          },
          succeeded: { type: 'number', description: 'How many items succeeded' },
          failed: { type: 'number', description: 'How many items failed' },
          count: { type: 'number', description: 'How many items were processed' },
          truncated: { type: 'boolean', description: 'True when maxItems capped the input' },
          totalItems: { type: 'number', description: 'Length of the source array before capping' },
        },
      };
    }
    return {
      type: 'object',
      properties: {
        results: { type: 'array', description: 'Array of results from each iteration' },
        count: { type: 'number', description: 'Number of iterations completed' },
      },
    };
  },
};
