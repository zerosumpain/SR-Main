<svelte:options css="injected" />

<script lang="ts">
  // /projects read as a sentence, the way the home page reads its numbers.
  //
  //   ink    the masthead and the switch, a line that beats once per project,
  //          then the whole bench in one serif sentence: each count coloured,
  //          footnoted and linked to its entries, the footnotes naming every
  //          one (SpBand)
  //   paper  an italic line carrying the sentence down into the essay, then
  //          i.  Built by hand: the field studies, games and tools
  //          ii. Written by an agent (only when there is one, or the owner is
  //              looking; empty, it says so)
  //          each entry a paragraph with its number and kind in the margin
  //          (SpChapter, SpEntry)
  //
  // Pure props to markup: nothing is fetched and nothing moves but the line
  // drawing itself in once.
  import type { ProjectsViewProps } from '$lib/projects/views';
  import { bridgeLine, handHeading } from '$lib/projects/sentence';
  import SpBand from './SpBand.svelte';
  import SpChapter from './SpChapter.svelte';

  let { hand, agent, showAgent, counts, owner, dateline, controls, switcher }: ProjectsViewProps = $props();

  let chapters = $derived(showAgent ? 2 : 1);
</script>

<div class="sp">
  <SpBand {hand} {agent} {counts} {owner} {dateline} {switcher} />

  <div class="sp-paper">
    <div class="sp-bridge">
      <p>{bridgeLine(counts.bench, chapters)}</p>
    </div>

    <SpChapter
      id="sp-hand"
      numeral="i."
      nth="one"
      label="Built by hand"
      head={handHeading(hand)}
      strap="Long-form arguments you can operate rather than read, and a few tools that had a job to do."
      tone="accent"
      entries={hand}
      empty="Nothing published yet."
      {owner}
      {controls}
    />

    {#if showAgent}
      <div class="sp-gap"></div>
      <SpChapter
        id="sp-agent"
        numeral="ii."
        nth="two"
        label="Built autonomously"
        head="Written by an agent"
        strap="One prompt in, a working page out. The iteration count is how many passes it took."
        tone="ink"
        entries={agent}
        empty="Nothing here yet. When an agent builds something from a single prompt and I keep it, it goes in this chapter."
        {owner}
        {controls}
      />
    {/if}
  </div>
</div>

<style>
  .sp {
    --gut: clamp(16px, 4vw, 64px);
  }
  .sp-paper {
    padding: clamp(56px, 6.5vw, 96px) 0 clamp(48px, 6vw, 88px);
    background: var(--bg);
    color: var(--text-primary);
  }
  /* The sentence carries on, in its own italic, before chapter one opens. */
  .sp-bridge {
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut) clamp(48px, 5.5vw, 80px);
    box-sizing: border-box;
  }
  .sp-bridge p {
    max-width: 30em;
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: clamp(21px, 2.05vw, 30px);
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: var(--text-secondary);
    text-wrap: pretty;
  }
  .sp-gap {
    height: clamp(56px, 6vw, 96px);
  }
  @media (min-width: 900px) {
    .sp-bridge p {
      margin-left: calc(clamp(176px, 15vw, 224px) + 32px);
    }
  }
  @media print {
    .sp-paper {
      background: none;
      padding-top: 24px;
    }
    .sp-bridge p {
      color: #1a1008;
    }
  }
</style>
