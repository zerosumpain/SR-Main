<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import TakeawayBar from '../components/TakeawayBar.svelte';
  import NextStep from '../components/NextStep.svelte';
  import Reveal from '../components/Reveal.svelte';
  import FrameworkGrid from '../components/FrameworkGrid.svelte';
  import FrameworkMap from '../components/FrameworkMap.svelte';
  import { STRATEGY_THEMES, FRAMEWORKS } from '../lib/frameworks';
</script>

<svelte:head><title>What good looks like — Keystone</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Understand · What good looks like"
    title="How data strategy is done — and what should already exist"
    thesis="DfE is not starting from a blank page. Government has published a stack of frameworks for data quality, ethics, transparency and maturity; industry has spent two decades codifying what a serious data function looks like. A credible strategy borrows from both — and is measured against the government ones whether it likes it or not."
    thesisEli5="There are ready-made rulebooks for doing data well — some from government, some from industry. A good DfE strategy uses them rather than reinventing the wheel."
    asks={['The government frameworks DfE is held to', 'The industry canon it can borrow from', 'The recurring themes any mature strategy covers']}
    askLabel="What this page maps"
  />

  <TakeawayBar
    takeaway="Nine themes recur in every credible data strategy. A draft that is silent on any of them has a gap — and the Author's checks will say so."
    takeawayEli5="Every good data plan covers the same nine topics. If yours misses one, that's a gap."
    chips={[
      { n: String(FRAMEWORKS.length), label: 'frameworks', href: '#framework-grid' },
      { n: String(STRATEGY_THEMES.length), label: 'recurring themes', href: '#themes' },
    ]}
    drill={[{ label: 'the themes checklist', href: '#themes' }]}
  />

  <section class="viz">
    <div class="viz-head">
      <h2 class="pe-h2">Foundational, or specialist?</h2>
      <p class="pe-prose">These frameworks are not equals. A handful are <b>foundational</b> — they should shape the strategy from page one; others are <b>specialist</b> tools to reach for when a narrow need arises. Positioned by how load-bearing each is for DfE, and split into UK-government and corporate.</p>
    </div>
    <FrameworkMap />
  </section>

  <h2 class="pe-h2" id="themes">The themes that should already exist</h2>
  <p class="pe-prose theme-intro">Strip away the labels and the same nine themes recur across every credible data strategy. Use them as a checklist: a strategy that is silent on any of them has a gap.</p>
  <div class="themes">
    {#each STRATEGY_THEMES as t}
      <div class="theme">
        <span class="t-title">{t.title}</span>
        <span class="t-blurb">{t.blurb}</span>
      </div>
    {/each}
  </div>

  <div id="framework-grid">
    <Reveal label="Show all {FRAMEWORKS.length} frameworks in full — what each covers and where it leads">
      <FrameworkGrid />
    </Reveal>
  </div>

  <NextStep
    links={[
      { label: 'The legal stack', href: '/projects/dfe-data-strategy/legislation', kind: 'primary' },
      { label: 'Draft the strategy against these themes', href: '/projects/dfe-data-strategy/author' },
    ]}
  />
</div>

<style>
  .theme-intro { max-width: 78ch; }
  .viz { margin: 8px 0 26px; }
  .viz-head { max-width: 80ch; margin-bottom: 12px; }
  .viz-head .pe-h2 { margin-bottom: 4px; }
  .themes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 8px 0 6px; }
  .theme { border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); background: rgba(255,255,255,0.4); padding: 10px 12px; }
  .t-title { display: block; font-family: 'Fraunces', serif; font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
  .t-blurb { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.66); }
  @media (max-width: 820px) { .themes { grid-template-columns: 1fr; } }
</style>
