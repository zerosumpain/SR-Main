<script lang="ts">
  // What it cannot do — Part IV, leaf 4.
  //
  // This was the worst page in the study: eighteen guardrails as eighteen cards, 2,478 words
  // of paragraph, and the one number the section exists to make — seventeen boundaries, one
  // request — buried inside them. The matrix says it in a glance, one tile says it in a
  // ratio, and a detail only appears when a reader asks for it.
  //
  // The counts appear once each: the ratio tile, the filter chips, the matrix axes. A row of
  // three stat tiles restating the chips was cut — repetition reads as prose, not instrument.
  //
  // Every guardrail here is described by shape. No configuration, no names, no addresses,
  // nothing about any incident beyond what the constants already say in public.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import RailMatrix from './components/RailMatrix.svelte';
  import FailureModes from './components/FailureModes.svelte';
  import { RAILS, PRINCIPLE, FAILURE_MODES } from '../../lib/guardrails';

  // Every figure on this page is counted from RAILS at render time, including the ones in
  // the header line — a hand-typed "eighteen" is a number waiting to go wrong.

  const TONE = '#8a2d3a';

  // Counted from RAILS, so the headline can never drift from the plot.
  const boundaries = RAILS.filter((r) => r.kind === 'boundary').length;
  const requests = RAILS.length - boundaries;
  const scarred = RAILS.filter((r) => r.scar).length;

  type Filter = 'all' | 'boundary' | 'request' | 'scar';
  const FILTERS: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: RAILS.length },
    { id: 'boundary', label: 'Boundaries', n: boundaries },
    { id: 'request', label: 'Requests', n: requests },
    { id: 'scar', label: 'Scars', n: scarred }
  ];
  let filter = $state<Filter>('all');
</script>

<svelte:head>
  <title>What it cannot do · The Engine Room</title>
  <meta
    name="description"
    content={`${RAILS.length} guardrails plotted by whether they hold regardless of intent, and how many were written by an incident.`} />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="change"
    title="What it cannot do"
    line={`${RAILS.length} guardrails, plotted by whether they hold regardless of intent — and how many were written by an incident.`}
    lineEli5="Some rules are walls; some are polite requests. Which is which, and which were learnt the hard way." />

  <Instrument
    kicker="The instrument"
    title={PRINCIPLE.title}
    tone={TONE}
    takeaway="All but one are boundaries. “Usually honoured” is not a security property.">
    {#snippet controls()}
      <div class="filters" role="group" aria-label="Filter the guardrails">
        {#each FILTERS as f (f.id)}
          <button
            class:on={filter === f.id}
            aria-pressed={filter === f.id}
            onclick={() => (filter = f.id)}>{f.label}<span>{f.n}</span></button>
        {/each}
      </div>
    {/snippet}

    <div class="tally">
      <Stat lead value="{boundaries}/{RAILS.length}" label="hold regardless of intent" tone={TONE} />
    </div>

    <RailMatrix {filter} tone={TONE} />
  </Instrument>

  <Instrument
    kicker="Failure modes"
    title="{FAILURE_MODES.length} ways a guardrail fails without changing"
    tone={TONE}
    reading="Same code, same green dashboard, no longer protecting anything.">
    <FailureModes tone={TONE} />
  </Instrument>

  <PageFoot />
</section>

<style>
  .filters { display: flex; gap: 5px; flex-wrap: wrap; }
  .filters button { display: inline-flex; align-items: center; gap: 6px;
    font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: rgba(28,22,17,0.75);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-pill); padding: 4px 9px; cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s; }
  .filters button:hover { background: #fff; border-color: rgba(28,22,17,0.38); color: var(--text-primary); }
  .filters button span { font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    color: rgba(28,22,17,0.5); }
  .filters button.on { background: #8a2d3a; border-color: #8a2d3a; color: #fff; }
  .filters button.on span { color: rgba(255,255,255,0.75); }

  .filters button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }

  /* One tile, not a row of three: the filter chips already carry the other counts. */
  .tally { display: grid; grid-template-columns: minmax(0, 232px); margin-bottom: 14px; }
</style>
