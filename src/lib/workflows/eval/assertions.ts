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

/**
 * A path-aware assertion: some memory node (`through`) must sit ON a directed
 * path between a source node (`from`) and a send node (`to`). This is what
 * enforces that a recurring digest actually FILTERS its list before sending —
 * a bare `source → llm → send` graph re-sends the same items every run.
 *
 * Passes iff there exists a node M of a `through` type such that some `from`
 * node forward-reaches M AND M forward-reaches some `to` node.
 */
export interface MemoryOnPathSpec {
  /** Source node types (the outside-world list producers). */
  from: string[];
  /** Memory node types that satisfy the barrier (e.g. ['dedupe','data-store']). */
  through: string[];
  /** Send node types the memory must sit upstream of. */
  to: string[];
  /**
   * Optional subset of `through` that is PREFERRED. When the satisfying memory
   * node is outside this set (e.g. a hand-rolled `data-store` instead of the
   * purpose-built `dedupe`), the case still PASSES but records a warning — the
   * scorer is binary, so this is how "dedupe preferred, data-store partial
   * credit" is expressed without a weighting mechanism the scorer doesn't have.
   */
  preferThrough?: string[];
}

/**
 * Opt-in two-run idempotency fixture (B6). Attached to a case whose accepted
 * graph should be proven idempotent across scheduled runs. `sourceOutput` is a
 * representative single-run output of the SOURCE node (the list producer) — the
 * generated dedupe node's `itemsPath` must locate the array in it and its
 * `idPath` must resolve a stable id per element. See `checkIdempotency`.
 */
export interface IdempotencySpec {
  sourceOutput: Record<string, unknown>;
}

/** What a single eval case expects of the generated graph. */
export interface ExpectationSpec {
  /** Node types that MUST all be present (at least once each). */
  nodeTypes: string[];
  /**
   * Groups where AT LEAST ONE type per group must be present — for "the model
   * may legitimately pick `dedupe` OR `data-store`" style alternatives.
   */
  nodeTypesAnyOf?: string[][];
  /**
   * Edges that must exist, matched by the TYPES of the endpoint nodes (not ids,
   * since generated ids are non-deterministic). `{ from: 'a', to: 'b' }` passes
   * if any edge connects some node of type `a` to some node of type `b`.
   */
  edges?: ExpectedEdge[];
  /**
   * A memory node must lie on a directed path between a source and a send (see
   * `MemoryOnPathSpec`). This is the structural guard against the
   * "recurring-digest re-sends everything" failure.
   */
  memoryOnPath?: MemoryOnPathSpec;
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
    | 'missing-node-type-anyof'
    | 'missing-edge'
    | 'missing-memory-on-path'
    | 'missing-schedule'
    | 'verify-error'
    | 'idempotency'
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

// ──────────────────────────────────────────────────────────────────────────
// Path-aware assertions (B6): reachability over the directed edge graph so we
// can assert a memory node sits BETWEEN a source and a send, not just that it
// exists somewhere.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Forward reachability: is there a directed path `fromId → … → toId` over the
 * edges? `fromId === toId` counts as reachable. O(V+E) BFS, cycle-safe.
 */
export function pathExists(
  edges: WorkflowEdgeDef[],
  fromId: string,
  toId: string,
): boolean {
  if (fromId === toId) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.sourceNodeId) ?? [];
    list.push(e.targetNodeId);
    adj.set(e.sourceNodeId, list);
  }
  const seen = new Set<string>([fromId]);
  const queue = [...(adj.get(fromId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === toId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adj.get(id) ?? []) queue.push(next);
  }
  return false;
}

/** Outcome of the memory-on-path check, with enough detail for a good message. */
export interface MemoryOnPathResult {
  ok: boolean;
  /** The type of the memory node that satisfied the path, if any. */
  satisfyingType?: string;
  /** True when the satisfying node is outside `preferThrough` (pass-with-warn). */
  warnPreferred?: boolean;
  hasSource: boolean;
  hasMemory: boolean;
  hasSend: boolean;
}

/**
 * True iff some memory node (`spec.through`) forward-reaches a send node
 * (`spec.to`) AND is itself forward-reached by a source node (`spec.from`) —
 * i.e. the memory genuinely sits on a `source → memory → send` path.
 */
export function memoryLiesBetween(
  graph: EvalGraph,
  spec: MemoryOnPathSpec,
): MemoryOnPathResult {
  const sources = graph.nodes.filter((n) => spec.from.includes(n.type));
  const memories = graph.nodes.filter((n) => spec.through.includes(n.type));
  const sends = graph.nodes.filter((n) => spec.to.includes(n.type));
  const base = {
    hasSource: sources.length > 0,
    hasMemory: memories.length > 0,
    hasSend: sends.length > 0,
  };
  for (const m of memories) {
    const reachedFromSource = sources.some((s) => pathExists(graph.edges, s.id, m.id));
    const reachesSend = sends.some((d) => pathExists(graph.edges, m.id, d.id));
    if (reachedFromSource && reachesSend) {
      const preferred = spec.preferThrough ? spec.preferThrough.includes(m.type) : true;
      return { ok: true, satisfyingType: m.type, warnPreferred: !preferred, ...base };
    }
  }
  return { ok: false, ...base };
}

// ──────────────────────────────────────────────────────────────────────────
// Two-run idempotency (B6). PURE structural simulation — NO engine, NO DB.
//
// run-eval never executes graphs, so we prove idempotency structurally: take a
// representative SOURCE output fixture, read the generated dedupe node's own
// config, and simulate two runs against an in-memory seen-set:
//   run 1 (empty store)   → every item is new, its id is recorded;
//   run 2 (store seeded)  → every item must now be filtered (0 new).
// This proves TWO things at once: (a) the dedupe's itemsPath/idPath actually
// address the shape the source emits (otherwise no id resolves and nothing is
// ever remembered), and (b) a second scheduled run sends nothing already sent.
// It does NOT exercise the real SQL atomic op — that is covered by the dedupe
// executor's own tests; here we only validate the generated *config* is coherent
// with the source. The id/array helpers below deliberately MIRROR the pure parts
// of nodes/dedupe.ts (we must not import that executor — it pulls in the DB).
// ──────────────────────────────────────────────────────────────────────────

/** Mirror of dedupe.ts `resolvePath`. */
function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Mirror of dedupe.ts `extractId` (idPath, then url→id fallback, then primitive). */
function extractId(item: unknown, idPath: string): unknown {
  if (idPath) return resolvePath(item, idPath);
  if (item !== null && typeof item === 'object') {
    const rec = item as Record<string, unknown>;
    if (rec.url !== undefined && rec.url !== null) return rec.url;
    if (rec.id !== undefined && rec.id !== null) return rec.id;
    return undefined;
  }
  return item;
}

/** Mirror of dedupe.ts `autoDetectArray`. */
function autoDetectArray(input: Record<string, unknown>): unknown[] | null {
  for (const v of Object.values(input)) {
    if (Array.isArray(v)) return v;
  }
  return null;
}

/** Verdict of a two-run idempotency simulation for one graph. */
export interface IdempotencyResult {
  /** 'ok' → provably idempotent; 'misconfigured' → dedupe present but broken
   *  (hard fail); 'no-dedupe' → no dedupe node to simulate (soft/partial). */
  verdict: 'ok' | 'misconfigured' | 'no-dedupe';
  detail: string;
  run1NewCount: number | null;
  run2NewCount: number | null;
}

/** Simulate the dedupe filter over `items` twice (empty store, then seeded). */
function simulateTwoRuns(
  items: unknown[],
  idPath: string,
): { run1: number; run2: number; idsResolved: number } {
  // Run 1: empty seen-set. Mirrors dedupe.ts — `seen` does NOT grow mid-run, so
  // intra-run duplicates both pass; new ids are collected and recorded after.
  const collected: string[] = [];
  let run1 = 0;
  let idsResolved = 0;
  for (const item of items) {
    const rawId = extractId(item, idPath);
    if (rawId === undefined || rawId === null) {
      run1++; // no id → passes as "new" but is never recorded
      continue;
    }
    idsResolved++;
    run1++;
    collected.push(String(rawId));
  }
  // Run 2: seed the store with everything run 1 recorded.
  const seeded = new Set<string>(collected);
  let run2 = 0;
  for (const item of items) {
    const rawId = extractId(item, idPath);
    if (rawId === undefined || rawId === null) {
      run2++; // still un-rememberable → re-sent every run
      continue;
    }
    if (seeded.has(String(rawId))) continue;
    run2++;
  }
  return { run1, run2, idsResolved };
}

/**
 * Structural two-run idempotency check. Reads the generated graph's dedupe
 * node(s) and simulates them against `sourceOutput`. Passes if ANY dedupe node
 * achieves `run1 = N, run2 = 0`. See the block comment above for what it proves.
 */
export function checkIdempotency(
  graph: EvalGraph,
  sourceOutput: Record<string, unknown>,
): IdempotencyResult {
  const dedupes = graph.nodes.filter((n) => n.type === 'dedupe');
  if (dedupes.length === 0) {
    return {
      verdict: 'no-dedupe',
      detail:
        'no dedupe node present — two-run idempotency cannot be structurally simulated (a data-store memory may still dedupe, but this check only models the dedupe node).',
      run1NewCount: null,
      run2NewCount: null,
    };
  }

  let lastFail: IdempotencyResult | null = null;
  for (const d of dedupes) {
    const cfg = (d.config ?? {}) as Record<string, unknown>;
    const itemsPath = String(cfg.itemsPath ?? '').trim();
    const idPath = String(cfg.idPath ?? '').trim();
    const storeKey = String(cfg.storeKey ?? '').trim() || 'seen_ids';

    // Resolve the source array the way the dedupe node would.
    let items: unknown[];
    if (itemsPath) {
      const resolved = resolvePath(sourceOutput, itemsPath);
      items = Array.isArray(resolved) ? resolved : [];
    } else {
      items = autoDetectArray(sourceOutput) ?? [];
    }
    if (items.length === 0) {
      lastFail = {
        verdict: 'misconfigured',
        detail: `dedupe "${d.label}" itemsPath ${itemsPath ? `"${itemsPath}"` : '(auto-detect)'} does not locate a non-empty array in the source output (top-level keys: ${Object.keys(sourceOutput).join(', ') || '(none)'}).`,
        run1NewCount: null,
        run2NewCount: null,
      };
      continue;
    }

    const sim = simulateTwoRuns(items, idPath);
    const itemKeys = (() => {
      const first = items.find((it) => it && typeof it === 'object');
      return first ? Object.keys(first as Record<string, unknown>).join(', ') : '(primitives)';
    })();

    if (sim.idsResolved === 0) {
      lastFail = {
        verdict: 'misconfigured',
        detail: `dedupe "${d.label}" idPath ${idPath ? `"${idPath}"` : '(auto url→id)'} resolved no id for any of the ${items.length} source items — it can never remember anything, so every run re-sends everything. Point idPath at a stable id field on the source item (available fields: ${itemKeys}).`,
        run1NewCount: sim.run1,
        run2NewCount: sim.run2,
      };
      continue;
    }

    if (sim.run1 === items.length && sim.run2 === 0) {
      return {
        verdict: 'ok',
        detail: `dedupe "${d.label}" (key "${storeKey}", idPath ${idPath ? `"${idPath}"` : 'url→id'}) passes all ${sim.run1} items on run 1 and 0 on run 2 — a scheduled re-run sends nothing already sent.`,
        run1NewCount: sim.run1,
        run2NewCount: sim.run2,
      };
    }

    lastFail = {
      verdict: 'misconfigured',
      detail: `dedupe "${d.label}" did not achieve two-run idempotency (run 1 new=${sim.run1}/${items.length}, run 2 new=${sim.run2}; expected run 2 = 0). Some items carry no id under idPath ${idPath ? `"${idPath}"` : '(auto url→id)'} and leak through every run.`,
      run1NewCount: sim.run1,
      run2NewCount: sim.run2,
    };
  }

  return (
    lastFail ?? {
      verdict: 'misconfigured',
      detail: 'dedupe idempotency check failed for an unknown reason.',
      run1NewCount: null,
      run2NewCount: null,
    }
  );
}

/**
 * Fold a two-run idempotency verdict into an already-scored CaseResult. Only
 * runs the simulation when the graph was otherwise accepted (structural + verify
 * clean) — a graph that already failed structurally has nothing to prove here.
 * 'misconfigured' → hard failure; 'no-dedupe' → warning (partial credit);
 * 'ok' → confirming note.
 */
export function applyIdempotency(
  result: CaseResult,
  graph: EvalGraph,
  spec: IdempotencySpec,
): CaseResult {
  if (!result.passed) {
    return {
      ...result,
      warnings: [
        ...result.warnings,
        'idempotency: skipped — graph failed structural/verify checks first.',
      ],
    };
  }
  const idem = checkIdempotency(graph, spec.sourceOutput);
  const failures = [...result.failures];
  const warnings = [...result.warnings];
  if (idem.verdict === 'misconfigured') {
    failures.push({ kind: 'idempotency', message: idem.detail });
  } else {
    warnings.push(`idempotency: ${idem.detail}`);
  }
  return { ...result, failures, warnings, passed: failures.length === 0 };
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

  // 1b) At-least-one-of node-type groups (legitimate model alternatives).
  if (expect.nodeTypesAnyOf) {
    for (const group of expect.nodeTypesAnyOf) {
      if (!group.some((t) => presentTypes.has(t))) {
        failures.push({
          kind: 'missing-node-type-anyof',
          message: `Expected at least one of node types [${group.join(', ')}], but none present. Present types: ${[...presentTypes].join(', ') || '(none)'}`,
        });
      }
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

  // 2b) A memory node positioned ON a path between source and send (B6). This
  // is the structural guard against the "recurring digest re-sends everything"
  // failure — presence alone is not enough; it must sit between the two.
  if (expect.memoryOnPath) {
    const mp = memoryLiesBetween(graph, expect.memoryOnPath);
    if (!mp.ok) {
      const missing: string[] = [];
      if (!mp.hasSource) missing.push(`no source node ([${expect.memoryOnPath.from.join(', ')}])`);
      if (!mp.hasMemory) missing.push(`no memory node ([${expect.memoryOnPath.through.join(', ')}])`);
      if (!mp.hasSend) missing.push(`no send node ([${expect.memoryOnPath.to.join(', ')}])`);
      const why = missing.length
        ? missing.join('; ')
        : 'a memory node exists but is not on any directed path source → memory → send';
      failures.push({
        kind: 'missing-memory-on-path',
        message: `Expected a memory node ([${expect.memoryOnPath.through.join(', ')}]) on the path between the source ([${expect.memoryOnPath.from.join(', ')}]) and the send ([${expect.memoryOnPath.to.join(', ')}]) — without it a recurring run re-sends already-sent items. Problem: ${why}.`,
      });
    } else if (mp.warnPreferred) {
      warnings.push(
        `A "${mp.satisfyingType}" node dedupes the source→send path, but ${(expect.memoryOnPath.preferThrough ?? []).map((t) => `"${t}"`).join('/')} is preferred (dedupe does the atomic filter+record in one node).`,
      );
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
