import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { safeFunction, UnsafeExpressionError } from './safe-eval';

/**
 * LLMs writing transform bodies often skip the explicit `return` and just
 * leave a value expression at the end (arrow-function-body style):
 *   `const r = input; ({ message: \`x\` })`
 * Without a `return`, `new Function(body)` evaluates the expression then
 * returns undefined → downstream nodes get empty input → silent failure
 * (this is exactly what broke whatsapp sends from canvas builds).
 *
 * If the body already contains a `return`, leave it alone. Otherwise:
 *   1. Try wrapping the whole body as `return (body)`. Works for single
 *      expressions (`{ ...input, x: 1 }`, `input.body.value`).
 *   2. If that doesn't parse, find the last top-level semicolon and stick
 *      `return ` in front of whatever follows it. Handles the common
 *      `const x = ...; <expression>` pattern.
 * If neither works, fall back to the raw body and let the executor catch
 * the resulting undefined / SyntaxError.
 */
function ensureReturn(rawBody: string): string {
  if (/\breturn\b/.test(rawBody)) return rawBody;
  const wrapped = `return (${rawBody.trim().replace(/;+\s*$/, '')});`;
  try {
    new Function('input', wrapped);
    return wrapped;
  } catch {
    // fall through
  }
  const lastSemi = rawBody.lastIndexOf(';');
  if (lastSemi >= 0) {
    const head = rawBody.slice(0, lastSemi + 1);
    const tail = rawBody.slice(lastSemi + 1).trim().replace(/;+\s*$/, '');
    if (tail) {
      const candidate = `${head} return (${tail});`;
      try {
        new Function('input', candidate);
        return candidate;
      } catch {
        // fall through
      }
    }
  }
  return rawBody;
}

export const transformExecutor: NodeExecutor = {
  type: 'transform',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const expression = config.expression as string | undefined;

    if (!expression) {
      return { output: { ...input }, rowCount: 1 };
    }

    const body = ensureReturn(expression);

    try {
      const fn = safeFunction(['input'], body);
      const result = fn(input);
      const output = result && typeof result === 'object' ? result : { result };
      return { output, rowCount: 1 };
    } catch (err: unknown) {
      if (err instanceof UnsafeExpressionError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Transform expression failed: ${message}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Any data from upstream nodes' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    if (config.outputSchema && typeof config.outputSchema === 'object') {
      return config.outputSchema as JsonSchema;
    }
    if (!config.expression) {
      return { type: 'object', description: 'Input passed through unchanged' };
    }
    return { type: 'object', description: 'Result of transform expression' };
  },
};

export const transformDef: NodeDefinition = {
  type: 'transform',
  label: 'Transform',
  category: 'core',
  description: 'Reshape data with a JavaScript expression. The input object is available as `input`.',
  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JS function body. Use `input` to access upstream data. Must return an object.',
      },
      outputSchema: {
        type: 'object',
        description: 'Optional: declare the output shape so downstream nodes get autocomplete. e.g. { "score": { "type": "number" }, "label": { "type": "string" } }',
      },
    },
  },
  defaultConfig: { expression: 'return { ...input }' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    {
      key: 'expression',
      label: 'Transform Expression',
      type: 'code',
      description: 'JavaScript function body. Use `input` to access upstream data and return a new object.',
      placeholder: 'return { ...input, newField: input.value * 2 }',
    },
    {
      key: 'outputSchema',
      label: 'Output Schema (JSON)',
      type: 'textarea',
      description: 'Optional JSON schema describing the output shape. Helps downstream nodes show autocomplete.',
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
  llmDescription: 'Expression is a JS function body (can use const/let, multi-line, etc.) that MUST return an object. The upstream data is available as "input". When downstream of an http-request node, the API response is at input.body (e.g. "const data = input.body; return { temp: data.current_condition[0].temp_C }"). Always check the actual structure of upstream output.',
  llmExamples: [{ expression: 'const data = input.body;\nreturn { value: data.results[0].value, timestamp: new Date().toISOString() }' }],
};
