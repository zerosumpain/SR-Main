<script lang="ts">
  /**
   * What kinds of material this run actually found, and which kinds fed it.
   *
   * Encoding, in the order the dataviz procedure asks:
   *
   *  - **Form:** magnitude across a handful of named categories with long
   *    labels → horizontal bars, sorted descending. Not a pie: the question is
   *    "how many, and did they contribute", which is a comparison of lengths.
   *  - **Colour:** ONE series drawn in one hue. The categories are identity,
   *    but the thing encoded is a single measure — a count — so inventing a
   *    hue per media kind would be colour without a job, and the site's palette
   *    is cream/ink/burnt-orange with nowhere to take eight hues from.
   *    Contribution is carried by opacity within that one hue, which is a
   *    sequential step, plus a stated number on every row.
   *  - **Relief:** the pale segment sits under 3:1 against the surface, so it
   *    NEVER carries meaning alone — every row states "N sources · M produced
   *    facts" in text, and the legend names both steps.
   *
   * Clicking a row filters the source list, which is the point of drawing it:
   * "twelve profiles produced nothing" is only useful if you can then go and
   * look at the twelve.
   */
  import type { MediaKind } from '$lib/deepdive/media-type';

  interface MixRow {
    kind: MediaKind;
    label: string;
    count: number;
    facts: number;
  }

  let {
    mix = [],
    contributors = {},
    selected = null,
    onSelect,
  }: {
    mix: MixRow[];
    /** Per kind, how many of its sources produced at least one fact. */
    contributors?: Record<string, number>;
    selected?: string | null;
    onSelect?: (kind: string | null) => void;
  } = $props();

  const max = $derived(Math.max(1, ...mix.map((m) => m.count)));
  const totalSources = $derived(mix.reduce((n, m) => n + m.count, 0));

  function pct(n: number): number {
    return (n / max) * 100;
  }
</script>

{#if mix.length > 0}
  <section class="nm-sec" id="source-mix">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">What kind of material</span>
      <span class="nm-sec-meta">{totalSources} sources across {mix.length} kinds</span>
    </div>

    <div class="legend">
      <span class="key"><span class="sw solid"></span>produced facts</span>
      <span class="key"><span class="sw pale"></span>gathered only</span>
    </div>

    <ul class="rows">
      {#each mix as m (m.kind)}
        {@const contributed = contributors[m.kind] ?? 0}
        <li>
          <button
            type="button"
            class="row"
            class:on={selected === m.kind}
            aria-pressed={selected === m.kind}
            onclick={() => onSelect?.(selected === m.kind ? null : m.kind)}
          >
            <span class="name">{m.label}</span>
            <span class="track">
              <!-- Two segments of one hue with a 2px surface gap between them. -->
              {#if contributed > 0}
                <span class="seg solid" style:width="{pct(contributed)}%"></span>
              {/if}
              {#if m.count - contributed > 0}
                <span
                  class="seg pale"
                  style:width="{pct(m.count - contributed)}%"
                  style:margin-left={contributed > 0 ? '2px' : '0'}
                ></span>
              {/if}
            </span>
            <span class="val">
              <b>{m.count}</b>
              <span class="sub">{contributed > 0 ? `${contributed} with facts` : 'none used'}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="hint">Click a kind to filter the source list</p>
  </section>
{/if}

<style>
  /* .nm-sec, .nm-sec-hd, .sr-label-tight, .nm-sec-meta: $lib/styles/nm-tokens.css */
  .legend { display: flex; gap: 0.9rem; margin-bottom: 0.6rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .key { display: inline-flex; align-items: center; gap: 5px; }
  .sw { width: 14px; height: 8px; border-radius: 2px; background: var(--accent); }
  .sw.solid { opacity: 0.85; }
  .sw.pale { opacity: 0.24; }

  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 92px 1fr 96px;
    gap: 0.6rem;
    align-items: center;
    background: none;
    border: 1px solid transparent;
    padding: 3px 4px;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .row:hover { border-color: var(--line-strong); }
  .row.on { border-color: var(--accent); background: var(--accent-tint-14); }

  .name { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; color: var(--text-secondary); }
  .track { display: flex; align-items: center; height: 12px; }
  .seg { height: 10px; border-radius: 2px; background: var(--accent); min-width: 2px; }
  .seg.solid { opacity: 0.85; }
  .seg.pale { opacity: 0.24; }

  .val { display: flex; align-items: baseline; gap: 5px; justify-content: flex-end; }
  /* Text wears text tokens, never the series colour. */
  .val b { font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-primary); font-weight: 500; }
  .sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); white-space: nowrap; }

  .hint { margin: 0.5rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  @media (max-width: 620px) {
    .row { grid-template-columns: 76px 1fr; }
    .val { grid-column: 2; justify-content: flex-start; }
  }
</style>
