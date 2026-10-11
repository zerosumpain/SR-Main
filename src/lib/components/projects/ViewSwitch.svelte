<script lang="ts">
  // "read it as: sentence · place · notes" for /projects, the landing hero's
  // switch in the same words and type. The view decides where it sits and
  // what colour it is, through three inherited custom properties:
  // --pvs-dim (the label and the dots), --pvs-ink (the words), --pvs-on (the
  // chosen word). The defaults are the landing's on-ink colours.
  import { HERO_VIEWS } from '$lib/landing/hero-view';
  import type { ProjectsView } from './projects-view.svelte';

  let { page }: { page: ProjectsView } = $props();

  // Read only through the switch's aria-describedby.
  let how = $derived(
    page.source === 'cookie'
      ? `Kept as you chose it, here and on the home page. Choose ${page.auto} to go back to the default.`
      : page.source === 'query'
        ? 'Set by the link you followed, for this visit only.'
        : 'The notes are the default. Choose another to keep it, here and on the home page.',
  );
</script>

<div
  class="pvs"
  role="group"
  aria-label="Read the projects as"
  aria-describedby="pvs-how"
  onpointerenter={page.warm}
  onfocusin={page.warm}
  ontouchstart={page.warm}
>
  <span class="pvs-k" aria-hidden="true">read it as:</span>
  {#each HERO_VIEWS as k, i (k)}
    {#if i}<span class="pvs-dot" aria-hidden="true">·</span>{/if}
    <button type="button" class="pvs-b" aria-pressed={page.view === k} onclick={() => page.pick(k)}>{k}</button>
  {/each}
  <span id="pvs-how" hidden>{how}</span>
</div>

<style>
  .pvs {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .pvs-k {
    margin-right: 6px;
    color: var(--pvs-dim, var(--on-ink-55));
  }
  .pvs-dot {
    padding: 0 4px;
    color: var(--pvs-dim, var(--on-ink-55));
  }
  .pvs-b {
    position: relative;
    min-width: 44px;
    margin: 0;
    padding: 2px 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--pvs-ink, var(--on-ink-80));
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  /* A finger-sized target without spacing the words apart. */
  .pvs-b::after {
    content: '';
    position: absolute;
    inset: -10px -4px;
  }
  .pvs-b:hover {
    color: var(--pvs-on, var(--accent-on-dark));
  }
  /* Pressed reads by colour and by its underline, never by colour alone. */
  .pvs-b[aria-pressed='true'] {
    color: var(--pvs-on, var(--accent-on-dark));
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
  }
  .pvs-b:focus-visible {
    outline: 2px solid var(--pvs-on, var(--accent-on-dark));
    outline-offset: 4px;
    border-radius: 2px;
  }
  @media (max-width: 760px) {
    .pvs-b {
      min-height: 44px;
    }
    .pvs-b::after {
      inset: 0 -4px;
    }
  }
  @media print {
    .pvs {
      display: none;
    }
  }
</style>
