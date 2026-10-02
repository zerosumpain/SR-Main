<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Instrument from '../components/viz/Instrument.svelte';
  import Funnel from '../components/viz/Funnel.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { num, pct } from '../lib/format';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const d = $derived(data.live.daydream);
</script>

<svelte:head><title>Daydream — The Engine Room</title></svelte:head>

<section class="pe-route">
  <PartHub part="daydream">
    <Instrument
      kicker="Live · last {f.impactWindowDays} days"
      title="From noticed to useful"
      reading="Notes written, the ones I gave a verdict, the ones I called useful, and what came of them. Totals only."
      takeaway="Most notes are never worth acting on, and that’s fine. The loop is judged on the ones that are."
      tone="var(--accent)"
    >
      {#if d}
        <div class="stats">
          <Stat value={num(d.noticed)} label="notes reached me" tone="var(--accent)" />
          <Stat value={pct(d.hitRate)} label="of rated notes were useful" tone="var(--accent)" lead />
          <Stat value={num(d.checks.running + d.checks.awaiting)} label="double-checks open" tone="var(--accent)" />
        </div>
        <Funnel tone="var(--accent)" stages={[
          { label: 'Spotted', value: d.funnel.spotted },
          { label: 'Decided', value: d.funnel.decided },
          { label: 'Useful', value: d.funnel.useful },
          { label: 'Acted on', value: d.funnel.actedOn },
          { label: 'Result', value: d.funnel.result },
        ]} />
      {:else}
        <p class="pe-prose">The live counts aren’t available right now.</p>
      {/if}
    </Instrument>
  </PartHub>
  <PageFoot />
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; margin-bottom: 14px; }
</style>
