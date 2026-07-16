import { describe, it, expect } from 'vitest';
import {
  scoreGraph,
  aggregate,
  formatReport,
  hasScheduleTrigger,
  runVerify,
  pathExists,
  memoryLiesBetween,
  checkIdempotency,
  applyIdempotency,
  type EvalGraph,
  type ExpectationSpec,
  type CaseResult,
} from '$lib/workflows/eval/assertions';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';

/** Build a minimal valid node. */
function node(
  id: string,
  type: string,
  config: Record<string, unknown> = {},
): WorkflowNodeDef {
  return { id, type, config, label: `${type} (${id})`, position: { x: 0, y: 0 } };
}

function edge(id: string, source: string, target: string): WorkflowEdgeDef {
  return { id, sourceNodeId: source, targetNodeId: target };
}

/**
 * A clean, valid graph: manual-trigger → transform → email.
 * Email carries to/subject/body so the per-operation semantic gate passes.
 * transform.expression is a `code` field (not a template) so no template/ref
 * checks fire.
 */
function cleanGraph(): EvalGraph {
  return {
    name: 'clean',
    nodes: [
      node('n1', 'manual-trigger'),
      node('n2', 'transform', { expression: 'return { ...input }' }),
      node('n3', 'email', { to: 'john@example.com', subject: 'Hi', body: 'Body' }),
    ],
    edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
  };
}

const cleanSpec: ExpectationSpec = {
  nodeTypes: ['manual-trigger', 'transform', 'email'],
  edges: [
    { from: 'manual-trigger', to: 'transform' },
    { from: 'transform', to: 'email' },
  ],
};

describe('hasScheduleTrigger', () => {
  it('detects cron trigger by type', () => {
    expect(hasScheduleTrigger({ type: 'cron' }, [])).toBe(true);
  });
  it('detects schedule via trigger.config', () => {
    expect(hasScheduleTrigger({ type: 'manual', config: { cron: '0 9 * * *' } }, [])).toBe(true);
  });
  it('detects a trigger node configured as cron', () => {
    expect(
      hasScheduleTrigger(undefined, [node('t', 'trigger', { type: 'cron', cron: '* * * * *' })]),
    ).toBe(true);
  });
  it('returns false for a manual trigger', () => {
    expect(hasScheduleTrigger({ type: 'manual' }, [])).toBe(false);
  });
  it('returns false when no trigger at all', () => {
    expect(hasScheduleTrigger(undefined, [node('n', 'transform')])).toBe(false);
  });
});

describe('runVerify (orchestrator gate, no network)', () => {
  it('returns zero issues for a clean graph', () => {
    const issues = runVerify(cleanGraph());
    expect(issues).toHaveLength(0);
  });
  it('flags an email with no recipient as an error', () => {
    const g = cleanGraph();
    (g.nodes[2].config as Record<string, unknown>).to = '';
    const issues = runVerify(g);
    expect(issues.some((i) => i.severity === 'error' && i.field === 'to')).toBe(true);
  });
});

describe('scoreGraph — passing graph', () => {
  it('passes a clean, fully-wired graph', () => {
    const r = scoreGraph(cleanGraph(), cleanSpec);
    expect(r.passed).toBe(true);
    expect(r.failures).toHaveLength(0);
  });
});

describe('scoreGraph — failing graphs', () => {
  it('fails when a required node type is missing', () => {
    const g = cleanGraph();
    g.nodes = g.nodes.filter((n) => n.type !== 'email');
    g.edges = g.edges.filter((e) => e.targetNodeId !== 'n3');
    const r = scoreGraph(g, cleanSpec);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'missing-node-type')).toBe(true);
  });

  it('fails when an expected edge is missing', () => {
    const g = cleanGraph();
    g.edges = g.edges.filter((e) => e.id !== 'e2'); // drop transform→email
    const r = scoreGraph(g, cleanSpec);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'missing-edge')).toBe(true);
  });

  it('fails when a schedule is expected but absent', () => {
    const r = scoreGraph(cleanGraph(), { ...cleanSpec, hasSchedule: true });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'missing-schedule')).toBe(true);
  });

  it('passes when a schedule is expected and present', () => {
    const g = cleanGraph();
    g.trigger = { type: 'cron', config: { cron: '0 9 * * *' } };
    const r = scoreGraph(g, { ...cleanSpec, hasSchedule: true });
    expect(r.passed).toBe(true);
  });

  it('fails on a verifyWorkflow error (email missing recipient)', () => {
    const g = cleanGraph();
    (g.nodes[2].config as Record<string, unknown>).to = '';
    const r = scoreGraph(g, cleanSpec);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'verify-error')).toBe(true);
  });

  it('fails on an unknown config key (verify gate)', () => {
    const g = cleanGraph();
    (g.nodes[1].config as Record<string, unknown>).bogusKey = 'x';
    const r = scoreGraph(g, cleanSpec);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'verify-error')).toBe(true);
  });

  it('does NOT fail on verify errors when requireVerifyClean is false', () => {
    const g = cleanGraph();
    (g.nodes[2].config as Record<string, unknown>).to = '';
    const r = scoreGraph(g, { ...cleanSpec, requireVerifyClean: false });
    // verify error present but not counted as a failure
    expect(r.failures.some((f) => f.kind === 'verify-error')).toBe(false);
    expect(r.passed).toBe(true);
  });

  it('fails when self-heal is forbidden but occurred', () => {
    const g = cleanGraph();
    g.selfHealed = true;
    const r = scoreGraph(g, { ...cleanSpec, forbidSelfHeal: true });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'self-heal')).toBe(true);
  });

  it('warns (but passes) when self-heal occurred and is allowed', () => {
    const g = cleanGraph();
    g.selfHealed = true;
    const r = scoreGraph(g, cleanSpec);
    expect(r.passed).toBe(true);
    expect(r.warnings.some((w) => w.includes('self-heal'))).toBe(true);
  });
});

describe('aggregate + formatReport', () => {
  it('computes pass-rate across mixed cases', () => {
    const pass = { name: 'ok', result: scoreGraph(cleanGraph(), cleanSpec) };
    const failGraph = cleanGraph();
    failGraph.nodes = failGraph.nodes.filter((n) => n.type !== 'email');
    const fail = { name: 'broken', result: scoreGraph(failGraph, cleanSpec) };

    const report = aggregate([pass, fail]);
    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.passRate).toBe(0.5);
  });

  it('reports 0 pass-rate for an empty list without dividing by zero', () => {
    const report = aggregate([]);
    expect(report.passRate).toBe(0);
    expect(report.total).toBe(0);
  });

  it('renders a human-readable report containing PASS and FAIL marks', () => {
    const pass = { name: 'ok', result: scoreGraph(cleanGraph(), cleanSpec) };
    const failGraph = cleanGraph();
    failGraph.nodes = failGraph.nodes.filter((n) => n.type !== 'email');
    const fail = { name: 'broken', result: scoreGraph(failGraph, cleanSpec) };
    const text = formatReport(aggregate([pass, fail]));
    expect(text).toContain('[PASS] ok');
    expect(text).toContain('[FAIL] broken');
    expect(text).toContain('Pass rate: 1/2');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// B6: path-aware assertions (memory-on-path) + two-run idempotency.
// ──────────────────────────────────────────────────────────────────────────

/**
 * A recurring news-digest graph: tavily-search → dedupe → llm-call → whatsapp.
 * Schedule lives on graph.trigger (so verify's node-based recurring detection
 * stays off and this graph verifies clean — the dedupe presence is asserted
 * structurally, not via the verify dedup rule). `withDedupe:false` drops the
 * memory node; `memoryType` swaps dedupe → data-store.
 */
function digestGraph(opts: {
  withMemory?: boolean;
  memoryType?: 'dedupe' | 'data-store';
  dedupeConfig?: Record<string, unknown>;
  to?: 'whatsapp' | 'email';
} = {}): EvalGraph {
  const withMemory = opts.withMemory !== false;
  const memoryType = opts.memoryType ?? 'dedupe';
  const send = opts.to ?? 'whatsapp';
  const nodes: WorkflowNodeDef[] = [
    node('src', 'tavily-search', { query: 'uk civil service digital' }),
  ];
  const edges: WorkflowEdgeDef[] = [];
  let upstream = 'src';
  if (withMemory) {
    const memCfg =
      memoryType === 'dedupe'
        ? opts.dedupeConfig ?? { itemsPath: 'results', idPath: 'url', storeKey: 'seen_urls' }
        : { operation: 'add_to_set', key: 'seen_urls', valuePath: 'results' };
    nodes.push(node('mem', memoryType, memCfg));
    edges.push(edge('e_src_mem', 'src', 'mem'));
    upstream = 'mem';
  }
  nodes.push(node('llm', 'llm-call', { userPrompt: 'Summarise {{input.items}}' }));
  edges.push(edge('e_up_llm', upstream, 'llm'));
  const sendCfg =
    send === 'whatsapp'
      ? { message: 'Briefing: {{input.summary}}' }
      : { to: 'john@example.com', subject: 'Briefing', body: '{{input.summary}}' };
  nodes.push(node('send', send, sendCfg));
  edges.push(edge('e_llm_send', 'llm', 'send'));
  return {
    name: 'digest',
    nodes,
    edges,
    trigger: { type: 'cron', config: { cron: '0 7 * * *' } },
  };
}

const SOURCES = ['tavily-search', 'web-scrape'];
const MEMORY = ['dedupe', 'data-store'];

const briefingSpec: ExpectationSpec = {
  nodeTypes: ['whatsapp'],
  nodeTypesAnyOf: [SOURCES, MEMORY],
  memoryOnPath: { from: SOURCES, through: MEMORY, to: ['whatsapp'], preferThrough: ['dedupe'] },
  hasSchedule: true,
};

describe('pathExists (directed reachability)', () => {
  const edges = [edge('a', 'n1', 'n2'), edge('b', 'n2', 'n3'), edge('c', 'n3', 'n4')];
  it('finds a multi-hop forward path', () => {
    expect(pathExists(edges, 'n1', 'n4')).toBe(true);
  });
  it('is directional — no backward path', () => {
    expect(pathExists(edges, 'n4', 'n1')).toBe(false);
  });
  it('treats a node as reaching itself', () => {
    expect(pathExists(edges, 'n2', 'n2')).toBe(true);
  });
  it('does not loop forever on a cycle', () => {
    const cyclic = [edge('x', 'a', 'b'), edge('y', 'b', 'a')];
    expect(pathExists(cyclic, 'a', 'c')).toBe(false);
  });
});

describe('memoryLiesBetween', () => {
  it('true when dedupe sits between source and send', () => {
    const r = memoryLiesBetween(digestGraph(), {
      from: SOURCES,
      through: MEMORY,
      to: ['whatsapp'],
    });
    expect(r.ok).toBe(true);
    expect(r.satisfyingType).toBe('dedupe');
  });
  it('false when no memory node is present', () => {
    const r = memoryLiesBetween(digestGraph({ withMemory: false }), {
      from: SOURCES,
      through: MEMORY,
      to: ['whatsapp'],
    });
    expect(r.ok).toBe(false);
    expect(r.hasMemory).toBe(false);
  });
  it('false when the memory node is NOT on the source→send path', () => {
    // dedupe dangles off to the side: src→llm→whatsapp, plus a stray src→dedupe
    // with no path from dedupe to the send.
    const g = digestGraph({ withMemory: false });
    g.nodes.push(node('stray', 'dedupe', { storeKey: 'x' }));
    g.edges.push(edge('e_stray', 'src', 'stray'));
    const r = memoryLiesBetween(g, { from: SOURCES, through: MEMORY, to: ['whatsapp'] });
    expect(r.ok).toBe(false);
    expect(r.hasMemory).toBe(true); // present, just not between
  });
  it('flags a data-store satisfier as outside the preferred set', () => {
    const r = memoryLiesBetween(digestGraph({ memoryType: 'data-store' }), {
      from: SOURCES,
      through: MEMORY,
      to: ['whatsapp'],
      preferThrough: ['dedupe'],
    });
    expect(r.ok).toBe(true);
    expect(r.satisfyingType).toBe('data-store');
    expect(r.warnPreferred).toBe(true);
  });
});

describe('scoreGraph — nodeTypesAnyOf', () => {
  it('passes when at least one type in each group is present', () => {
    const r = scoreGraph(digestGraph(), briefingSpec);
    expect(r.passed).toBe(true);
    expect(r.failures).toHaveLength(0);
  });
  it('fails with missing-node-type-anyof when a whole group is absent', () => {
    const g = digestGraph({ withMemory: false }); // no dedupe/data-store
    const r = scoreGraph(g, briefingSpec);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'missing-node-type-anyof')).toBe(true);
  });
});

describe('scoreGraph — memoryOnPath', () => {
  it('passes a recurring digest that dedupes between source and send', () => {
    const r = scoreGraph(digestGraph(), briefingSpec);
    expect(r.passed).toBe(true);
    expect(r.failures.some((f) => f.kind === 'missing-memory-on-path')).toBe(false);
  });
  it('fails a flat source→llm→send digest with missing-memory-on-path', () => {
    const r = scoreGraph(digestGraph({ withMemory: false }), briefingSpec);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'missing-memory-on-path')).toBe(true);
  });
  it('passes but warns when data-store is used instead of the preferred dedupe', () => {
    const r = scoreGraph(digestGraph({ memoryType: 'data-store' }), {
      ...briefingSpec,
      // data-store set-without-valuePath only warns; keep verify off to isolate.
      requireVerifyClean: false,
    });
    expect(r.passed).toBe(true);
    expect(r.warnings.some((w) => w.includes('preferred'))).toBe(true);
  });
});

describe('checkIdempotency (two-run structural simulation)', () => {
  const fixture = {
    results: [{ url: 'https://x/1' }, { url: 'https://x/2' }, { url: 'https://x/3' }],
  };

  it('ok: dedupe filters run 2 to zero new items', () => {
    const r = checkIdempotency(digestGraph(), fixture);
    expect(r.verdict).toBe('ok');
    expect(r.run1NewCount).toBe(3);
    expect(r.run2NewCount).toBe(0);
  });

  it('ok: auto-detect array + url→id fallback when config is empty', () => {
    const r = checkIdempotency(digestGraph({ dedupeConfig: { storeKey: 'seen' } }), fixture);
    expect(r.verdict).toBe('ok');
    expect(r.run2NewCount).toBe(0);
  });

  it('misconfigured: idPath points at a field the source items lack', () => {
    const g = digestGraph({ dedupeConfig: { itemsPath: 'results', idPath: 'link' } });
    const r = checkIdempotency(g, fixture);
    expect(r.verdict).toBe('misconfigured');
    // No id resolves → nothing remembered → run 2 still re-sends everything.
    expect(r.run2NewCount).toBe(3);
  });

  it('misconfigured: itemsPath does not locate the source array', () => {
    const g = digestGraph({ dedupeConfig: { itemsPath: 'articles', idPath: 'url' } });
    const r = checkIdempotency(g, fixture);
    expect(r.verdict).toBe('misconfigured');
  });

  it('no-dedupe: cannot simulate when there is no dedupe node', () => {
    const g = digestGraph({ memoryType: 'data-store' });
    const r = checkIdempotency(g, fixture);
    expect(r.verdict).toBe('no-dedupe');
  });
});

describe('applyIdempotency (folds verdict into a CaseResult)', () => {
  const fixture = {
    results: [{ url: 'https://x/1' }, { url: 'https://x/2' }],
  };
  const passing: CaseResult = { passed: true, failures: [], warnings: [], verifyIssues: [] };

  it('keeps a passing result passing and adds a confirming warning on ok', () => {
    const r = applyIdempotency(passing, digestGraph(), { sourceOutput: fixture });
    expect(r.passed).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('idempotency:'))).toBe(true);
  });

  it('turns a passing result into a failure on a misconfigured dedupe', () => {
    const g = digestGraph({ dedupeConfig: { itemsPath: 'results', idPath: 'link' } });
    const r = applyIdempotency(passing, g, { sourceOutput: fixture });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.kind === 'idempotency')).toBe(true);
  });

  it('records no-dedupe as a warning, not a failure (partial credit)', () => {
    const g = digestGraph({ memoryType: 'data-store' });
    const r = applyIdempotency(passing, g, { sourceOutput: fixture });
    expect(r.passed).toBe(true);
    expect(r.warnings.some((w) => w.includes('no dedupe node'))).toBe(true);
  });

  it('skips the simulation (only warns) when the graph already failed structurally', () => {
    const failed: CaseResult = {
      passed: false,
      failures: [{ kind: 'missing-node-type', message: 'x' }],
      warnings: [],
      verifyIssues: [],
    };
    const r = applyIdempotency(failed, digestGraph(), { sourceOutput: fixture });
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1); // unchanged
    expect(r.warnings.some((w) => w.includes('skipped'))).toBe(true);
  });
});
