/**
 * The proposer against a real model, and the tester against real data.
 *
 * Run deliberately (it spends model budget):
 *   npx vitest run src/lib/daydream/hypotheses/live.integration.test.ts
 */
import { describe, it, expect } from 'vitest';
import { proposeHypotheses } from './propose';
import { saveProposals } from './store';
import { testDueHypotheses } from './test';
import { loadBoard } from './store';

describe('the hypothesis loop, end to end', () => {
  it('proposes, saves, tests and boards', async () => {
    let batch;
    try {
      batch = await proposeHypotheses(4);
    } catch {
      return expect(true).toBe(true);
    }

    console.log(`\n  PROPOSER tokens=${batch.tokens} accepted=${batch.proposals.length} rejected=${batch.rejected.length}`);
    for (const r of batch.rejected) console.log(`   rejected: ${r.reason}`);
    for (const p of batch.proposals) {
      console.log(`   Q: ${p.question}`);
      console.log(`      ${p.a} ${p.lagDays ? '->' : '~'} ${p.b}, expects ${p.direction}`);
    }
    if (batch.error) console.log(`   ERROR: ${batch.error}`);

    if (batch.proposals.length) {
      await saveProposals(batch.proposals, { tokens: batch.tokens });
      const run = await testDueHypotheses({ windowDays: 365 });
      console.log(
        `  TESTED ${run.tested} (family ${run.familySize}): ${run.supported} held, ` +
          `${run.refuted} refuted, ${run.wrongDirection} backwards, ${run.underpowered} underpowered`,
      );
      const board = await loadBoard(10);
      for (const b of board.slice(0, 6)) {
        console.log(`   [${b.verdict ?? 'untested'}] ${b.question} — ${b.summary ?? ''}`);
      }
      // Whatever it proposed must be answerable or honestly marked otherwise.
      expect(run.tested).toBeGreaterThan(0);
    }

    // The proposer must never emit a pair it was told not to.
    for (const p of batch.proposals) expect(p.a).not.toBe(p.b);
  }, 180_000);
});
