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
      return { output: { error: 'Not an array', path: arrayPath } };
    }

    const results: unknown[] = [];
    for (let i = 0; i < array.length; i++) {
      if (config.expression) {
        const fn = safeFunction(['item', 'index', 'input'], config.expression as string);
        results.push(fn(array[i], i, input));
      } else {
        results.push(array[i]);
      }
    }

    return { output: { results, count: results.length } };
  },

  getInputSchema() {
    return { type: 'object', description: 'Input object containing the array to iterate' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Object with results array and count' };
  },
};

