<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import FrameworkGrid from '../components/FrameworkGrid.svelte';
  import { STRATEGY_THEMES } from '../lib/frameworks';
</script>

<svelte:head><title>What good looks like — Keystone</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Field study · What good looks like"
    title="How data strategy is done — and what should already exist"
    thesis="DfE is not starting from a blank page. Government has published a stack of frameworks for data quality, ethics, transparency and maturity; industry has spent two decades codifying what a serious data function looks like. A credible strategy borrows from both — and is measured against the government ones whether it likes it or not."
    thesisEli5="There are ready-made rulebooks for doing data well — some from government, some from industry. A good DfE strategy uses them rather than reinventing the wheel."
    asks={['The government frameworks DfE is held to', 'The industry canon it can borrow from', 'The recurring themes any mature strategy covers']}
    askLabel="What this page maps"
  />

  <h2 class="pe-h2">The themes that should already exist</h2>
  <p class="pe-prose theme-intro">Strip away the labels and the same nine themes recur across every credible data strategy. Use them as a checklist: a strategy that is silent on any of them has a gap.</p>
  <div class="themes">
    {#each STRATEGY_THEMES as t}
      <div class="theme">
        <span class="t-title">{t.title}</span>
        <span class="t-blurb">{t.blurb}</span>
      </div>
    {/each}
  </div>

  <h2 class="pe-h2">The frameworks themselves</h2>
  <FrameworkGrid />
</div>

<style>
  .theme-intro { max-width: 78ch; }
  .themes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 8px 0 6px; }
  .theme { border: 1px solid rgba(28,22,17,0.1); border-radius: 8px; background: rgba(255,255,255,0.4); padding: 10px 12px; }
  .t-title { display: block; font-family: 'Fraunces', serif; font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
  .t-blurb { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.66); }
  @media (max-width: 820px) { .themes { grid-template-columns: 1fr; } }
</style>
