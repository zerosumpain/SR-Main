import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { safeFunction, UnsafeExpressionError } from './safe-eval';

export { loopDef } from './loop.def';

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export const loopExecutor: NodeExecutor = {
  type: 'loop',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const arrayPath = (config.arrayPath as string) || '';
    const array = resolvePath(input, arrayPath);

    if (!Array.isArray(array)) {
      return { output: { error: 'Not an array', path: arrayPath }, rowCount: 1 };
    }

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

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        results: { type: 'array', description: 'Array of results from each iteration' },
        count: { type: 'number', description: 'Number of iterations completed' },
      },
    };
  },
};

