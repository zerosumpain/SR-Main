// The Lab smoke (spec §12.1 item 7) and the report's shape (WP5 acceptance:
// "the report shows every gate with confidence intervals"). It plays a real
// bot county on the real engine in this thread, small enough for the PR
// gate; `npx tsx scripts/hometowns/lab.ts --smoke` runs §12.1's full
// 12 seeds × 20 days × 4 towns on the worker pool. Nothing here is timed:
// wall-clock limits depend on how loaded the runner is, not on the code, so
// the speed of the smoke is measured by the CLI and the budgets by bench.ts.

import { describe, expect, it } from 'vitest';
import { runLab } from '../../../../../scripts/hometowns/lab/runner';
import { renderHtml } from '../../../../../scripts/hometowns/lab/report';
import { runCounty } from '../../../../../scripts/hometowns/lab/run';

const GATES = ['G1', 'G2', 'G2b', 'G13', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12'];

describe('Lab smoke', () => {
  it('plays mixed bot counties and reports every gate, with intervals', { timeout: 60_000 }, async () => {
    const { scorecard: s, data } = await runLab({ profile: 'smoke', seeds: 1, days: 3, timingSeeds: 0, workers: 0, baseline: null });

    // Broad envelopes: towns exist and grew, nothing reverted, no move threw a non-game error.
    expect(data.mixed).toHaveLength(1);
    for (const r of data.mixed) {
      expect(r.towns).toHaveLength(4);
      expect(r.roomBytes).toBeGreaterThan(0);
      for (const t of r.towns) {
        expect(t.pop).toHaveLength(3);
        for (const x of [...t.pop, ...t.happy, ...t.reserves]) expect(Number.isFinite(x)).toBe(true);
        expect(t.reverted).toBe(0);
        expect(Object.keys(t.refused).filter((k) => k.includes(': error:'))).toEqual([]);
      }
      const bal = r.towns.find((t) => t.bot === 'balanced')!;
      expect(bal.pop[2]).toBeGreaterThan(200);
    }
    expect(s.alerts.reverted).toBe(0);
    expect(s.alerts.refusedErrors).toBe(0);

    // Every gate, in order, each check with a verdict; sample statistics carry a CI.
    expect(s.gates.map((g) => g.id)).toEqual(GATES);
    for (const g of s.gates) {
      expect(['pass', 'fail', 'pending']).toContain(g.verdict);
      expect(g.checks.length).toBeGreaterThan(0);
      for (const c of g.checks) {
        expect(c.ok === null || typeof c.ok === 'boolean').toBe(true);
        if (c.ok === null && !c.provisional) expect(c.note, `${g.id} ${c.name}`).toBeTruthy();
      }
    }
    const withCI = s.gates.flatMap((g) => g.checks).filter((c) => c.ci);
    expect(withCI.length).toBeGreaterThan(5);
    for (const c of withCI) expect(c.ci!.lo).toBeLessThanOrEqual(c.ci!.hi);
    expect(s.gates.filter((g) => g.m0).map((g) => g.id)).toEqual(['G3', 'G8', 'G9', 'G10', 'G12']);
    // Gates that wait for the county (WP3) say so instead of passing.
    expect(s.gates.find((g) => g.id === 'G4')!.verdict).toBe('pending');
    // G13's catalogue lint and the tutorial founding run in the smoke too.
    expect(s.gates.find((g) => g.id === 'G13')!.checks[0].ok).toBe(true);

    // The HTML report is one self-contained page: every gate, no scripts, no network.
    const html = renderHtml(s);
    for (const id of GATES) expect(html).toContain(`${id} ·`);
    expect(html).not.toMatch(/<script|https?:\/\//);
    // The scorecard is plain JSON (the report schema): it survives a round trip unchanged.
    const json = JSON.stringify(s);
    expect(JSON.stringify(JSON.parse(json))).toBe(json);
  });

  it('observing a run changes nothing, and the same spec gives the same county', { timeout: 30_000 }, () => {
    const spec = { experiment: 'smoke', seed: 11, bots: ['balanced'], days: 1 };
    const [a] = runCounty({ ...spec, observe: true, timings: true });
    const [b] = runCounty({ ...spec, observe: false });
    expect(a.hash).toBe(b.hash);
    expect(a.towns[0].monthly.months).toBeGreaterThan(10);
    // G10's amplitude series: the £ Homes ratio M12 housing used, one per observed month (decision 9).
    const hr = a.towns[0].monthly.homesRatio!;
    expect(hr).toHaveLength(a.towns[0].monthly.months);
    for (const x of hr) expect(x).toBeGreaterThanOrEqual(0);
    expect(hr.some((x) => x > 0)).toBe(true);
    expect(a.timings!.month.length).toBeGreaterThan(10);
    const [c] = runCounty({ ...spec, observe: false });
    expect(c.hash).toBe(b.hash);
  });
});
