<script lang="ts">
  // Impact — the live score. The share of rated notes I called useful, my verdicts week by
  // week, the funnel from spotted to done, and the caps that keep the loop small. Counts come
  // from the feature's own loadImpact(), trimmed in live.server.ts to totals; the caps are
  // read from the feature's modules.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import HitRing from '../../components/art/daydream/HitRing.svelte';
  import WeekColumns from '../../components/art/daydream/WeekColumns.svelte';
  import ImpactFunnel from '../../components/art/daydream/ImpactFunnel.svelte';
  import PipMeter from '../../components/art/daydream/PipMeter.svelte';
  import { DAYDREAM_COPY as C } from '../../lib/daydream';
  import { app } from '../../lib/appState.svelte';
  import { reveal } from '../../lib/motion';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const d = $derived(data.live.daydream);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const funnel = $derived([
    { label: 'Spotted', sub: 'notes it wrote me', value: d?.funnel.spotted ?? null },
    { label: 'Decided', sub: 'I gave a verdict', value: d?.funnel.decided ?? null },
    { label: 'Useful', sub: 'I said it helped', value: d?.funnel.useful ?? null },
    { label: 'Acted on', sub: 'something happened', value: d?.funnel.actedOn ?? null },
    { label: 'Result', sub: 'it came to something', value: d?.funnel.result ?? null },
  ]);
</script>

<svelte:head><title>Impact — Daydream — The Engine Room</title></svelte:head>

<LeafHead part="daydream" title="Impact" line={C.impact.line.eng} lineEli5={C.impact.line.plain}>
  {#snippet art()}
    <div class="score">
      <HitRing rate={d?.hitRate ?? null} rated={d?.rated ?? null} windowDays={f.impactWindowDays} />
      <div class="s-side">
        <span class="er-kicker">Live · the last {f.impactWindowDays} days</span>
        <p class="er-pull">Not how much it wrote, or how clever it sounded. Just whether I said it helped.</p>
        <div class="stats">
          <Stat value={d?.rated ?? null} label="notes I gave a verdict" />
          <Stat value={d?.noticed ?? null} label="notes that reached me" />
        </div>
      </div>
    </div>
  {/snippet}
</LeafHead>

<Band surface="ink" part="daydream" label="Verdicts by week">
  <header class="head">
    <span class="er-kicker">Live · week by week</span>
    <h2 class="er-display sec-title" {@attach reveal({ y: 30 })}>My verdicts,<br />every week</h2>
    <p class="er-lede">{eli ? 'Each column is a week, starting on a Monday. The bottom is what helped, the middle what didn’t, and the top what I haven’t got round to judging.' : 'Weekly verdict totals over the impact window, weeks starting Monday. Counts only.'}</p>
  </header>
  {#if d && d.weeks.length}
    <WeekColumns weeks={d.weeks} />
  {:else}
    <p class="none">The live counts aren’t available right now. When they are, each week stands here as a column.</p>
  {/if}
</Band>

<Band surface="paper" part="daydream" label="The funnel">
  <div class="split">
    <header>
      <span class="er-kicker">From spotted to done</span>
      <h2 class="er-display sec-title" {@attach reveal({ y: 30 })}>Most fall away,<br />on purpose</h2>
      <p class="er-lede">{t(C.live)}</p>
    </header>
    <ImpactFunnel stages={funnel} />
  </div>
</Band>

<Band surface="ink" part="daydream" label="The caps">
  <div class="split">
    <header>
      <span class="er-kicker">On a short lead</span>
      <h2 class="er-display sec-title" {@attach reveal({ y: 30 })}>Kept small<br />by design</h2>
      <p class="er-lede">{t(C.impact.caps)}</p>
    </header>
    <div class="pips">
      <PipMeter value={f.dailyRaiseCap} label="notes it may raise with me in a day" sub="however much it finds" />
      <PipMeter value={f.maxNotesPerCycle} label="notes a single thought may write" />
      <PipMeter value={f.maxRounds} label="rounds of thinking per thought" />
      <PipMeter value={f.maxToolCalls} label="look-ups per thought" sub="each one a read of my data or the web, never both" />
    </div>
  </div>
</Band>

<PageFoot />

<style>
  .score { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: clamp(24px, 5vw, 80px); align-items: center; }
  .s-side .er-pull { margin-bottom: 26px; }
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
  .head { max-width: 860px; margin-bottom: clamp(24px, 3vw, 40px); }
  .split { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
  .head .sec-title, .split .sec-title { font-size: clamp(32px, 4.2vw, 62px); margin-bottom: 20px; }
  .none { margin: 0; padding: 40px 24px; border: 1px dashed var(--rule-strong); color: var(--fg-3); font-size: var(--fs-body-sm); text-align: center; }
  @media (max-width: 900px) { .score, .split { grid-template-columns: minmax(0, 1fr); } }
</style>
