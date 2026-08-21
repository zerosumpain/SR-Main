<script lang="ts">
  // The seven-day state of each measure against its own 28-day baseline.
  //
  // Was the "Signals" block inside the old GroundDashboard, which the hub then
  // rendered a SECOND, separate signals grid above — two tile rows answering
  // the same question with different numbers. This is now the only one.
  //
  // Deliberately does NOT carry VO₂max or Whoop recovery, though the dashboard
  // supplies both: cardio fitness belongs to the Fitness block in the same
  // chapter (which shows it against the population, not against itself), and
  // recovery belongs to the readiness composite at the top of the page. A
  // number that appears twice on one page is a number the reader has to
  // reconcile.
  import StatRow, { type Stat } from '$lib/components/health/StatRow.svelte';
  import type { TrailsDashboard } from '$lib/trails/physio-service';

  let {
    dashboard,
    scope = 'body',
    onevidence,
  }: {
    dashboard: TrailsDashboard | null;
    /**
     * `body` — resting heart rate and HRV: what state the body is in.
     * `work` — efficiency and cost: what the sessions produced.
     *
     * Split because the two chapters were showing each other's numbers. A
     * heart-rate variability tile next to a training-load chart reads as the
     * same subject twice.
     */
    scope?: 'body' | 'work';
    onevidence?: (id: string) => void;
  } = $props();


  function delta(latest: number | null, baseline: number | null, downIsGood: boolean, dp = 1) {
    if (latest == null || baseline == null) return null;
    const scale = 10 ** dp;
    const diff = Math.round((latest - baseline) * scale) / scale;
    const good = downIsGood ? diff <= 0 : diff >= 0;
    return { diff, good };
  }

  // A dead feed must not present its last week as current: the trailing means
  // are already anchored on today (so they null out as the window empties),
  // and any reading older than 3 days is labelled with its age.
  function staleNote(lastDate: string | null | undefined): string {
    if (!lastDate) return '';
    const ageDays = Math.floor(
      (Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(lastDate)) / 86400000,
    );
    return ageDays > 3 ? ` · last reading ${ageDays}d ago` : '';
  }

  const tiles = $derived.by((): Stat[] => {
    const d = dashboard;
    if (!d) return [];
    const out: Stat[] = [];

    if (scope === 'body' && d.rhr?.latest7 != null) {
      const dl = delta(d.rhr.latest7, d.rhr.baseline28, true);
      out.push({
        label: 'Resting HR',
        value: String(Math.round(d.rhr.latest7)),
        unit: 'bpm · 7d',
        sub: (dl ? `${dl.diff > 0 ? '+' : ''}${dl.diff} vs 28d` : '—') + staleNote(d.rhr.lastDate),
        tone: dl ? (dl.good ? 'good' : dl.diff >= 3 ? 'warn' : 'neutral') : 'neutral',
        evidence: 'autonomic-balance',
      });
    }

    if (scope === 'body' && d.hrv?.latest7 != null) {
      const dl = delta(d.hrv.latest7, d.hrv.baseline28, false);
      out.push({
        label: 'HRV (RMSSD)',
        value: String(Math.round(d.hrv.latest7)),
        unit: 'ms · 7d',
        sub: (dl ? `${dl.diff > 0 ? '+' : ''}${dl.diff} vs 28d` : '—') + staleNote(d.hrv.lastDate),
        tone: dl ? (dl.good ? 'good' : dl.diff <= -5 ? 'warn' : 'neutral') : 'neutral',
        evidence: 'autonomic-balance',
      });
    }

    const eff = scope === 'work' ? d.efficiency?.ef : null;
    if (eff?.latest7 != null) {
      const dl = delta(eff.latest7, eff.baseline28, false, 2);
      out.push({
        label: 'Efficiency',
        value: eff.latest7.toFixed(2),
        unit: 'm/min/bpm · 7d',
        sub: (dl ? `${dl.diff > 0 ? '+' : ''}${dl.diff} vs 28d` : '—') + staleNote(eff.lastDate),
        tone: dl ? (dl.good ? 'good' : dl.diff <= -0.05 ? 'warn' : 'neutral') : 'neutral',
        evidence: 'efficiency-factor',
      });
    }

    const bkm = scope === 'work' ? d.efficiency?.bkm : null;
    if (bkm?.latest7 != null) {
      // 1 dp, not 0: a +0.4 b/km drift must not round to "+0" in a good tone.
      const dl = delta(bkm.latest7, bkm.baseline28, true, 1);
      out.push({
        label: 'Cost',
        value: String(Math.round(bkm.latest7)),
        unit: 'b/km · 7d',
        sub: (dl ? `${dl.diff > 0 ? '+' : ''}${dl.diff} vs 28d` : '—') + staleNote(bkm.lastDate),
        tone: dl ? (dl.good ? 'good' : dl.diff >= 20 ? 'warn' : 'neutral') : 'neutral',
        evidence: 'efficiency-factor',
      });
    }

    return out;
  });
</script>

<StatRow stats={tiles} {onevidence} />
