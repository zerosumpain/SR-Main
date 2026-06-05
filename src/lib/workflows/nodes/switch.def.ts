import type { NodeDefinition } from '../types';

/**
 * Shape of a single switch case as stored in config. `match` is compared
 * against the evaluated input expression (string-coerced equality, see
 * switch.ts); `handle` is the output handle name execution fans into when the
 * case matches.
 */
export interface SwitchCase {
  match: string;
  handle: string;
}

/**
 * Derive the ordered list of output handles for a configured switch node:
 * one per case (in order) plus the trailing default handle. Used both by the
 * executor (to validate) and to generalise conditional.def's static
 * true/false handle declaration to N config-driven handles.
 */
export function switchHandles(config: Record<string, unknown>): string[] {
  const cases = Array.isArray(config?.cases) ? (config.cases as SwitchCase[]) : [];
  const defaultHandle = (config?.defaultHandle as string) || 'default';
  const handles: string[] = [];
  for (const c of cases) {
    if (c && typeof c.handle === 'string' && c.handle && !handles.includes(c.handle)) {
      handles.push(c.handle);
    }
  }
  if (!handles.includes(defaultHandle)) handles.push(defaultHandle);
  return handles;
}

export const switchDef: NodeDefinition = {
  type: 'switch',
  label: 'Switch',
  category: 'control',
  description:
    'Evaluates a JS expression and routes execution to the first matching case\'s output handle, or the default handle if nothing matches. Deterministic n-way branch.',
  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description:
          'JS expression producing the value to match against each case. `input` is the input object. e.g. input.status',
      },
      cases: {
        type: 'array',
        description: 'Ordered list of cases. The first whose `match` equals the evaluated value wins.',
        items: {
          type: 'object',
          properties: {
            match: { type: 'string', description: 'Value to compare against (string-coerced equality).' },
            handle: { type: 'string', description: 'Output handle to route to when this case matches.' },
          },
          required: ['match', 'handle'],
        },
      },
      defaultHandle: {
        type: 'string',
        description: 'Handle used when no case matches. Defaults to "default".',
      },
    },
    required: ['expression', 'cases'],
  },
  defaultConfig: {
    expression: 'input.value',
    cases: [
      { match: 'a', handle: 'a' },
      { match: 'b', handle: 'b' },
    ],
    defaultHandle: 'default',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  summarize: (config) => {
    const expr = String(config.expression ?? '').trim();
    const cases = Array.isArray(config.cases) ? config.cases : [];
    const fallback = String(config.defaultHandle ?? 'default');
    return {
      line: `Route on ${expr || 'a value'} into ${cases.length} case${cases.length === 1 ? '' : 's'} (+ ${fallback})`,
      preview: { kind: 'control', details: { 'Switch on': expr || '—', Cases: String(cases.length), Default: fallback } },
    };
  },
  // Output handles are config-driven. The canvas reads `outputs` for the
  // static fallback; switchHandles(config) is the authoritative per-instance
  // set (generalises conditional.def's fixed true/false to N handles).
  outputs: [
    { name: 'a', type: 'any', label: 'a' },
    { name: 'b', type: 'any', label: 'b' },
    { name: 'default', type: 'any', label: 'Default' },
  ],
  basicConfig: [
    {
      key: 'expression',
      label: 'Match Expression',
      type: 'template-textarea',
      description: 'Produces the value to switch on. Access upstream data with input.field. e.g. input.status',
      placeholder: 'input.status',
    },
    {
      key: 'cases',
      label: 'Cases',
      type: 'code',
      language: 'json',
      description: 'Ordered [{ match, handle }]. First case whose match equals the evaluated value wins.',
      placeholder: '[{ "match": "ok", "handle": "ok" }, { "match": "error", "handle": "error" }]',
    },
    {
      key: 'defaultHandle',
      label: 'Default Handle',
      type: 'text',
      description: 'Handle used when no case matches.',
      placeholder: 'default',
    },
  ],
  llmDescription:
    'Deterministic n-way branch. `expression` is a SINGLE JS expression (not multi-line code, no const/let/var, no if/else) evaluated as new Function("input", "return (" + expression + ")"). Its result is string-coerced and compared for equality against each case\'s `match` (also string-coerced) in order; the FIRST match wins and execution routes to that case\'s `handle`. If nothing matches, routing goes to `defaultHandle`. Connect each output handle to its branch using sourceHandle in connect_nodes. Use this instead of chaining multiple conditional nodes when routing on a discrete value (status code, category, type). Examples: expression "input.status" with cases [{match:"200",handle:"ok"},{match:"404",handle:"missing"}].',
  llmExamples: [
    {
      expression: 'input.status',
      cases: [
        { match: '200', handle: 'ok' },
        { match: '404', handle: 'missing' },
      ],
      defaultHandle: 'error',
    },
  ],
};
