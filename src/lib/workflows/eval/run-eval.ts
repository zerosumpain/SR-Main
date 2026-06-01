/**
 * LIVE workflow-generation eval runner — calls the REAL generateWorkflow.
 *
 * ⚠️  This makes real LLM calls and touches DB-backed grounding. It is a
 * STANDALONE script and is deliberately kept OUT of the normal vitest suite:
 *   - the filename ends in `run-eval.ts`, NOT `*.test.ts`, so vitest's
 *     `include` glob (tests/**\/*.test.ts, src/**\/*.test.ts) never picks it up;
 *   - the live loop only runs when invoked directly AND `RUN_WORKFLOW_EVAL=1`.
 *
 * ── How to run ──────────────────────────────────────────────────────────────
 *   cd /home/john/strange_rambling_svelte/.worktrees/workflow-improvements
 *   RUN_WORKFLOW_EVAL=1 npx tsx src/lib/workflows/eval/run-eval.ts
 *
 * (Requires a working LLM key + DB env, same as `npm run dev`. Without
 * RUN_WORKFLOW_EVAL=1 the script imports cleanly but does nothing.)
 *
 * It prints a per-case PASS/FAIL breakdown and an overall pass-rate, then exits
 * non-zero if any case failed so CI/cron can gate on it.
 */

import {
  scoreGraph,
  aggregate,
  formatReport,
  type EvalGraph,
  type ScoredCase,
} from './assertions';
import { evalCases } from './cases';

/**
 * Run every case through the real generator and score it. Imported lazily so
 * merely importing this module (e.g. for the runEval export) does not pull in
 * the orchestrator + its DB/LLM deps.
 */
export async function runEval(): Promise<number> {
  const { generateWorkflow } = await import('$lib/workflows/orchestrator/index');

  const scored: ScoredCase[] = [];

  for (const c of evalCases) {
    process.stdout.write(`\n→ Generating: ${c.name}\n`);
    try {
      const out = await generateWorkflow(
        c.prompt,
        null, // no workflowId → no chat persistence / draft rehydration
        (text) => process.stdout.write(`   ${text}`),
        { skipVerification: false },
      );

      if (!out.workflow) {
        scored.push({
          name: c.name,
          result: {
            passed: false,
            failures: [
              {
                kind: 'verify-error',
                message: out.followUp
                  ? `Generator asked a clarifying question instead of building: ${out.followUp}`
                  : 'Generator returned no workflow.',
              },
            ],
            warnings: [],
            verifyIssues: [],
          },
        });
        continue;
      }

      const graph: EvalGraph = {
        name: out.workflow.name,
        nodes: out.workflow.nodes,
        edges: out.workflow.edges,
        trigger: out.workflow.trigger,
        warnings: out.workflow.warnings,
        // A non-empty revision delta means a critic-driven revision round ran.
        selfHealed: (out.thinking?.debate.revisions.length ?? 0) > 0,
      };

      scored.push({ name: c.name, result: scoreGraph(graph, c.expect) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      scored.push({
        name: c.name,
        result: {
          passed: false,
          failures: [{ kind: 'verify-error', message: `Generation threw: ${msg}` }],
          warnings: [],
          verifyIssues: [],
        },
      });
    }
  }

  const report = aggregate(scored);
  process.stdout.write('\n\n' + formatReport(report) + '\n');
  process.stdout.write(
    '\nRun this eval with: RUN_WORKFLOW_EVAL=1 npx tsx src/lib/workflows/eval/run-eval.ts\n',
  );

  return report.failed === 0 ? 0 : 1;
}

// ── Guarded entry point ──────────────────────────────────────────────────────
// Only fire when invoked directly via tsx/node AND the env flag is set. This
// double-guard keeps the live LLM loop out of the vitest suite (which imports
// modules but never sets the flag) and out of accidental imports.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /run-eval\.(ts|js)$/.test(process.argv[1] ?? '');

if (invokedDirectly && process.env.RUN_WORKFLOW_EVAL === '1') {
  runEval()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[run-eval] fatal:', err);
      process.exit(1);
    });
}
