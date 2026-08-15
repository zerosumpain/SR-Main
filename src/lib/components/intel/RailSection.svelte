<script lang="ts">
  // One labelled, collapsible block in the explorer's control rail.
  //
  // The rail was a single column of nine unlabelled control groups separated
  // only by hairlines: a keyword box, a source picker, a Gmail sweep button, a
  // sweep log, a pin list, a type select, a cluster list, two sliders and a path
  // finder, all equally prominent and all always open. Nothing said which of
  // them changed WHICH graph you were looking at versus how it was drawn, and
  // the column was long enough to need its own scrollbar on every screen.
  //
  // A heading and a fold fixes both. What you are not using takes one line.

  import type { Snippet } from 'svelte';

  let {
    title,
    /** Right-hand summary — how many of this section's controls are active. */
    badge = null,
    /** Open on first render. Sections that answer "what am I looking at" are;
     *  sections that answer "how did it get here" are not. */
    open = $bindable(true),
    children,
  }: {
    title: string;
    badge?: string | number | null;
    open?: boolean;
    children: Snippet;
  } = $props();

  const id = `rail-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
</script>

<section class="sec" class:open>
  <button
    type="button"
    class="head"
    aria-expanded={open}
    aria-controls={id}
    onclick={() => (open = !open)}
  >
    <span class="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
    <span class="title">{title}</span>
    {#if badge !== null && badge !== '' && badge !== 0}
      <span class="badge">{badge}</span>
    {/if}
  </button>

  {#if open}
    <div class="body" {id}>
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .sec {
    border-bottom: 1px solid var(--line-hair);
  }
  .sec:last-child {
    border-bottom: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 9px 2px;
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    cursor: pointer;
    text-align: left;
  }
  .head:hover {
    color: var(--accent);
  }
  .sec.open .head {
    color: var(--text-secondary);
  }

  .chev {
    flex: none;
    width: 9px;
    color: var(--text-ghost);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  /* An active count on a CLOSED section is the whole point of the badge: it is
     how a folded filter still announces that it is doing something. */
  .badge {
    flex: none;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-tint-08);
    color: var(--accent);
    letter-spacing: 0.04em;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 2px 12px;
  }
</style>
