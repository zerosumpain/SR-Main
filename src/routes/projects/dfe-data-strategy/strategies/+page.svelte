<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import InfluenceMap from '../components/InfluenceMap.svelte';
  import StrategyTiers from '../components/StrategyTiers.svelte';
  import { STRATEGIES_BY_TIER } from '../lib/strategies';
  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>The Influence Map — what should shape DfE's data strategy — Keystone</title>
  <meta name="description" content="An editorial map of every strategy, statute and framework in the landscape — ranked by how much each should actually shape DfE's data strategy, from 'set the course' to 'context only'." />
</svelte:head>

<div class="pe-route wide ed">
  <span class="pe-eyebrow">Field study · The influence map</span>
  <h1 class="pe-h1 ed-h1">Not every strategy deserves a seat at the table.</h1>
  <p class="pe-lede ed-lede">
    {#if eli}
      There are dozens of government strategies, laws and industry rulebooks about data. Some should completely shape what DfE does. Others barely matter. This map sorts them — so the strategy listens to the right ones.
    {:else}
      A data-strategy lead is handed a tottering pile of strategies, statutes, frameworks and roadmaps and told to "align" with all of them. That way lies a mission statement, not a strategy. The discipline is subtraction: deciding which of these should <em>set the course</em>, which to <em>borrow from</em>, which to merely <em>comply with</em> — and which are simply context. Here is the whole landscape, placed by how directly it bears on DfE and how hard it should pull.
    {/if}
  </p>

  <figure class="pull">
    <blockquote>“Aligning with everything is the same as aligning with nothing. {STRATEGIES_BY_TIER.shape.length} of these should shape the strategy. The other {STRATEGIES_BY_TIER.borrow.length + STRATEGIES_BY_TIER.watch.length + STRATEGIES_BY_TIER.context.length} should know their place.”</blockquote>
  </figure>

  <section class="map-wrap">
    <InfluenceMap />
  </section>

  <p class="ed-transition">Read the map as four verdicts. Top-right is where the strategy should spend its attention; bottom-left is where it should spend almost none.</p>

  <StrategyTiers />

  <p class="foot-link">→ See how these pressures play out in the <a href="/projects/dfe-data-strategy/workbench">workbench</a>, or read the <a href="/projects/dfe-data-strategy/frameworks">frameworks</a> in full.</p>
</div>

<style>
  .ed { padding-bottom: 30px; }
  .ed-h1 { max-width: 20ch; font-size: clamp(28px, 5vw, 48px); line-height: 1.02; }
  .ed-lede { max-width: 74ch; margin-bottom: 18px; }
  .ed-lede em { font-style: italic; color: var(--ink); }
  .pull { margin: 18px 0 22px; padding: 0 0 0 20px; border-left: 4px solid #8a2d3a; max-width: 72ch; }
  .pull blockquote { margin: 0; font-family: 'Fraunces', serif; font-size: clamp(18px, 2.4vw, 24px); line-height: 1.3; font-weight: 500; color: var(--ink); font-style: italic; }
  .map-wrap { margin: 8px 0 10px; padding: 16px; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); background: rgba(255,255,255,0.32); }
  .ed-transition { margin: 6px 0 26px; font-size: 14px; line-height: 1.55; color: rgba(28,22,17,0.66); max-width: 74ch; }
  .foot-link { margin: 26px 0 0; font-size: 13px; color: rgba(28,22,17,0.65); }
  .foot-link a { color: var(--accent-ink); }
</style>
