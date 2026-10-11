<svelte:options css="injected" />

<script lang="ts">
  // One chapter of the projects essay, set as the home page sets its own: a
  // black rule, the numeral in italic and a mono label in the margin, a
  // display headline, then a line of the page's own copy as the chapter's
  // standfirst, then the entries as paragraphs. An empty chapter says so in
  // one plain sentence.
  import type { Snippet } from 'svelte';
  import type { ProjectEntry } from '$lib/projects/views';
  import SpEntry from './SpEntry.svelte';

  let {
    id,
    numeral,
    nth,
    label,
    head,
    strap,
    tone,
    entries,
    empty,
    owner,
    controls,
  }: {
    id: string;
    numeral: string;
    /** Spoken: "Chapter one". */
    nth: string;
    label: string;
    head: string;
    strap: string;
    tone: 'accent' | 'ink';
    entries: ProjectEntry[];
    empty: string;
    owner: boolean;
    controls: Snippet<[ProjectEntry]>;
  } = $props();
</script>

<section class="sc" {id} data-tone={tone} aria-labelledby="{id}-h">
  <div class="sc-rule"></div>
  <p class="sc-kick">
    <span class="sc-num" aria-hidden="true">{numeral}</span><span class="vh">Chapter {nth}, </span><span class="sc-label"
      >{label}</span
    >
  </p>
  <h2 id="{id}-h" class="sc-head">{head}</h2>
  <p class="sc-strap">{strap}</p>

  {#if entries.length}
    <div class="sc-list">
      {#each entries as e (e.key)}
        <SpEntry {e} {tone} {owner} {controls} />
      {/each}
    </div>
  {:else}
    <p class="sc-empty">{empty}</p>
  {/if}
</section>

<style>
  .sc {
    --margin: 0px;
    --tone: var(--accent-hover);
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut, 16px);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'rule' 'kick' 'head' 'strap' 'list';
    color: var(--text-primary);
    scroll-margin-top: 88px;
  }
  .sc[data-tone='ink'] {
    --tone: var(--accent-ink);
  }
  .vh {
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
  .sc-rule {
    grid-area: rule;
    height: 2px;
    background: var(--text-primary);
  }
  .sc-kick {
    grid-area: kick;
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 18px 0 0;
  }
  .sc-num {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: clamp(30px, 2.6vw, 40px);
    line-height: 1;
    color: var(--tone);
  }
  .sc-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .sc-head {
    grid-area: head;
    max-width: 16em;
    margin: 14px 0 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(30px, 3.7vw, 56px);
    line-height: 0.96;
    letter-spacing: -0.035em;
    text-transform: uppercase;
    text-wrap: balance;
  }
  .sc-strap {
    grid-area: strap;
    max-width: 30em;
    margin: clamp(14px, 1.6vw, 22px) 0 clamp(26px, 3vw, 44px);
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: clamp(19px, 1.62vw, 24px);
    line-height: 1.38;
    letter-spacing: -0.008em;
    color: var(--text-secondary);
    text-wrap: pretty;
  }
  .sc-list {
    grid-area: list;
    /* The entries keep the chapter's columns. */
    display: grid;
  }
  .sc-empty {
    grid-area: list;
    margin: 0;
    padding-top: 24px;
    border-top: 1px solid var(--line-strong);
    font-family: var(--fs-serif);
    font-size: clamp(17px, 1.32vw, 20px);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  @media (min-width: 900px) {
    .sc {
      --margin: clamp(176px, 15vw, 224px);
      grid-template-columns: var(--margin) minmax(0, 1fr);
      grid-template-areas: 'rule rule' 'kick head' '. strap' 'list list';
      column-gap: 32px;
    }
    .sc-kick {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      margin-top: 20px;
    }
    .sc-head {
      margin-top: 22px;
    }
    .sc-empty {
      margin-left: calc(var(--margin) + 32px);
    }
  }

  @media print {
    .sc {
      color: #1a1008;
    }
    .sc-rule {
      background: none;
      border-top: 2px solid #1a1008;
    }
    .sc-num,
    .sc-strap,
    .sc-empty {
      color: #1a1008;
    }
  }
</style>
