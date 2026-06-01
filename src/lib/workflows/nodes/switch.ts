import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { safeFunction } from './safe-eval';
import type { SwitchCase } from './switch.def';

export { switchDef } from './switch.def';

export const switchExecutor: NodeExecutor = {
  type: 'switch',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const cases = Array.isArray(config.cases) ? (config.cases as SwitchCase[]) : [];
    const defaultHandle = (config.defaultHandle as string) || 'default';

    // Tolerate both `input.x` and `return input.x` styles, same as conditional.ts.
    const rawExpression = (config.expression as string) || '';
    const expression = rawExpression.replace(/^\s*return\s+/, '').replace(/;\s*$/, '');

    let value: unknown;
    try {
      const fn = safeFunction(['input'], `return (${expression})`);
      value = fn(input);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // On evaluation error, route to default — mirrors conditional's
      // fail-safe-to-false behaviour so the run keeps flowing down a branch.
      return {
        output: {
          ...input,
          matchedHandle: defaultHandle,
          matchedCase: null,
          error: `Switch expression error: ${message}`,
        },
        metadata: { _selectedHandle: defaultHandle },
        rowCount: 1,
      };
    }

    // String-coerce both sides for equality so numeric / boolean values match
    // their string `match` entries (config cases are authored as strings).
    const valueKey = String(value);
    let selected = defaultHandle;
    let matchedCase: SwitchCase | null = null;
    for (const c of cases) {
      if (c && typeof c.handle === 'string' && String(c.match) === valueKey) {
        selected = c.handle;
        matchedCase = c;
        break;
      }
    }

    return {
      output: {
        ...input,
        matchedHandle: selected,
        matchedCase,
        value,
      },
      metadata: { _selectedHandle: selected },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available as `input` in the match expression' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description: 'Input passed through to the matched branch, plus matchedHandle / matchedCase / value',
    };
  },
};
