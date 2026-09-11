<script lang="ts">
  // The masthead every workspace opens with.
  //
  // The same three-part head the health hub uses (`hub/SectionHead.svelte`): a
  // mono kicker, an Archivo Black headline, and one paragraph of standfirst
  // pushed to the right edge. Adopting it rather than importing it because this
  // one carries a fourth part the health version has no use for — a `figures`
  // row, which is what makes a section head read as a dashboard panel rather
  // than as a chapter opening.
  //
  // The headline is an ARRAY OF LINES for the reason SectionHead gives: where a
  // two-word display headline folds is a typographic decision, and passing
  // markup through a prop to preserve it would mean `{@html}` on copy.
  import type { Snippet } from 'svelte';

  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    kicker: string;
    title: string[];
    strap?: string | null;
    /** Small mono figures under the head — counts, never prose. */
    figures?: { label: string; value: string | number; term?: string }[];
    /** Controls that belong to this workspace: filters, a measure switch. */
    controls?: Snippet;
  }

  let { kicker, title, strap = null, figures = [], controls }: Props = $props();
</script>

<div class="dh">
  <div class="dh-top">
    <div class="dh-left">
      <p class="dh-kicker">{kicker}</p>
      <h2 class="dh-title">{#each title as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}</h2>
    </div>
    {#if strap}<p class="dh-strap">{strap}</p>{/if}
  </div>

  {#if figures.length}
    <div class="dh-figures">
      {#each figures as figure (figure.label)}
        <div class="dh-figure">
          <p class="dh-figure-value">{figure.value}</p>
          <!-- The explainer hangs off the LABEL, which is a button, so a keyboard
               reader reaches it. On a wrapping div it was pointer-only. -->
          {#if figure.term}
            <p class="dh-figure-label"><ExplainLabel term={figure.term} text={figure.label} /></p>
          {:else}
            <p class="dh-figure-label">{figure.label}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if controls}<div class="dh-controls">{@render controls()}</div>{/if}
</div>

<style>
  .dh {
    border-top: 2px solid var(--text-primary);
    padding-top: clamp(18px, 2vw, 26px);
    margin-top: clamp(28px, 3.5vw, 48px);
  }
  .dh-top {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 28px;
    flex-wrap: wrap;
  }
  .dh-left {
    min-width: 0;
  }
  .dh-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 12px;
  }
  .dh-title {
    font-family: var(--font-display);
    font-size: clamp(26px, 3.4vw, 42px);
    line-height: 0.95;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0;
  }
  .dh-strap {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    max-width: 42ch;
    margin: 0 0 3px;
  }

  .dh-figures {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
    margin-top: clamp(18px, 2vw, 26px);
  }
  .dh-figure {
    background: var(--bg);
    padding: 11px 13px;
    min-width: 0;
  }
  .dh-figure-value {
    font-family: var(--font-display);
    font-size: var(--fs-num-md);
    line-height: 1;
    letter-spacing: -0.02em;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .dh-figure-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 6px 0 0;
  }

  .dh-controls {
    margin-top: clamp(16px, 2vw, 22px);
  }

  @media (max-width: 720px) {
    .dh-top {
      align-items: flex-start;
      flex-direction: column;
      gap: 14px;
    }
    .dh-strap {
      max-width: none;
    }
  }

  @media print {
    .dh-controls {
      display: none !important;
    }
    .dh {
      border-top: 1px solid #000;
    }
  }
</style>
