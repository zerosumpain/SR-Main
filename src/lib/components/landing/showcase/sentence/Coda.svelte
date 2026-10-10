<svelte:options css="injected" />

<script lang="ts">
  // The essay's last word: the rest of what the site does, in a couple of
  // sentences whose value words are links rather than footnotes, as an index
  // at the back of a feature would be. Set as a fifth chapter (rule, numeral,
  // headline at chapter scale), with the same rope lane at the right.
  import { scenery } from '$lib/landing/ramblers/scenery';
  import type { Seg } from '$lib/landing/showcase-sentence';
  import Prose from './Prose.svelte';

  let { segs }: { segs: Seg[] } = $props();
</script>

<section class="ss-coda" aria-labelledby="ss-rest-h">
  <div class="ss-rule" use:scenery></div>
  <p class="ss-kick">
    <span class="ss-num" aria-hidden="true">v.</span><span class="ss-vh">Chapter five, </span><span class="ss-label">Everything else</span>
  </p>
  <h2 id="ss-rest-h" class="ss-head">And the rest</h2>
  <p class="ss-prose"><Prose {segs} open={null} ontoggle={() => {}} /></p>
</section>

<style>
  .ss-coda {
    --lane: 40px;
    --t-accent: var(--accent-hover);
    --t-ink: var(--accent-ink);
    --fg: var(--text-primary);
    --fg3: var(--text-muted);
    --prose: clamp(21px, 2.05vw, 30px);
    --prose-lh: 1.36;
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut, 16px);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'rule' 'kick' 'head' 'prose';
    color: var(--fg);
  }
  .ss-vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .ss-rule {
    grid-area: rule;
    height: 2px;
    background: var(--fg);
  }
  .ss-kick {
    grid-area: kick;
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 18px var(--lane) 0 0;
  }
  .ss-num {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: clamp(30px, 2.6vw, 40px);
    line-height: 1;
    color: var(--accent-hover);
  }
  .ss-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .ss-head {
    grid-area: head;
    margin: 14px var(--lane) 0 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(30px, 3.7vw, 56px);
    line-height: 0.96;
    letter-spacing: -0.035em;
    text-transform: uppercase;
    text-wrap: balance;
    color: var(--fg);
  }
  .ss-prose {
    grid-area: prose;
    max-width: min(30em, 100% - var(--lane));
    margin: clamp(18px, 2.2vw, 30px) 0 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-size: var(--prose);
    line-height: var(--prose-lh);
    letter-spacing: -0.012em;
    text-wrap: pretty;
  }
  @media (min-width: 900px) {
    .ss-coda {
      grid-template-columns: clamp(176px, 15vw, 224px) minmax(0, 1fr);
      grid-template-areas: 'rule rule' 'kick head' '. prose';
      column-gap: 32px;
    }
    .ss-kick {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      margin: 20px 0 0;
    }
    .ss-head {
      margin-top: 22px;
    }
  }
  @media print {
    .ss-coda {
      color: #1a1008;
    }
    .ss-rule {
      background: none;
      border-top: 2px solid #1a1008;
    }
    .ss-num,
    .ss-head {
      color: #1a1008;
    }
  }
</style>
