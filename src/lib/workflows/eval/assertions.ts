/**
 * Pure scoring / assertion library for NL→workflow generation evals.
 *
 * NO LLM, NO network, NO DB. Given a generated workflow graph (nodes + edges +
 * optional trigger/schedule) and an expectation spec, this scores the graph
 * against structural assertions and runs the SAME correctness gate the
 * generator uses (`verifyWorkflow` from the orchestrator) — so the eval can
 * never pass a workflow the generator itself would reject.
 *
 * This module is intentionally CI-safe: it imports only `verifyWorkflow` (a
 * pure function) and the client-safe registry `getDefinition`. It is exercised
 * by tests/lib/workflows/eval/assertions.test.ts against hand-built fixtures.
 */

import { verifyWorkflow } from '$lib/workflows/orchestrator/verify';
import type { VerificationIssue } from '$lib/workflows/orchestrator/verify';
import { getDefinition } from '$lib/workflows/registry-client';
import type {
  WorkflowNodeDef,
  WorkflowEdgeDef,
  JsonSchema,
} from '$lib/workflows/types';

/**
 * The minimal shape an eval scores. Mirrors the `GeneratedWorkflow` returned by
 * `generateWorkflow` (nodes/edges/trigger), but kept structural so fixtures and
 * live results share one type. `trigger.type` of `cron`/`schedule` (or a
 * `cron`/`schedule`/`interval` field in trigger.config) counts as a schedule.
 */
export interface EvalGraph {
  name?: string;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  trigger?: { type: string; config?: Record<string, unknown> };
  /** Optional generator signal: true if a self-heal / revision round ran. */
  selfHealed?: boolean;
  /** Optional generator signal: warnings surfaced during assembly. */
  warnings?: string[];
}

/** An expected edge — connects a node OF type `from` to a node OF type `to`. */
export interface ExpectedEdge {
  from: string;
  to: string;
}

/** What a single eval case expects of the generated graph. */
export interface ExpectationSpec {
  /** Node types that MUST all be present (at least once each). */
  nodeTypes: string[];
  /**
   * Edges that must exist, matched by the TYPES of the endpoint nodes (not ids,
   * since generated ids are non-deterministic). `{ from: 'a', to: 'b' }` passes
   * if any edge connects some node of type `a` to some node of type `b`.
   */
  edges?: ExpectedEdge[];
  /** When true, a schedule/cron trigger must be present. */
  hasSchedule?: boolean;
  /**
   * When true (the default), the graph must fail `verifyWorkflow` with ZERO
   * error-severity issues. Set false only to score structure independent of the
   * correctness gate.
   */
  requireVerifyClean?: boolean;
  /**
   * When true, the case fails if `graph.selfHealed` is truthy — i.e. the
   * generator needed a revision/heal round to reach a valid graph. Defaults to
   * false (self-heal is allowed but recorded as a warning).
   */
  forbidSelfHeal?: boolean;
}

/** One failed assertion within a case. */
export interface AssertionFailure {
  kind:
    | 'missing-node-type'
    | 'missing-edge'
    | 'missing-schedule'
    | 'verify-error'
    | 'self-heal';
  message: string;
}

/** Result of scoring one graph against one spec. */
export interface CaseResult {
  passed: boolean;
  failures: AssertionFailure[];
  /** Non-fatal observations (e.g. self-heal happened but wasn't forbidden). */
  warnings: string[];
  /** Verify issues surfaced (errors AND warnings) for diagnostics. */
  verifyIssues: VerificationIssue[];
}

/**
 * Output-schema getter for `verifyWorkflow`. The orchestrator resolves this via
 * registered executors; this CI-safe variant has no executors, so it returns
 * the same `{ type: 'object' }` fallback the orchestrator uses when no executor
 * is found (see `getOutputSchema` in orchestrator/index.ts). Consequence:
 * upstream-reference checks are skipped (verifyWorkflow short-circuits when the
 * upstream schema has zero properties), but config-key, template-syntax,
 * code-execute and per-operation semantic gates still run — exactly the gates
 * that catch the common generation regressions.
 */
const evalOutputSchema = (
  _type: string,
  _config: Record<string, unknown>,
): JsonSchema => ({ type: 'object' });

/** True if a trigger represents a schedule (cron / interval / scheduled). */
export function hasScheduleTrigger(
  trigger: EvalGraph['trigger'],
  nodes: WorkflowNodeDef[],
): boolean {
  if (trigger) {
    const t = trigger.type?.toLowerCase?.() ?? '';
    if (t === 'cron' || t === 'schedule' || t === 'scheduled' || t === 'interval') {
      return true;
    }
    const cfg = trigger.config ?? {};
    if (cfg.cron || cfg.schedule || cfg.interval || cfg.cronExpression) return true;
  }
  // Also accept a `trigger` / cron node carrying a cron/schedule config.
  for (const n of nodes) {
    if (n.type !== 'trigger') continue;
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    const mode = typeof cfg.type === 'string' ? cfg.type.toLowerCase() : '';
    if (mode === 'cron' || mode === 'schedule' || mode === 'interval') return true;
    if (cfg.cron || cfg.schedule || cfg.interval || cfg.cronExpression) return true;
  }
  return false;
}

/** Run the orchestrator's verify gate over a graph (no network). */
export function runVerify(graph: EvalGraph): VerificationIssue[] {
  return verifyWorkflow(graph.nodes, graph.edges, getDefinition, evalOutputSchema);
}

/**
 * Score one generated graph against one expectation spec. Pure — no I/O.
 */
export function scoreGraph(graph: EvalGraph, expect: ExpectationSpec): CaseResult {
  const failures: AssertionFailure[] = [];
  const warnings: string[] = [];

  const presentTypes = new Set(graph.nodes.map((n) => n.type));

  // 1) Required node types present.
  for (const type of expect.nodeTypes) {
    if (!presentTypes.has(type)) {
      failures.push({
        kind: 'missing-node-type',
        message: `Expected a node of type "${type}" but none present. Present types: ${[...presentTypes].join(', ') || '(none)'}`,
      });
    }
  }

  // 2) Expected edges connect the expected node TYPES.
  if (expect.edges) {
    // Map node id → type for endpoint resolution.
    const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
    for (const want of expect.edges) {
      const found = graph.edges.some(
        (e) =>
          typeOf.get(e.sourceNodeId) === want.from &&
          typeOf.get(e.targetNodeId) === want.to,
      );
      if (!found) {
        failures.push({
          kind: 'missing-edge',
          message: `Expected an edge from a "${want.from}" node to a "${want.to}" node, but none found.`,
        });
      }
    }
  }

  // 3) Schedule / cron present when expected.
  if (expect.hasSchedule) {
    if (!hasScheduleTrigger(graph.trigger, graph.nodes)) {
      failures.push({
        kind: 'missing-schedule',
        message:
          'Expected a schedule/cron trigger (trigger.type cron|schedule|interval, a cron/schedule/interval in trigger.config, or a trigger node configured as such), but none found.',
      });
    }
  }

  // 4) verifyWorkflow gate — zero error-severity issues.
  const requireVerify = expect.requireVerifyClean !== false;
  const verifyIssues = runVerify(graph);
  if (requireVerify) {
    const errors = verifyIssues.filter((i) => i.severity === 'error');
    for (const err of errors) {
      failures.push({
        kind: 'verify-error',
        message: `verifyWorkflow error on node "${err.nodeLabel}" (${err.nodeId}), field "${err.field}": ${err.issue}`,
      });
    }
  }
  for (const w of verifyIssues.filter((i) => i.severity === 'warning')) {
    warnings.push(`verify warning [${w.nodeLabel}/${w.field}]: ${w.issue}`);
  }

  // 5) Self-heal signal.
  if (graph.selfHealed) {
    if (expect.forbidSelfHeal) {
      failures.push({
        kind: 'self-heal',
        message: 'Graph required a self-heal / revision round, which this case forbids.',
      });
    } else {
      warnings.push('Graph required a self-heal / revision round (allowed, but noted).');
    }
  }

  if (graph.warnings) {
    for (const w of graph.warnings) warnings.push(`assembly warning: ${w}`);
  }

  return { passed: failures.length === 0, failures, warnings, verifyIssues };
}

/** A scored case ready for aggregation. */
export interface ScoredCase {
  name: string;
  result: CaseResult;
}

/** Aggregate pass-rate across many scored cases. */
export interface PassRateReport {
  total: number;
  passed: number;
  failed: number;
  /** 0..1 fraction passing. */
  passRate: number;
  cases: ScoredCase[];
}

/** Aggregate a list of scored cases into a pass-rate report. */
export function aggregate(cases: ScoredCase[]): PassRateReport {
  const total = cases.length;
  const passed = cases.filter((c) => c.result.passed).length;
  const failed = total - passed;
  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : passed / total,
    cases,
  };
}

/** Render a pass-rate report to a human-readable string. */
export function formatReport(report: PassRateReport): string {
  const lines: string[] = [];
  lines.push('═══ Workflow generation eval ═══');
  lines.push(
    `Pass rate: ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(0)}%)`,
  );
  lines.push('');
  for (const c of report.cases) {
    const mark = c.result.passed ? 'PASS' : 'FAIL';
    lines.push(`[${mark}] ${c.name}`);
    for (const f of c.result.failures) {
      lines.push(`    ✗ (${f.kind}) ${f.message}`);
    }
    for (const w of c.result.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }
  return lines.join('\n');
}
