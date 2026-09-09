<script lang="ts">
  // A — THE VERDICT. What a reader with ninety seconds takes away: one sentence
  // of judgement, four counts they can act on, and a single bar showing how the
  // exploitation playbook is distributed across the four exposure bands.
  //
  // The bar is one hue stepped light to dark, because exposure is a magnitude
  // rather than four categories, and every segment carries its band in words —
  // colour is never the only thing saying "severe".
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { BAND_FILL, BAND_LABEL, type Band } from '$lib/policy-analysis/view';

  interface Props {
    headline: Artefact | null;
    tiles: { key: string; figure: number; sub: string; label: string }[];
    bands: { band: Band; note: string; count: number }[];
    status: string;
    /** Opens the inspector on an artefact. */
    inspect: (id: string) => void;
    onband?: (band: Band) => void;
  }

  let { headline, tiles, bands, status, inspect, onband }: Props = $props();
  const total = $derived(bands.reduce((sum, b) => sum + b.count, 0));
</script>

<section class="verdict" aria-label="Verdict">
  <p class="kicker">A / The verdict</p>
  {#if headline}
    <h2 class="lede">{headline.statement}</h2>
    <button class="trace" onclick={() => inspect(headline.id)}>Trace this conclusion to its evidence →</button>
  {:else}
    <h2 class="lede pending">The assessment has not reached its conclusion yet.</h2>
    <p class="muted">Stages are saved as they finish. What is below is what has been established so far — read it as partial. Status: {status.replaceAll('_', ' ')}.</p>
  {/if}

  <div class="tiles">
    {#each tiles as tile (tile.key)}
      <div class="tile">
        <p class="figure">{tile.figure}</p>
        <p class="tile-label">{tile.label}</p>
        <p class="muted">{tile.sub}</p>
      </div>
    {/each}
  </div>

  {#if total}
    <div class="band-block">
      <p class="sr-label">How the {total} plays rank</p>
      <div class="band-bar" role="img" aria-label={bands.filter((b) => b.count).map((b) => `${b.count} ${BAND_LABEL[b.band]}`).join(', ')}>
        {#each bands.filter((b) => b.count) as b (b.band)}
          <button
            class="band-seg"
            style="flex-grow: {b.count}; background: {BAND_FILL[b.band]}"
            title={b.note}
            onclick={() => onband?.(b.band)}
          ><span class="band-count" class:on-dark={b.band === 'severe'}>{b.count}</span></button>
        {/each}
      </div>
      <ul class="band-key">
        {#each bands as b (b.band)}
          <li class:none={!b.count}>
            <span class="swatch" style="background: {BAND_FILL[b.band]}"></span>
            <strong>{BAND_LABEL[b.band]}</strong>
            <span class="muted">{b.count} · {b.note}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .verdict { border-top: 2px solid var(--text-primary); padding-top: 1.5rem; margin-top: 1.5rem; }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent); margin: 0 0 .75rem; }
  .lede { font-family: var(--font-display); font-size: clamp(1.35rem, 2.9vw, 2.15rem); line-height: 1.18; margin: 0 0 .9rem; max-width: 30ch; }
  .lede.pending { color: var(--text-secondary); }
  .trace { font: inherit; font-size: var(--fs-label); font-family: var(--font-mono); background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 1px; background: var(--line-strong); border: 1px solid var(--line-strong); margin: 1.75rem 0 0; }
  .tile { background: var(--bg); padding: 1rem 1.1rem; min-width: 0; }
  .figure { font-family: var(--font-display); font-size: clamp(1.9rem, 4vw, 2.7rem); line-height: 1; margin: 0; }
  .tile-label { font-weight: 700; margin: .35rem 0 .15rem; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); margin: 0; }
  .sr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .5rem; }
  .band-block { margin-top: 1.75rem; }
  .band-bar { display: flex; gap: 2px; height: 2.4rem; }
  .band-seg { border: 0; padding: 0; cursor: pointer; min-width: 2.2rem; display: grid; place-items: center; }
  .band-count { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
  .band-count.on-dark { color: var(--bg); }
  .band-key { list-style: none; padding: 0; margin: .75rem 0 0; display: grid; gap: .4rem; }
  .band-key li { display: flex; gap: .55rem; align-items: baseline; flex-wrap: wrap; font-size: var(--fs-label); }
  .band-key li.none { opacity: .45; }
  .swatch { width: .8rem; height: .8rem; border: 1px solid var(--line-strong); flex: none; align-self: center; }
</style>
