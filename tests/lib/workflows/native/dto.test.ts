import { describe, it, expect } from 'vitest';
import {
  attentionFor,
  deriveFormFields,
  describeCron,
  fieldFromBasic,
  graphVersion,
  isStepNode,
  nextRuns,
  orderSteps,
  outputPreview,
  outputRows,
  runSummary,
  sortWorkflowCards,
  triggerDTO,
  WHOLE_CONFIG_KEY,
  OUTPUT_PREVIEW_LIMIT,
  type GraphEdge,
  type GraphNode,
  type TriggerInput,
} from '$lib/workflows/native/dto';
import { buildStateFrom, BUILD_STALE_MS, STALE_BUILD_ERROR } from '$lib/workflows/build-state.server';
import { cronTimezone } from '$lib/workflows/cron-timezone';

const node = (id: string, type: string, x = 0, y = 0): GraphNode => ({
  id,
  type,
  label: id,
  config: {},
  position: { x, y },
  version: 0,
});
const edge = (id: string, s: string, t: string, h: string | null = null): GraphEdge => ({
  id,
  sourceNodeId: s,
  targetNodeId: t,
  sourceHandle: h,
});

describe('FieldDTO derivation', () => {
  it('maps every BasicConfigField widget to a phone control', () => {
    const kinds = (
      [
        ['dropdown', 'dropdown'],
        ['toggle', 'toggle'],
        ['slider', 'number'],
        ['text', 'text'],
        ['textarea', 'textarea'],
        ['template-textarea', 'template'],
        ['number', 'number'],
        ['code', 'code'],
        ['schema-builder', 'json'],
        ['key-value-table', 'json'],
        ['chip-input', 'chips'],
        ['phone', 'phone'],
      ] as const
    ).map(([type, kind]) => {
      const f = fieldFromBasic({
        key: 'k',
        label: 'K',
        type,
        options: [{ value: 'a', label: 'A' }],
      });
      return [type, f.kind, kind] as const;
    });
    for (const [type, got, want] of kinds) expect(got, type).toBe(want);
  });

  it('carries bounds, help, section and the advanced flag', () => {
    const f = fieldFromBasic({
      key: 'temperature',
      label: 'Temperature',
      type: 'slider',
      min: 0,
      max: 2,
      step: 0.1,
      description: 'How adventurous',
      advancedOnly: true,
      section: 'Model',
      placeholder: '0.7',
    });
    expect(f).toEqual({
      key: 'temperature',
      label: 'Temperature',
      kind: 'number',
      min: 0,
      max: 2,
      step: 0.1,
      help: 'How adventurous',
      advanced: true,
      section: 'Model',
      placeholder: '0.7',
    });
  });

  it('sends a dropdown whose options resolve on the web as text, not an empty picker', () => {
    const f = fieldFromBasic({ key: 'model', label: 'Model', type: 'dropdown', dynamicOptionsKey: 'openrouter-models' });
    expect(f.kind).toBe('text');
    expect(f.options).toBeUndefined();
  });

  it('prefers basicConfig, then configSchema, then one JSON field', () => {
    expect(
      deriveFormFields({
        basicConfig: [{ key: 'a', label: 'A', type: 'text' }],
        configSchema: { type: 'object', properties: { b: { type: 'string' } } },
      }).map((f) => f.key),
    ).toEqual(['a']);

    const fromSchema = deriveFormFields({
      configSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fast', 'slow'] },
          count: { type: 'integer', minimum: 1, maximum: 10 },
          on: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
          url: { type: 'string' },
          headers: { type: 'object' },
          _onError: { type: 'object' },
        },
      },
    });
    expect(fromSchema.map((f) => [f.key, f.kind])).toEqual([
      ['mode', 'dropdown'],
      ['count', 'number'],
      ['on', 'toggle'],
      ['tags', 'chips'],
      ['prompt', 'textarea'],
      ['url', 'text'],
      ['headers', 'json'],
    ]);
    expect(fromSchema[1]).toMatchObject({ min: 1, max: 10, step: 1 });

    expect(deriveFormFields({ configSchema: { type: 'object' } })).toEqual([
      { key: WHOLE_CONFIG_KEY, label: 'Configuration', kind: 'json', advanced: false },
    ]);
    expect(deriveFormFields(undefined)[0].kind).toBe('json');
  });
});

describe('step order', () => {
  it('puts the trigger first and walks the graph topologically', () => {
    // Deliberately stored out of order, with the trigger placed LOW on the canvas.
    const nodes = [node('send', 'whatsapp', 0, 300), node('llm', 'llm-call', 0, 200), node('t', 'trigger', 0, 900), node('fetch', 'http-request', 0, 100)];
    const edges = [edge('e1', 't', 'fetch'), edge('e2', 'fetch', 'llm'), edge('e3', 'llm', 'send')];
    expect(orderSteps(nodes, edges).map((n) => n.id)).toEqual(['t', 'fetch', 'llm', 'send']);
  });

  it('orders sibling branches top-to-bottom then left-to-right, and never drops a node in a cycle', () => {
    const nodes = [
      node('t', 'trigger'),
      node('router', 'llm-router', 0, 100),
      node('b', 'whatsapp', 400, 200),
      node('a', 'gmail-send', 0, 200),
      node('loopA', 'code-execute', 0, 500),
      node('loopB', 'code-execute', 0, 600),
    ];
    const edges = [
      edge('e1', 't', 'router'),
      edge('e2', 'router', 'b', 'yes'),
      edge('e3', 'router', 'a', 'no'),
      edge('e4', 'loopA', 'loopB'),
      edge('e5', 'loopB', 'loopA'),
    ];
    expect(orderSteps(nodes, edges).map((n) => n.id)).toEqual(['t', 'router', 'a', 'b', 'loopA', 'loopB']);
  });

  it('leaves display-only nodes and the unwired chat panel out of the steps', () => {
    const edges = [edge('e1', 't', 'x')];
    expect(isStepNode(node('p', 'postit'), edges)).toBe(false);
    expect(isStepNode(node('s', 'stats-summary'), edges)).toBe(false);
    expect(isStepNode(node('c', 'chat'), edges)).toBe(false);
    expect(isStepNode(node('c', 'chat'), [edge('e2', 'c', 'x')])).toBe(true);
    expect(isStepNode(node('x', 'llm-call'), edges)).toBe(true);
  });
});

describe('graph version', () => {
  const nodes = [node('a', 'trigger'), node('b', 'llm-call')];
  const edges = [edge('e1', 'a', 'b')];
  const base = graphVersion(nodes, edges);

  it('is stable under row order and a positive 31-bit integer', () => {
    expect(graphVersion([...nodes].reverse(), edges)).toBe(base);
    expect(Number.isInteger(base) && base >= 0 && base <= 0x7fffffff).toBe(true);
  });

  it('moves on an edit, an added node and a rewire', () => {
    expect(graphVersion([nodes[0], { ...nodes[1], version: 1 }], edges)).not.toBe(base);
    expect(graphVersion([...nodes, node('c', 'delay')], edges)).not.toBe(base);
    expect(graphVersion(nodes, [])).not.toBe(base);
  });
});

describe('attention', () => {
  it('names the problem the owner can act on, and nothing else', () => {
    expect(attentionFor({ lastRun: null, buildError: null })).toEqual({ needsAttention: false, attentionReason: null });
    expect(attentionFor({ lastRun: { status: 'running', error: null }, buildError: null }).needsAttention).toBe(false);
    expect(attentionFor({ lastRun: { status: 'failed', error: 'HTTP 500\nstack…' }, buildError: null })).toEqual({
      needsAttention: true,
      attentionReason: 'Last run failed: HTTP 500',
    });
    expect(attentionFor({ lastRun: { status: 'awaiting_human', error: null }, buildError: null }).attentionReason).toBe(
      'Waiting for your approval',
    );
    expect(attentionFor({ lastRun: { status: 'completed_with_errors', error: null }, buildError: null }).needsAttention).toBe(true);
    // A failed build outranks the run it never had.
    expect(attentionFor({ lastRun: { status: 'failed', error: 'x' }, buildError: 'no workflow came out' }).attentionReason).toBe(
      'no workflow came out',
    );
    expect(attentionFor({ lastRun: null, buildError: null, pendingFixes: 1 }).needsAttention).toBe(true);
  });

  it('sorts needs-attention first, then most recently updated', () => {
    const cards = [
      { slug: 'old-ok', needsAttention: false, updatedAt: '2026-09-01T00:00:00Z' },
      { slug: 'new-ok', needsAttention: false, updatedAt: '2026-09-20T00:00:00Z' },
      { slug: 'old-bad', needsAttention: true, updatedAt: '2026-08-01T00:00:00Z' },
      { slug: 'new-bad', needsAttention: true, updatedAt: '2026-09-10T00:00:00Z' },
    ];
    expect(sortWorkflowCards(cards).map((c) => c.slug)).toEqual(['new-bad', 'old-bad', 'new-ok', 'old-ok']);
  });
});

describe('runs', () => {
  it('summarises a run with ISO dates and a duration only when it finished', () => {
    const startedAt = new Date('2026-09-25T07:00:00Z');
    expect(
      runSummary({ id: 'r', status: 'completed', trigger: 'cron', startedAt, completedAt: new Date('2026-09-25T07:00:02.500Z'), error: null }),
    ).toEqual({
      id: 'r',
      status: 'completed',
      trigger: 'cron',
      startedAt: '2026-09-25T07:00:00.000Z',
      completedAt: '2026-09-25T07:00:02.500Z',
      durationMs: 2500,
      error: null,
    });
    expect(runSummary({ id: 'r', status: 'running', trigger: 'manual', startedAt, completedAt: null, error: null }).durationMs).toBeNull();
  });

  it('pretty-prints output and clips it at 4 KB', () => {
    expect(outputPreview({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(outputPreview(null)).toBeNull();
    const big = outputPreview({ text: 'x'.repeat(10_000) })!;
    expect(big.length).toBeLessThan(OUTPUT_PREVIEW_LIMIT + 50);
    expect(big.endsWith('(truncated)')).toBe(true);
    expect(outputRows([1, 2, 3])).toBe(3);
    expect(outputRows({ _rowCount: 7 })).toBe(7);
    expect(outputRows({ a: 1 })).toBeNull();
  });
});

describe('trigger', () => {
  const base: TriggerInput = {
    row: { type: 'manual' },
    triggerNodeConfig: { kind: 'manual' },
    schedules: [],
    nodeTypes: ['trigger', 'llm-call'],
    chatWired: false,
    resolveZone: cronTimezone,
    now: new Date('2026-09-25T06:00:00Z'),
  };

  it('reads a scheduled cron from its schedule row, with three next runs in its zone', () => {
    const t = triggerDTO({
      ...base,
      row: { type: 'cron', cron: '0 9 * * *' },
      schedules: [{ type: 'cron', config: { expression: '0 7 * * *' }, enabled: true }],
    });
    expect(t).toMatchObject({ kind: 'cron', cron: '0 7 * * *', timezone: 'Europe/London', enabled: true, description: 'Every day at 07:00' });
    // 07:00 London in BST is 06:00Z — already past on the 25th at 06:00Z exactly.
    expect(t.nextRuns).toEqual(['2026-09-26T06:00:00.000Z', '2026-09-27T06:00:00.000Z', '2026-09-28T06:00:00.000Z']);
  });

  it('calls a cron with no schedule row paused, and names a non-default zone', () => {
    const t = triggerDTO({ ...base, row: { type: 'cron', config: { expression: '30 8 * * 1-5' }, timezone: 'America/New_York' } });
    expect(t.enabled).toBe(false);
    expect(t.nextRuns).toEqual([]);
    expect(t.description).toBe('Paused — every weekday at 08:30 (America/New_York)');
  });

  it('knows the inbox triggers and a wired chat by their nodes', () => {
    expect(triggerDTO({ ...base, nodeTypes: ['whatsapp-trigger'] }).kind).toBe('whatsapp');
    expect(triggerDTO({ ...base, nodeTypes: ['gmail-trigger'] }).kind).toBe('gmail');
    expect(triggerDTO({ ...base, chatWired: true }).kind).toBe('chat');
    expect(triggerDTO(base)).toMatchObject({ kind: 'manual', enabled: true, cron: null, nextRuns: [] });
    expect(triggerDTO({ ...base, triggerNodeConfig: { kind: 'manual', enabled: false } }).enabled).toBe(false);
  });

  it('describes cron in plain English and quotes what it cannot read', () => {
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 * * * *')).toBe('Every hour, on the hour');
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hours');
    expect(describeCron('0 7,19 * * *')).toBe('Every day at 07:00 and 19:00');
    expect(describeCron('0 9 * * 1,3')).toBe('Every Monday, Wednesday at 09:00');
    expect(describeCron('0 9 1 * *')).toBe('On day 1 of every month at 09:00');
    expect(describeCron('0 9 1 1 *')).toBe('On the schedule "0 9 1 1 *"');
  });

  it('returns no next runs for an expression croner rejects', () => {
    expect(nextRuns('not a cron', 'Europe/London')).toEqual([]);
  });
});

describe('build state', () => {
  const at = new Date('2026-09-25T06:00:00Z');
  it('reads building, done and failed markers, and turns a stale build into a failure', () => {
    expect(buildStateFrom(null, at)).toEqual({ building: false, buildError: null });
    expect(buildStateFrom({ status: 'building' }, at, at.getTime() + 1000)).toEqual({ building: true, buildError: null });
    expect(buildStateFrom({ status: 'building' }, at, at.getTime() + BUILD_STALE_MS + 1)).toEqual({
      building: false,
      buildError: STALE_BUILD_ERROR,
    });
    expect(buildStateFrom({ status: 'failed', error: 'nope' }, at)).toEqual({ building: false, buildError: 'nope' });
    expect(buildStateFrom({ status: 'done' }, at)).toEqual({ building: false, buildError: null });
  });
});
