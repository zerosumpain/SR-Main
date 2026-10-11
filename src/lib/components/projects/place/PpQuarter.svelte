<svelte:options css="injected" />

<script lang="ts">
  // One quarter of the town below the skyline: its name and number, the
  // sentence that says what lives there, and its plots. Each quarter stands
  // under the city's deep daytime blue (the home page's districts), and ends
  // on a row of dark towers and a kerb, so the next begins behind a skyline
  // rather than at a seam. The New Town, empty, says so plainly.
  import type { Snippet } from 'svelte';
  import { range, type Quarter } from '$lib/projects/place';
  import { plural, type ProjectEntry } from '$lib/projects/views';
  import PpPlot from './PpPlot.svelte';

  let {
    quarter,
    entries,
    no,
    controls,
  }: {
    quarter: Quarter;
    entries: ProjectEntry[];
    /** Its number on the fingerpost, 1-based. */
    no: number;
    controls: Snippet<[ProjectEntry]>;
  } = $props();

  let row = $derived(range(`pp-row:${quarter.id}`, 34, 18, 92));
  let num = $derived(String(no).padStart(2, '0'));
</script>

<section class="pq" id={quarter.anchor} data-q={quarter.id} aria-labelledby="{quarter.anchor}-h">
  <div class="pq-in">
    <header class="pq-head">
      <div>
        <p class="pq-k">District {num} · built {quarter.built}</p>
        <h2 id="{quarter.anchor}-h">{quarter.name}</h2>
      </div>
      <div class="pq-strap">
        <p>{quarter.strap}</p>
        <p class="pq-count">{entries.length ? plural(entries.length, 'plot') : 'no plots yet'}</p>
      </div>
    </header>

    {#if entries.length}
      <ul class="pq-plots">
        {#each entries as e, i (e.key)}
          <PpPlot {e} index={i} {controls} />
        {/each}
      </ul>
    {:else}
      <div class="pq-empty">
        <svg class="pq-lot" viewBox="0 0 240 90" aria-hidden="true" focusable="false">
          <rect class="l-ground" x="0" y="84" width="240" height="6" />
          <rect class="l-hoard" x="20" y="62" width="200" height="22" />
          <path class="l-peg" d="M120,62 V22 M40,62 V48 M200,62 V48" />
          <path class="l-flag" d="M120,22 l16,6 l-16,6 Z" />
        </svg>
        <p>
          Nothing is built here yet. What an agent builds from a prompt goes up here once it is published; until then only
          you can see the empty plot.
        </p>
      </div>
    {/if}
  </div>
  <svg class="pq-row" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d={row.d} />
  </svg>
</section>

<style>
  .pq {
    --on: 237, 228, 212;
    --top: #123a76;
    --low: #1b3b6a;
    position: relative;
    scroll-margin-top: 56px;
    padding: clamp(56px, 7vw, 96px) 0 0;
    background: linear-gradient(180deg, var(--top) 0, var(--low) 100%);
    color: rgb(var(--on));
  }
  .pq[data-q='game'] {
    --top: #143b70;
    --low: #1c3c65;
  }
  .pq[data-q='tool'] {
    --top: #1a3b6f;
    --low: #213c65;
  }
  .pq[data-q='agent'] {
    --top: #163b71;
    --low: #1d3c67;
  }
  .pq-in {
    position: relative;
    z-index: 1;
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut);
    box-sizing: border-box;
  }
  .pq-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
    align-items: end;
    gap: 16px 48px;
    margin-bottom: clamp(24px, 3vw, 36px);
  }
  .pq-k {
    margin: 0 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #f4b270;
  }
  .pq[data-q='agent'] .pq-k {
    color: #a3d2d8;
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(30px, 4vw, 52px);
    line-height: 1;
    letter-spacing: -0.03em;
  }
  .pq-strap {
    padding-left: 16px;
    border-left: 1px solid rgba(var(--on), 0.3);
  }
  .pq-strap p {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-body-lg);
    line-height: 1.4;
    color: rgba(var(--on), 0.9);
  }
  .pq-strap .pq-count {
    margin-top: 8px;
    font-family: var(--font-mono);
    font-style: normal;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(var(--on), 0.72);
  }
  .pq-plots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 272px), 1fr));
    gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pq-empty {
    display: flex;
    align-items: center;
    gap: 24px;
    max-width: 760px;
    padding: 20px;
    border: 1px dashed rgba(var(--on), 0.36);
  }
  .pq-empty p {
    margin: 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: rgba(var(--on), 0.86);
  }
  .pq-lot {
    flex: none;
    width: 160px;
    height: 60px;
  }
  .l-ground {
    fill: #8a7a62;
  }
  .l-hoard {
    fill: rgba(239, 232, 218, 0.16);
    stroke: rgba(var(--on), 0.6);
    stroke-dasharray: 4 3;
  }
  .l-peg {
    fill: none;
    stroke: rgba(var(--on), 0.7);
    stroke-width: 1.4;
  }
  .l-flag {
    fill: #f4b270;
  }
  /* The quarter ends on a skyline and a kerb. */
  .pq-row {
    display: block;
    width: 100%;
    height: clamp(56px, 7vw, 88px);
    margin-top: clamp(40px, 4.5vw, 56px);
    fill: #13294a;
    border-bottom: 10px solid #2d3947;
  }

  @media (max-width: 899px) {
    .pq-head {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 559px) {
    .pq-empty {
      flex-direction: column;
      align-items: flex-start;
    }
  }
  @media print {
    .pq {
      padding: 24px 0 0;
      background: none;
      color: #1a1008;
    }
    .pq-k,
    .pq[data-q='agent'] .pq-k,
    .pq-strap p,
    .pq-strap .pq-count,
    .pq-empty p {
      color: #1a1008;
    }
    .pq-row,
    .pq-lot {
      display: none;
    }
  }
</style>
