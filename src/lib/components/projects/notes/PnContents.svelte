<svelte:options css="injected" />

<script lang="ts">
  // The contents page (NotesProjects): every project on one rule each, the
  // blog index's idiom. The number in the margin against the red rule, the
  // project's short name, a dotted leader out to its kind beside its pencil
  // dot. Each name points at its card further down the sheet. Hand-built
  // first, then the agent's, under a pencilled heading of their own.
  import type { ProjectEntry } from '$lib/projects/views';
  import { cardId, shortTitle } from '$lib/projects/notes';
  import PnDot from './PnDot.svelte';

  let { hand, agent }: { hand: ProjectEntry[]; agent: ProjectEntry[] } = $props();
</script>

{#snippet row(e: ProjectEntry)}
  <li class="ct-row" class:private={!e.isPublic}>
    <span class="ct-n" aria-hidden="true">{e.n}</span>
    <span class="ct-line">
      <a class="ct-t" href="#{cardId(e.key)}">{shortTitle(e.title)}</a>{#if !e.isPublic}<span class="ct-p">private</span>{/if}
      <span class="ct-lead" aria-hidden="true"></span>
      <span class="ct-k"><PnDot family={e.family} seed={e.n} /><span class="vh">, </span>{e.kind}</span>
    </span>
  </li>
{/snippet}

<nav class="ct" aria-labelledby="pn-contents-l">
  <p class="ct-l" id="pn-contents-l">Contents</p>
  <ol class="ct-list" role="list">
    {#each hand as e (e.key)}{@render row(e)}{/each}
  </ol>
  {#if agent.length}
    <p class="ct-l ct-sub">By an agent</p>
    <ol class="ct-list" role="list" start={agent[0].n}>
      {#each agent as e (e.key)}{@render row(e)}{/each}
    </ol>
  {/if}
</nav>

<style>
  .ct {
    grid-column: 1 / -1;
  }
  /* A label over a group, on its own rule in the body column. */
  .ct-l {
    margin: 0 0 0 calc(var(--mg) + var(--pad));
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .ct-sub {
    margin-top: 32px;
  }
  .ct-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ct-row {
    display: grid;
    grid-template-columns: var(--mg) var(--pad) minmax(0, 1fr);
    align-items: baseline;
    min-height: 32px;
  }
  /* The number, in the margin against the red rule, where a kicker goes. */
  .ct-n {
    grid-column: 1;
    padding-right: 22px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 17px;
    line-height: 32px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--accent-hover);
  }
  .ct-row.private .ct-n {
    color: var(--text-muted);
  }
  .ct-line {
    grid-column: 3;
    display: flex;
    align-items: baseline;
    min-width: 0;
    max-width: 50rem;
    line-height: 32px;
  }
  .ct-t {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 19px;
    letter-spacing: -0.015em;
    color: var(--text-primary);
    text-decoration: none;
  }
  .ct-t:hover,
  .ct-t:focus-visible {
    color: var(--accent-ink);
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-decoration-color: var(--accent);
    text-underline-offset: 0.18em;
  }
  .ct-t:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 3px;
    border-radius: 2px;
  }
  .ct-p {
    flex: none;
    margin-left: 10px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 15px;
    color: var(--text-muted);
  }
  /* A contents page's dotted leader, from the name out to the kind. */
  .ct-lead {
    flex: 1 1 24px;
    min-width: 24px;
    height: 4px;
    margin: 0 12px;
    background: radial-gradient(circle, var(--text-muted) 0 1px, transparent 1.5px) 0 0 / 9px 4px repeat-x;
    opacity: 0.75;
  }
  .ct-k {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .vh {
    position: absolute !important;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* A phone: the kind goes on its own rule under the name, no leader. */
  @media (max-width: 760px) {
    .ct-n {
      padding-right: 6px;
      font-size: 14px;
    }
    /* Two rules: the name, then the kind with any "private" after it. */
    .ct-line {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas: 'name name' 'kind note';
      align-items: baseline;
    }
    .ct-t {
      grid-area: name;
    }
    .ct-lead {
      display: none;
    }
    .ct-k {
      grid-area: kind;
    }
    .ct-p {
      grid-area: note;
    }
  }

  @media print {
    .ct-l,
    .ct-n,
    .ct-t,
    .ct-k {
      color: #1a1008;
    }
    .ct-lead {
      background: none;
    }
  }
</style>
