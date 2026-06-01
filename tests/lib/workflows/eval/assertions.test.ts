import { describe, it, expect } from 'vitest';
import {
  scoreGraph,
  aggregate,
  formatReport,
  hasScheduleTrigger,
  runVerify,
  type EvalGraph,
  type ExpectationSpec,
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
