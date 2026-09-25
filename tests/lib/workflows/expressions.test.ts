import { describe, it, expect } from 'vitest';
import {
  formatToday,
  resolveConfig,
  evaluateExpression,
  classifyTemplateToken,
  extractTemplateTokens,
  workflowUsesStateTemplates,
  nodeSlug,
  type ExprScope,
} from '$lib/workflows/expressions';
import { interpolateTemplate, interpolateTemplateStrict, markEngineResolved } from '$lib/workflows/nodes/template';
import { verifyWorkflow } from '$lib/workflows/orchestrator/verify';
import type { WorkflowNodeDef, NodeDefinition, JsonSchema } from '$lib/workflows/types';

const FIXED = new Date('2026-07-16T09:30:00.000Z'); // Thursday 16 July 2026

const outputs: Record<string, Record<string, unknown>> = {
  n_fetch: { items: [{ title: 'First' }, { title: 'Second' }], count: 2 },
  n_mail: { subject: 'Hi', tags: ['a', 'b'] },
};
const labels: Record<string, string> = { 'fetch-news': 'n_fetch', 'read-mail': 'n_mail' };

function scope(extra: Partial<ExprScope> = {}): ExprScope {
  return {
    input: { name: 'Ada', user: { email: 'a@b.com' }, items: ['x', 'y', 'z'], n: 5, nil: null, when: '2026-01-02T23:30:00Z' },
    nodes: (ref) => outputs[ref] ?? outputs[labels[ref]],
    trigger: { payload: { id: 7 }, text: 'hello' },
    state: new Map<string, unknown>([['cursor', 'C1'], ['a.b', 'literal-key'], ['a', { b: 'nested' }], ['profile', { name: 'Ada' }]]),
    now: FIXED,
    ...extra,
  };
}
const text = (s: string, sc = scope()) => resolveConfig({ v: s }, sc).config.v;
const typed = (s: string, sc = scope()) => resolveConfig({ v: s }, sc, { typedKeys: new Set(['v']) }).config.v;

describe('formatToday', () => {
  it('formats en-GB long with no comma (Europe/London)', () => {
    expect(formatToday(FIXED)).toBe('Thursday 16 July 2026');
  });
});

describe('resolveConfig — namespaces', () => {
  it('resolves {{today}} and {{now}}', () => {
    expect(text('On {{today}} at {{now}}')).toBe('On Thursday 16 July 2026 at 2026-07-16T09:30:00.000Z');
  });
  it('resolves input paths, dot and bracket indexing', () => {
    expect(text('{{input.name}} {{input.user.email}} {{input.items[1]}} {{input.items.2}}')).toBe('Ada a@b.com y z');
  });
  it('resolves nodes by id and by label slug, with or without output.', () => {
    expect(text('{{nodes.n_fetch.items[0].title}}|{{nodes.fetch-news.count}}|{{nodes.read-mail.output.subject}}')).toBe('First|2|Hi');
  });
  it('resolves trigger fields, with or without output.', () => {
    expect(text('{{trigger.text}} {{trigger.output.payload.id}}')).toBe('hello 7');
  });
  it('state: exact key wins over dot-path; dot-path into JSON; JSON for objects', () => {
    expect(text('{{state.cursor}} {{state.a.b}} {{state.profile.name}} {{state.profile}}')).toBe('C1 literal-key Ada {"name":"Ada"}');
  });
  it('null leaf is present-but-empty; objects embed as JSON', () => {
    expect(text('[{{input.nil}}] {{input.user}}')).toBe('[] {"email":"a@b.com"}');
  });
});

describe('resolveConfig — defaults, filters, typed values', () => {
  it('?? falls back on missing or null, to a literal or another reference', () => {
    expect(text("{{input.missing ?? 'friend'}} {{input.nil ?? input.name}} {{input.name ?? 'x'}}")).toBe('friend Ada Ada');
  });
  it('applies the safe filter set', () => {
    expect(text("{{input.name | upper}} {{input.name | lower}} {{input.items | length}} {{input.items | join(' / ')}} {{input.items | join}}")).toBe('ADA ada 3 x / y / z x, y, z');
    expect(text('{{input.items | first}}{{input.items | last}} {{input.user | json}} {{ input.name | trim }}')).toBe('xz {"email":"a@b.com"} Ada');
    expect(text("{{input.when | date('YYYY-MM-DD HH:mm')}} {{now | date}}")).toBe('2026-01-02 23:30 2026-07-16');
  });
  it('unknown filter warns and passes the value through', () => {
    const r = resolveConfig({ v: '{{input.name | shout}}' }, scope());
    expect(r.config.v).toBe('Ada');
    expect(r.warnings[0].reason).toContain('unknown filter');
  });
  it('a lone expression keeps its type only in a typed (non-string) field', () => {
    expect(typed('{{nodes.fetch-news.items}}')).toEqual([{ title: 'First' }, { title: 'Second' }]);
    expect(typed('{{input.n}}')).toBe(5);
    expect(text('{{input.n}}')).toBe('5');
    expect(text('{{input.items}}')).toBe('["x","y","z"]');
    expect(typed('n={{input.n}}')).toBe('n=5');
  });
  it('rawKeys are copied untouched; nested values are resolved', () => {
    const r = resolveConfig({ code: 'return "{{input.name}}"', deep: { list: ['{{input.name}}'] } }, scope(), { rawKeys: ['code'] });
    expect(r.config).toEqual({ code: 'return "{{input.name}}"', deep: { list: ['Ada'] } });
  });
  it('never mutates the config', () => {
    const cfg = { v: '{{input.name}}', nested: { a: ['{{now}}'] } };
    const copy = structuredClone(cfg);
    resolveConfig(cfg, scope());
    expect(cfg).toEqual(copy);
  });
});

describe('resolveConfig — unknowns never throw', () => {
  it('missing references in our namespaces become empty with a warning', () => {
    const r = resolveConfig({ v: 'a{{input.nope}}b{{nodes.ghost.x}}c{{state.missing}}d{{trigger.none}}' }, scope());
    expect(r.config.v).toBe('abcd');
    expect(r.warnings.map((w) => w.token).sort()).toEqual(['input.nope', 'nodes.ghost.x', 'state.missing', 'trigger.none']);
    expect(r.missingByText.get('abcd')).toEqual(['input.nope', 'nodes.ghost.x', 'state.missing', 'trigger.none']);
  });
  it('foreign tokens (Home Assistant Jinja, playbook slots) stay verbatim with a warning', () => {
    const r = resolveConfig({ v: "{{ states('sensor.x') }} {{keyword}} {{ s.attributes.lat | default('null') }}" }, scope());
    expect(r.config.v).toBe("{{ states('sensor.x') }} {{keyword}} {{ s.attributes.lat | default('null') }}");
    expect(r.warnings).toHaveLength(3);
  });
  it('|| is not supported: empty + a warning pointing at ??', () => {
    const r = resolveConfig({ v: "{{input.body || input.error || 'Unknown error'}}" }, scope());
    expect(r.config.v).toBe('');
    expect(r.warnings[0].reason).toContain('??');
  });
  it('block helpers are left for the verifier', () => {
    expect(text('{{#each items}}x{{/each}}')).toBe('{{#each items}}x{{/each}}');
  });
  it('evaluateExpression reports missing only when every alternative is missing', () => {
    expect(evaluateExpression("input.nope ?? 'x'", scope()).missing).toEqual([]);
    expect(evaluateExpression('input.nope ?? input.gone', scope()).missing).toEqual(['input.nope', 'input.gone']);
  });
});

describe('per-executor helpers', () => {
  it('resolve {{input.*}} outside the engine, with the new syntax', () => {
    expect(interpolateTemplate('Hi {{input.items[0]}}', { items: ['a'] })).toBe('Hi a');
    expect(interpolateTemplateStrict('{{input.a}} {{input.b}}', { a: 1 })).toEqual({ result: '1 ', missingPaths: ['input.b'] });
  });
  it('are a no-op once the engine resolved the config — upstream data is never re-resolved', () => {
    const input = { payload: 'user typed {{input.secret}}', secret: 'LEAK' };
    const r = resolveConfig({ v: 'got: {{input.payload}} {{input.nope}}' }, { input });
    markEngineResolved(input, r.missingByText);
    const resolved = r.config.v as string;
    expect(resolved).toBe('got: user typed {{input.secret}} ');
    expect(interpolateTemplateStrict(resolved, input)).toEqual({ result: resolved, missingPaths: ['input.nope'] });
    expect(interpolateTemplate(['a'], input)).toBe('["a"]');
  });
});

describe('classifyTemplateToken / extractTemplateTokens / nodeSlug', () => {
  it('classifies each namespace', () => {
    expect(classifyTemplateToken('input.x')).toBe('input');
    expect(classifyTemplateToken('nodes.a.b ?? 1')).toBe('nodes');
    expect(classifyTemplateToken('trigger.x | upper')).toBe('trigger');
    expect(classifyTemplateToken('state.k')).toBe('state');
    expect(classifyTemplateToken('today')).toBe('today');
    expect(classifyTemplateToken('now')).toBe('now');
    expect(classifyTemplateToken('#each x')).toBe('block');
    expect(classifyTemplateToken('env.X')).toBe('unknown');
  });
  it('extracts trimmed inner tokens', () => {
    expect(extractTemplateTokens('a {{ input.x }} b {{today}}')).toEqual(['input.x', 'today']);
  });
  it('slugs labels', () => {
    expect(nodeSlug('Fetch News!')).toBe('fetch-news');
  });
});

describe('workflowUsesStateTemplates', () => {
  const n = (config: Record<string, unknown>): WorkflowNodeDef => ({ id: 'n', type: 't', label: 'n', position: { x: 0, y: 0 }, config });
  it('detects {{state...}} anywhere in node configs', () => {
    expect(workflowUsesStateTemplates([n({ a: { b: ['{{ state.k }}'] } })])).toBe(true);
  });
  it('returns false when no state token is present', () => {
    expect(workflowUsesStateTemplates([n({ a: '{{input.x}}' })])).toBe(false);
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
    const issues = verifyWorkflow([nodeWith('from {{env.SECRET}}')], [], getDefinition, getOutputSchema);
    const warn = issues.find((i) => i.issue.includes('{{env.SECRET}}'));
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe('warning');
  });

  it('does NOT warn on {{state.*}}, {{today}}, {{now}}, {{trigger.*}} or {{input.*}}', () => {
    const issues = verifyWorkflow(
      [nodeWith('{{state.cursor}} {{today}} {{now}} {{input.foo}} {{trigger.output.x}}')],
      [],
      getDefinition,
      getOutputSchema,
    );
    expect(issues.filter((i) => i.issue.includes('Unknown template variable'))).toEqual([]);
  });
});

describe('verifyWorkflow — {{nodes.X}} references', () => {
  const def = (type: string): NodeDefinition => ({
    type, label: type, category: 'core', description: '',
    configSchema: { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' } } },
    defaultConfig: {}, inputs: [], outputs: [], rawConfigKeys: ['code'],
  });
  const schemas: Record<string, JsonSchema> = {
    fetch: { type: 'object', properties: { items: { type: 'array' }, count: { type: 'number' } } },
    sink: { type: 'object' },
  };
  const n = (id: string, type: string, label: string, config: Record<string, unknown> = {}): WorkflowNodeDef =>
    ({ id, type, label, position: { x: 0, y: 0 }, config });
  const nodes = (message: string, code = '') => [
    n('a', 'fetch', 'Fetch News'),
    n('side', 'fetch', 'Side Branch'),
    n('mid', 'sink', 'Middle'),
    n('z', 'sink', 'Send', { message, code }),
  ];
  const edges = [
    { id: 'e1', sourceNodeId: 'a', targetNodeId: 'mid' },
    { id: 'e2', sourceNodeId: 'mid', targetNodeId: 'z' },
  ];
  const lint = (message: string, code = '') =>
    verifyWorkflow(nodes(message, code), edges, def, (t) => schemas[t] ?? { type: 'object' })
      .filter((i) => i.nodeId === 'z');

  it('accepts an ancestor by id or label slug, with or without output.', () => {
    expect(lint('{{nodes.a.items}} {{nodes.fetch-news.output.count}} {{nodes.fetch-news.items[0] ?? "none"}}')).toEqual([]);
  });
  it('is an ERROR to read a node that is not upstream, or does not exist', () => {
    const issues = lint('{{nodes.side-branch.items}} {{nodes.ghost.x}}');
    expect(issues.map((i) => i.severity)).toEqual(['error', 'error']);
    expect(issues[0].issue).toContain('not upstream');
    expect(issues[1].issue).toContain('does not exist');
  });
  it('warns on a field the upstream does not declare', () => {
    const [issue] = lint('{{nodes.fetch-news.headlines}}');
    expect(issue.severity).toBe('warning');
    expect(issue.issue).toContain('items, count');
  });
  it('warns on || and skips raw code fields', () => {
    const issues = lint("{{input.a || 'x'}}", 'return "{{nodes.ghost.x}}"');
    expect(issues).toHaveLength(1);
    expect(issues[0].issue).toContain('??');
  });
});
