<script lang="ts">
  // Daydream — the part's hub. The dreaming clock beside the claim, the live funnel on ink,
  // then the three chapters as questions.
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import DreamEmblem from '../components/art/daydream/DreamEmblem.svelte';
  import ImpactFunnel from '../components/art/daydream/ImpactFunnel.svelte';
  import { DAYDREAM_COPY as C } from '../lib/daydream';
  import { app } from '../lib/appState.svelte';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const d = $derived(data.live.daydream);
  const eli = $derived(app.narrative === 'eli5');
  const funnel = $derived([
    { label: 'Spotted', sub: 'notes it wrote me', value: d?.funnel.spotted ?? null },
    { label: 'Decided', sub: 'I gave a verdict', value: d?.funnel.decided ?? null },
    { label: 'Useful', sub: 'I said it helped', value: d?.funnel.useful ?? null },
    { label: 'Acted on', sub: 'something happened', value: d?.funnel.actedOn ?? null },
    { label: 'Result', sub: 'it came to something', value: d?.funnel.result ?? null },
  ]);
</script>

<svelte:head><title>Daydream — The Engine Room</title></svelte:head>

<PartHub part="daydream">
  {#snippet art()}<DreamEmblem cadence={f.cadenceMinutes} activeHours={f.activeHours} />{/snippet}

  <div class="live">
    <header class="lv-head">
      <span class="er-kicker">Live · the last {f.impactWindowDays} days</span>
      <h2 class="er-display lv-title">From noticed<br />to useful</h2>
      <p class="er-lede">{eli ? C.live.plain : C.live.eng}</p>
      <div class="stats">
        <Stat value={d?.hitRate == null ? null : Math.round(d.hitRate * 100)} unit={d?.hitRate == null ? undefined : '%'} label="of the notes I rated were useful" lead />
        <Stat value={d ? d.checks.running + d.checks.awaiting : null} label="double-checks open right now" />
      </div>
    </header>
    <ImpactFunnel stages={funnel} />
  </div>
</PartHub>
<PageFoot />

<style>
  .live { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
  .live .lv-title { font-size: clamp(34px, 4.4vw, 66px); margin-bottom: 20px; }
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 28px; }
  @media (max-width: 900px) { .live { grid-template-columns: minmax(0, 1fr); } }
</style>
