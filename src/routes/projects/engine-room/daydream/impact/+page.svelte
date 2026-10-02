<script lang="ts">
  // Impact — the live score. Weekly verdict totals and the caps that keep the loop small.
  // Counts come from the feature's own loadImpact(), trimmed in live.server.ts to totals.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import { DAYDREAM_COPY as C } from '../../lib/daydream';
  import { app } from '../../lib/appState.svelte';
  import { num, pct } from '../../lib/format';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const d = $derived(data.live.daydream);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  type Show = 'useful' | 'notUseful' | 'undecided';
  let show = $state<Show>('useful');
  const SHOW_LABEL: Record<Show, string> = { useful: 'Useful', notUseful: 'Not useful', undecided: 'No verdict yet' };
  const week = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
</script>

<svelte:head><title>Impact — Daydream — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="daydream" title="Impact" line={C.impact.line.eng} lineEli5={C.impact.line.plain} />

  <div class="stats">
    <Stat value={pct(d?.hitRate)} label="useful, of the notes I rated" lead tone="var(--accent)" />
    <Stat value={num(d?.rated)} label="notes rated, last {f.impactWindowDays} days" tone="var(--accent)" />
    <Stat value={num(d?.noticed)} label="notes that reached me" tone="var(--accent)" />
  </div>

  <Instrument kicker="Live · by week" title="My verdicts, week by week" reading="Weeks start on Monday. Totals only." tone="var(--accent)">
    {#snippet controls()}
      <div class="seg" role="group" aria-label="Which verdict">
        {#each Object.keys(SHOW_LABEL) as k}
          <button class:on={show === k} onclick={() => (show = k as Show)}>{SHOW_LABEL[k as Show]}</button>
        {/each}
      </div>
    {/snippet}
    {#if d && d.weeks.length}
      <Bars tone="var(--accent)" grouped={false} items={d.weeks.map((w) => ({ label: week(w.start), value: w[show] }))} />
    {:else}
      <p class="pe-prose">The live counts aren’t available right now.</p>
    {/if}
  </Instrument>

  <Instrument kicker="On a short lead" title="The caps" takeaway={t(C.impact.caps)}>
    <div class="stats">
      <Stat value={f.dailyRaiseCap} label="notes raised to me a day, at most" />
      <Stat value={f.maxNotesPerCycle} label="notes per thought" />
      <Stat value={f.maxRounds} label="model rounds per thought" />
      <Stat value={f.maxToolCalls} label="tool calls per thought" />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin: 0 0 18px; }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; padding: 5px 10px; border-radius: var(--radius-sharp); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; color: var(--text-primary); }
  .seg button.on { background: var(--accent); color: #fff; }
</style>
