import { describe, it, expect } from 'vitest';
import {
  formatToday,
  resolveStateTemplatesString,
  resolveStateTemplatesDeep,
  scanUnknownTemplateVars,
  classifyTemplateToken,
  extractTemplateTokens,
  workflowUsesStateTemplates,
} from '$lib/workflows/state-templates';
import { verifyWorkflow } from '$lib/workflows/orchestrator/verify';
import type { WorkflowNodeDef, NodeDefinition, JsonSchema } from '$lib/workflows/types';

const FIXED = new Date('2026-07-16T09:30:00.000Z'); // Thursday 16 July 2026

function ctx(entries: Record<string, unknown> = {}) {
  return { store: new Map<string, unknown>(Object.entries(entries)), now: FIXED };
}

describe('formatToday', () => {
  it('formats en-GB long with no comma (Europe/London)', () => {
    expect(formatToday(FIXED)).toBe('Thursday 16 July 2026');
  });
});

describe('resolveStateTemplatesString — builtins', () => {
  it('resolves {{today}} and {{now}}', () => {
    const { result } = resolveStateTemplatesString('On {{today}} at {{now}}', ctx());
    expect(result).toBe('On Thursday 16 July 2026 at 2026-07-16T09:30:00.000Z');
  });

  it('leaves {{input.*}} untouched (executor resolves those)', () => {
    const { result } = resolveStateTemplatesString('Hi {{input.name}}', ctx());
    expect(result).toBe('Hi {{input.name}}');
  });
});

describe('resolveStateTemplatesString — state', () => {
  it('resolves an exact-key match', () => {
    const { result, unresolved } = resolveStateTemplatesString(
      'cursor={{state.last_id}}',
      ctx({ last_id: 'abc123' }),
    );
    expect(result).toBe('cursor=abc123');
    expect(unresolved).toEqual([]);
  });

  it('prefers an exact key containing dots over a dot-path', () => {
    const { result } = resolveStateTemplatesString(
      '{{state.a.b}}',
      ctx({ 'a.b': 'literal-key', a: { b: 'nested' } }),
    );
    expect(result).toBe('literal-key');
  });

  it('resolves a dot-path into stored JSON', () => {
    const { result } = resolveStateTemplatesString(
      '{{state.profile.name}}',
      ctx({ profile: { name: 'Ada', age: 40 } }),
    );
    expect(result).toBe('Ada');
  });

  it('JSON-stringifies a non-string stored value', () => {
    const { result } = resolveStateTemplatesString(
      '{{state.ids}}',
      ctx({ ids: [1, 2, 3] }),
    );
    expect(result).toBe('[1,2,3]');
  });

  it('renders a null leaf as empty string (present-but-empty)', () => {
    const { result, unresolved } = resolveStateTemplatesString('[{{state.x}}]', ctx({ x: null }));
    expect(result).toBe('[]');
    expect(unresolved).toEqual([]);
  });

  it('leaves an unresolved state token verbatim and records it', () => {
    const { result, unresolved } = resolveStateTemplatesString(
      'v={{state.missing}} p={{state.profile.nope}}',
      ctx({ profile: { name: 'Ada' } }),
    );
    expect(result).toBe('v={{state.missing}} p={{state.profile.nope}}');
    expect(unresolved).toEqual(['state.missing', 'state.profile.nope']);
  });
});

describe('resolveStateTemplatesDeep — non-mutation + nesting', () => {
  it('resolves nested objects/arrays into a NEW structure without mutating the input', () => {
    const original = {
      message: 'Today is {{today}}, cursor {{state.cursor}}',
      nested: { items: ['{{state.first}}', 'static', '{{input.keep}}'] },
      count: 3,
    };
    const snapshot = ctx({ cursor: 'C1', first: 'F1' });
    const { config, unresolved } = resolveStateTemplatesDeep(original, snapshot);

    expect(config.message).toBe('Today is Thursday 16 July 2026, cursor C1');
    expect((config.nested as { items: string[] }).items).toEqual(['F1', 'static', '{{input.keep}}']);
    expect(config.count).toBe(3);
    expect(unresolved).toEqual([]);

    // Original is untouched.
    expect(original.message).toBe('Today is {{today}}, cursor {{state.cursor}}');
    expect(original.nested.items[0]).toBe('{{state.first}}');
    expect(config).not.toBe(original);
    expect(config.nested).not.toBe(original.nested);
  });

  it('collects unresolved tokens from nested strings', () => {
    const { unresolved } = resolveStateTemplatesDeep(
      { a: '{{state.x}}', b: { c: '{{state.y}}' } },
      ctx({}),
    );
    expect(unresolved).toEqual(['state.x', 'state.y']);
  });
});

describe('classifyTemplateToken / extractTemplateTokens', () => {
  it('classifies each namespace', () => {
    expect(classifyTemplateToken('input.foo')).toBe('input');
    expect(classifyTemplateToken('state.bar')).toBe('state');
    expect(classifyTemplateToken('today')).toBe('today');
    expect(classifyTemplateToken('now')).toBe('now');
    expect(classifyTemplateToken('#each x')).toBe('block');
    expect(classifyTemplateToken('trigger.output.x')).toBe('unknown');
  });

  it('extracts trimmed inner tokens', () => {
    expect(extractTemplateTokens('a {{ input.x }} b {{state.y}}')).toEqual(['input.x', 'state.y']);
  });
});

describe('scanUnknownTemplateVars', () => {
  it('warns on unknown namespace and unresolved state, but not builtins/present input', () => {
    const config = {
      msg: 'Hi {{input.name}} on {{today}}, seen {{state.gone}}, from {{trigger.output.x}}',
    };
    const warnings = scanUnknownTemplateVars(config, { name: 'Ada' });
    const tokens = warnings.map((w) => w.token).sort();
    expect(tokens).toEqual(['state.gone', 'trigger.output.x']);
  });

  it('warns on a missing input path', () => {
    const warnings = scanUnknownTemplateVars({ a: '{{input.missing}}' }, { present: 1 });
    expect(warnings.map((w) => w.token)).toEqual(['input.missing']);
  });

  it('does not warn when input path is present (incl. dot-path)', () => {
    const warnings = scanUnknownTemplateVars(
      { a: '{{input.body.data}}' },
      { body: { data: 'x' } },
    );
    expect(warnings).toEqual([]);
  });

  it('deduplicates repeated tokens and walks nested config', () => {
    const warnings = scanUnknownTemplateVars(
      { a: '{{env.X}} {{env.X}}', b: { c: ['{{env.X}}'] } },
      {},
    );
    expect(warnings.map((w) => w.token)).toEqual(['env.X']);
  });
});

describe('workflowUsesStateTemplates', () => {
  it('detects {{state...}} anywhere in node configs', () => {
    const nodes = [
      { config: { a: 'no tokens' } },
      { config: { nested: { b: 'hi {{state.cursor}}' } } },
    ] as unknown as WorkflowNodeDef[];
    expect(workflowUsesStateTemplates(nodes)).toBe(true);
  });

  it('returns false when no state token is present', () => {
    const nodes = [
      { config: { a: '{{input.x}} {{today}}' } },
    ] as unknown as WorkflowNodeDef[];
    expect(workflowUsesStateTemplates(nodes)).toBe(false);
  });
});

describe('verifyWorkflow — unknown template variable warnings (A4)', () => {
  const def: NodeDefinition = {
    type: 'test-node',
    label: 'Test',
    category: 'core',
    description: '',
    configSchema: { type: 'object', properties: { message: { type: 'string' } } },
    defaultConfig: {},
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [{ name: 'output', type: 'any' }],
  };
  const getDefinition = (type: string) => (type === 'test-node' ? def : undefined);
  const getOutputSchema = (): JsonSchema => ({ type: 'object' }); // no props → skip input-ref check

  function nodeWith(message: string): WorkflowNodeDef {
    return { id: 'n1', type: 'test-node', position: { x: 0, y: 0 }, config: { message }, label: 'Test' };
  }

  it('warns on an unknown template variable', () => {
    const issues = verifyWorkflow([nodeWith('from {{trigger.output.x}}')], [], getDefinition, getOutputSchema);
    const warn = issues.find((i) => i.issue.includes('{{trigger.output.x}}'));
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe('warning');
  });

  it('does NOT warn on {{state.*}}, {{today}}, {{now}} or {{input.*}}', () => {
    const issues = verifyWorkflow(
      [nodeWith('{{state.cursor}} {{today}} {{now}} {{input.foo}}')],
      [],
      getDefinition,
      getOutputSchema,
    );
    expect(issues.filter((i) => i.issue.includes('Unknown template variable'))).toEqual([]);
  });
});
