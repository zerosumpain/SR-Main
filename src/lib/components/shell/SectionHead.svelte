<script lang="ts">
  // The masthead every section on the health hub opens with: a lettered mono
  // kicker, a two-line Archivo Black headline, and one paragraph of standfirst
  // pushed to the right edge.
  //
  // The headline arrives as an ARRAY OF LINES rather than a string with a
  // `<br>` in it. The break is a typographic decision — where "EIGHT ANALYTICS
  // / ALREADY RUNNING" folds is part of the design — and passing markup through
  // a prop to preserve it would mean `{@html}` on copy for no reason at all.
  interface Props {
    /** `C / FORECAST · 90 DAYS` — the letter is part of the copy. */
    kicker: string;
    /** One entry per rendered line. */
    title: string[];
    strap?: string | null;
    /** On the `#1a1008` bands the kicker goes accent and the strap goes cream. */
    dark?: boolean;
    /** Measure of the standfirst. The deck runs 44ch, everything else 40ch. */
    strapCh?: number;
  }

  let { kicker, title, strap = null, dark = false, strapCh = 40 }: Props = $props();
</script>

<div class="hd" class:dark>
  <div class="hd-left">
    <p class="hd-kicker">{kicker}</p>
    <h2 class="hd-title">
      {#each title as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
    </h2>
  </div>
  {#if strap}
    <p class="hd-strap" style="max-width: {strapCh}ch">{strap}</p>
  {/if}
</div>

<style>
  .hd {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 28px;
    flex-wrap: wrap;
    margin-bottom: clamp(28px, 3.5vw, 44px);
  }
  .hd-left {
    min-width: 0;
  }

  .hd-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0 0 14px;
  }
  .hd.dark .hd-kicker {
    color: var(--accent-on-dark);
  }

  .hd-title {
    font-family: var(--font-display);
    font-size: clamp(28px, 3.6vw, 46px);
    line-height: 0.94;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0;
  }

  .hd-strap {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }
  .hd.dark .hd-strap {
    color: rgba(237, 228, 212, 0.7);
  }
</style>
