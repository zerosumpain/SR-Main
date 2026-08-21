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
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import type { TrailsDashboard } from '$lib/trails/physio-service';

  let {
    dashboard,
    onevidence,
  }: {
    dashboard: TrailsDashboard | null;
    onevidence?: (id: string) => void;
  } = $props();

  type Tone = 'good' | 'warn' | 'bad' | 'neutral';
  interface Tile {
    label: string;
    value: string;
    unit: string;
    sub: string;
    tone: Tone;
    evidence: string;
  }

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

  const tiles = $derived.by((): Tile[] => {
    const d = dashboard;
    if (!d) return [];
    const out: Tile[] = [];

    if (d.rhr?.latest7 != null) {
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

    if (d.hrv?.latest7 != null) {
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

    const eff = d.efficiency?.ef;
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

    const bkm = d.efficiency?.bkm;
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

{#if tiles.length > 0}
  <div class="tile-grid">
    {#each tiles as t (t.label)}
      <div class="tile">
        <span
          class="tile-value"
          class:good={t.tone === 'good'}
          class:warn={t.tone === 'warn'}
          class:bad={t.tone === 'bad'}
        >
          {t.value}
          <span class="tile-unit">{t.unit}</span>
        </span>
        <span class="sr-label-tight">{t.label}</span>
        <span class="tile-sub">{t.sub}</span>
        <EvidenceChip id={t.evidence} onopen={onevidence} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 1rem 1.25rem;
    margin-bottom: 28px;
  }
  @media (max-width: 700px) {
    .tile-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    min-width: 0;
  }

  .tile-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }
  .tile-value.good {
    color: var(--success);
  }
  .tile-value.warn {
    color: var(--warn);
  }
  .tile-value.bad {
    color: var(--error);
  }

  .tile-unit {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-left: 0.15rem;
  }

  .tile-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
</style>
