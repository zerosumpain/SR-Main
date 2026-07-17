/**
 * One-off subset eval: run ONLY the two recurring-digest cases through the
 * REAL generator to validate the M2 prompt/critic/verify changes end-to-end
 * (does a no-"new"-keyword briefing prompt now come out with a dedupe node?).
 *
 *   RUN_WORKFLOW_EVAL=1 npx tsx scripts/eval-digest-cases.ts
 *
 * Mirrors src/lib/workflows/eval/run-eval.ts but slices the case list — the
 * full runner has no filter flag and 7 live generations is disproportionate
 * for a pre-deploy smoke of the digest behaviour.
 */
import { scoreGraph, applyIdempotency, aggregate, formatReport, type EvalGraph, type ScoredCase } from '../src/lib/workflows/eval/assertions';
import { evalCases } from '../src/lib/workflows/eval/cases';

async function main() {
  const { generateWorkflow } = await import('../src/lib/workflows/orchestrator/index');
  const subset = evalCases.filter(
    (c) => /headline|briefing|news/i.test(c.prompt) || /digest|briefing/i.test(c.name),
  );
  console.log(`Running ${subset.length} digest cases: ${subset.map((c) => c.name).join(', ')}`);

  const scored: ScoredCase[] = [];
  for (const c of subset) {
    process.stdout.write(`\n→ Generating: ${c.name}\n`);
    try {
      const out = await generateWorkflow(c.prompt, null, () => {}, { skipVerification: false });
      if (!out.workflow) {
        scored.push({ name: c.name, result: { passed: false, failures: [{ kind: 'verify-error', message: out.followUp ? `Clarifying question: ${out.followUp}` : 'No workflow returned' }], warnings: [], verifyIssues: [] } });
        continue;
      }
      const graph: EvalGraph = {
        name: out.workflow.name,
        nodes: out.workflow.nodes,
        edges: out.workflow.edges,
        trigger: out.workflow.trigger,
        warnings: out.workflow.warnings,
        selfHealed: (out.thinking?.debate.revisions.length ?? 0) > 0,
      };
      console.log(`   nodes: ${graph.nodes.map((n) => n.type).join(' → ')}`);
      let result = scoreGraph(graph, c.expect);
      if (c.idempotency) result = applyIdempotency(result, graph, c.idempotency);
      scored.push({ name: c.name, result });
    } catch (err) {
      scored.push({ name: c.name, result: { passed: false, failures: [{ kind: 'verify-error', message: `Threw: ${err instanceof Error ? err.message : err}` }], warnings: [], verifyIssues: [] } });
    }
  }
  console.log('\n' + formatReport(aggregate(scored)));
  process.exit(scored.every((s) => s.result.passed) ? 0 : 1);
}

if (process.env.RUN_WORKFLOW_EVAL === '1') main();
else console.log('Set RUN_WORKFLOW_EVAL=1 to run.');
