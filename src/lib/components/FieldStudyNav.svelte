<script lang="ts">
  /**
   * The field-study answer to the site's top-left cell: a home icon, then the
   * one way back.
   *
   * The seven study layouts cannot wear `SiteHeader` — it is written for the
   * INK band (`background: var(--text-primary)`), and these pages are PAPER: a
   * cream ground, a Fraunces masthead, a grain overlay. Dropping a 48px ink
   * strip on top of one would read as a foreign object bolted above the
   * masthead. So this is the same two cells in the field-study register —
   * mono, uppercase, `--fs-label-xs`, on paper tokens — which is exactly the
   * styling the studies' own `.back` link already used.
   *
   * WHERE IT MOUNTS MATTERS. Five of the seven layouts measure their own
   * masthead at runtime (`bind:clientHeight={topH}` → `--topH`) and a dozen
   * downstream rules offset against it: every SectionNav's `top`, the
   * policy-engine levers sidebar's height, data-spine/trace's
   * `scroll-margin-top`, and FederationSim's `100svh - var(--topH)`. A row
   * added ABOVE the measured element is invisible to that measurement and
   * every one of those silently under-offsets. So this always goes INSIDE the
   * measured element, above the masthead — never before it.
   *
   * `inline` is for a layout with no measured element but hard-coded sticky
   * offsets beneath it (data-standard-designer's rails sit at `top: 110px`).
   * There, an extra row would push the header down under them, so the cells
   * join the existing masthead row instead and the header's height is
   * unchanged.
   */
  import { currentPath } from '$lib/nav/page-path';
  import { parentHref, parentLabel } from '$lib/nav/site-nav';

  let {
    study,
    inline = false,
  }: {
    /** Optional trailing name. Every shipped study already prints its own name
     *  in the masthead directly beneath, so this is normally left off. */
    study?: string;
    /** Join an existing masthead row instead of forming a row of your own. */
    inline?: boolean;
  } = $props();

  const path = $derived(currentPath());
  const backHref = $derived(parentHref(path));
  const backLabel = $derived(backHref ? parentLabel(path) : null);
</script>

<div class="fsn" class:inline>
  <a class="fsn-home" href="/" aria-label="Home" title="Home">
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M2 7.2 8 2.2l6 5M3.4 6v7.3h9.2V6"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="square"
        stroke-linejoin="miter"
      />
    </svg>
  </a>

  {#if backHref}
    <a class="fsn-back" href={backHref} title="Back to {backLabel}">
      <span class="fsn-arrow" aria-hidden="true">←</span><span class="fsn-word">{backLabel}</span>
    </a>
  {/if}

  {#if study}
    <span class="fsn-study">{study}</span>
  {/if}
</div>

<style>
  /* Paper, not ink: `--line-hair` is a cream-ground hairline and the text
     tokens resolve against the study's own background. Nothing in here may
     use the cream-alpha values SiteHeader needs. */
  .fsn {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 28px 5px;
    border-bottom: 1px solid var(--line-hair);
  }

  .fsn-home,
  .fsn-back {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
    text-decoration: none;
    transition: color var(--t-fast) var(--ease-out);
  }
  .fsn-home:hover,
  .fsn-back:hover {
    color: var(--text-primary);
  }

  .fsn-home svg {
    display: block;
  }

  /* The register the studies already speak: the masthead's own `.back`. */
  .fsn-back,
  .fsn-study {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .fsn-arrow {
    margin-right: 6px;
  }

  .fsn-study {
    margin-left: auto;
    color: var(--text-ghost);
    letter-spacing: 0.16em;
  }

  /* Joining a masthead row: the row owns the padding and the rule. */
  .fsn.inline {
    padding: 0;
    border-bottom: none;
    gap: 12px;
  }
  .fsn.inline .fsn-study {
    margin-left: 0;
  }

  @media (max-width: 760px) {
    .fsn {
      padding: 6px 14px 5px;
      gap: 11px;
    }
    .fsn.inline {
      padding: 0;
    }
  }
</style>
