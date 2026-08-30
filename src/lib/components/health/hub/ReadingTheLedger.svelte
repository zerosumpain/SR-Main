<script lang="ts">
  // 04 — READING THE LEDGER. Four columns whose rules are decisions already
  // made in the code, printed beside the table that applies them.
  //
  // The sibling of ReadingTheTable on the activities page, and it exists for
  // the same reason: a column whose rules are invisible is a column you will
  // misread. On this page the four are worse than invisible, because each one
  // has an obvious wrong reading — that a dash means missing data, that a
  // negative form number is bad news, that a 0.4% gap and a 40% gap are the
  // same kind of far, and that the fastest segment is the one you are best at.
  //
  // Every threshold quoted here is imported, never typed as a literal. The
  // ±2% band and the six-effort floor are `segmentForm`'s, the 3% is the
  // coach's `gapScore` inflection, and if any of them move this copy moves
  // with them.
  import SectionHead from './SectionHead.svelte';
  import {
    GETTABLE_GAP_PCT,
    HOLDING_BAND_PCT,
    MIN_EFFORTS_FOR_FORM,
  } from '$lib/trails/segments/form';

  interface Props {
    /** The corpus the taxonomy was counted over — all of it, never the page. */
    corpusCount: number;
    /** How many of those have no form read, which is usually most of them. */
    noReadCount: number;
  }

  let { corpusCount, noReadCount }: Props = $props();

  const counted = $derived(corpusCount.toLocaleString('en-GB'));
  const noRead = $derived(noReadCount.toLocaleString('en-GB'));
  const gettablePct = $derived((GETTABLE_GAP_PCT * 100).toFixed(0));
</script>

<section class="rl">
  <div class="rl-inner">
    <SectionHead
      kicker="04 / Reading the ledger"
      title={['Four columns that', 'read backwards']}
      strap="Each of these has an obvious wrong reading. They belong on the page, because the rules behind them are decisions already made in the code."
      strapCh={38}
    />

    <div class="rl-grid">
      <div class="rl-card">
        <p class="rl-label">Form · negative is quicker</p>
        <p class="rl-body">
          The recent window's median time against the window before it. The underlying number is a
          <em>duration</em>, so a fall is a gain — which is why the sparkline is drawn inverted and
          the column sorts ascending first. Inside ±{HOLDING_BAND_PCT}% it counts as noise and reads
          <span class="rl-mono">Holding</span>. Median-based, deliberately: one effort spent waiting
          at a gate is a 40% outlier on a short stretch, and a mean would call that a collapse.
        </p>
      </div>

      <div class="rl-card">
        <p class="rl-label">No read · a state, not a gap</p>
        <p class="rl-body">
          A form read needs {MIN_EFFORTS_FOR_FORM} efforts. At four the "earlier" median is a single
          effort, and one bad day would then set the direction for the whole segment. So
          {noRead} of {counted} here read as dashes — that is the honest answer for ground covered
          twice, not missing data, and the reason the corpus is not simply filtered down to what can
          be measured.
        </p>
      </div>

      <div class="rl-card">
        <p class="rl-label">Gap · how far is catchable</p>
        <p class="rl-body">
          The best of the last three against the all-time best, as a percentage of it. Under
          {gettablePct}% and improving, the row is tinted: that is
          <span class="rl-strong">gettable</span> — a PB that is a realistic afternoon rather than a
          fantasy. It is the same test the dashboard's board is built from, so the rows tinted here
          are the rows listed there.
        </p>
      </div>

      <div class="rl-card">
        <p class="rl-label">Pace, EF &amp; cost · one sport at a time</p>
        <p class="rl-body">
          Efficiency is metres per minute per beat — the same formula whatever moved you, which is
          exactly the problem: a bike returns more metres for the same heartbeat, so its figures sit
          above a run's and a mixed column sorted by efficiency ranks the machine rather than the
          effort — and cost, the heartbeats spent per kilometre, is the same figure upside down.
          With every type shown, those three columns rank the pace sports and sink the rest; pick a
          type and they rank inside it. Climb, length and effort counts compare across anything.
        </p>
      </div>
    </div>
  </div>
</section>

<style>
  .rl {
    padding: clamp(36px, 4.4vw, 64px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-top: 2px solid rgba(26, 16, 8, 0.12);
  }
  .rl-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  /* Every card carries its own 1px border with a real gap. The gap:1px +
     container-background trick paints unfilled auto-fit tracks as blocks. */
  .rl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }
  .rl-card {
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--bg);
    padding: 22px;
  }

  .rl-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .rl-body {
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }
  .rl-mono {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
  }
  .rl-strong {
    font-weight: 500;
    color: var(--accent);
  }
</style>
