// src/lib/curate/live-test.ts
//
// Phase 4.2 — live-test runner.
//
// Execution strategy: option (c) — schedule test cases as pending.
// Running the new node executor requires a full workflow row in the session's
// dev-server DB, plus a running per-session dev server. That setup is
// substantially more work than the rest of this phase. For v1, each example
// from nodeSpec.llmExamples is recorded as a pending result in iterationLog.
// The user can trigger each test manually from the canvas.
//
// To upgrade to option (a) (hit the per-session dev server) in a follow-up,
// replace the loop body with a fetch to:
//   `http://localhost:${session.devServerPort}/api/workflows/${testWorkflowId}/nodes/${nodeId}/run`
// and await the run result via the /api/workflows/[id]/runs/[runId] polling
// endpoint that already exists.

import { getSession, updateSession } from './session-store';
import type { NodeSpec, NodeExample } from './spec/types';

// ── Public result type ──────────────────────────────────────────────────

export interface TestCaseResult {
  scenario: string;
  /** ok is intentionally null — only the user can judge correctness. */
  ok: null;
  /** 'pending' in v1 since execution is scheduled, not run in-process. */
  output: 'pending';
  /** Populated if scheduling itself failed (not the node executor). */
  error?: string;
  /** Execution metadata for display. */
  config: Record<string, unknown>;
}

// ── Log entry type ───────────────────────────────────────────────────────

interface LiveTestLogEntry {
  phase: 'live-test';
  at: string;
  results: TestCaseResult[];
}

// ── runTestCases ─────────────────────────────────────────────────────────

/**
 * Phase 4.2: schedules each llmExample as a pending test result.
 *
 * Does NOT auto-judge ok — the user decides via the UI.
 *
 * In v1 this records pending results (option c). To upgrade to real
 * execution, replace the inner loop with a fetch to the per-session
 * dev server's /api/workflows/[id]/nodes/[nodeId]/run endpoint.
 *
 * @param sessionId - The curate session to record results for.
 * @param opts.fetchFn - Injectable fetch for tests (ignored in v1 option-c
 *   path, but wired so future option-a code can accept it).
 */
export async function runTestCases(
  sessionId: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<TestCaseResult[]> {
  // fetchFn is accepted for forward-compatibility but unused in v1.
  void opts.fetchFn;

  // 1. Load session.
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);
  if (!session.nodeSpec) throw new Error(`Session ${sessionId} has no nodeSpec — cannot run tests`);

  const spec = session.nodeSpec as unknown as NodeSpec;
  const examples: NodeExample[] = spec.llmExamples ?? [];

  // 2. Build pending results for each example.
  const results: TestCaseResult[] = examples.map((ex) => ({
    scenario: ex.scenario,
    ok: null,
    output: 'pending',
    config: ex.config,
  }));

  // 3. Append to iterationLog.
  const logEntry: LiveTestLogEntry = {
    phase: 'live-test',
    at: new Date().toISOString(),
    results,
  };

  const existing = (session.iterationLog ?? []) as unknown[];
  await updateSession(sessionId, {
    iterationLog: [...existing, logEntry],
  });

  return results;
}
