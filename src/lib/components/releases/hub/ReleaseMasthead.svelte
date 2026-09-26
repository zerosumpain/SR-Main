<script lang="ts">
  // A — THE RECORD. The dark opening band: the masthead, a row of figure tiles,
  // and — for the owner only — the summariser queue and the two buttons that
  // drain it.
  //
  // The tiles are computed by the caller rather than read off the payload here,
  // because the two audiences count different things: an anonymous reader is
  // shown what shipped, the owner is shown what it cost and what is still
  // waiting on the LLM.
  //
  // The ops row lives in the page body and not in `HealthShell`'s `actions`
  // snippet: with `unifiedNav` the shell renders `SiteHeader` and drops
  // `actions` entirely, so anything interactive has to be below the bar.
  import SectionHead from '$lib/components/shell/SectionHead.svelte';
  import { shortDate } from '$lib/releases/seam';
  import type { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';
  import type { Tile } from './types';

  interface Props {
    kicker: string;
    title: string[];
    strap: string;
    tiles: Tile[];
    sourceFootprint: typeof SOURCE_FOOTPRINT;
    /** Owner only. Omit and no ops row renders. */
    queue?: { pending: number; failed: number } | null;
    busy?: boolean;
    busyMsg?: string | null;
    /** Hoisted to the hub so the batch buttons and the per-release Regenerate
     *  share one in-flight flag and one error surface. */
    onSummarise?: (body: Record<string, unknown>, label: string) => void;
  }

  let {
    kicker,
    title,
    strap,
    tiles,
    sourceFootprint,
    queue = null,
    busy = false,
    busyMsg = null,
    onSummarise = () => {},
  }: Props = $props();

  const fmt = (n: number) => n.toLocaleString('en-GB');
</script>

<section class="a">
  <div class="a-inner">
    <SectionHead dark {kicker} {title} strap={strap} strapCh={44} />

    <div class="a-grid">
      {#each tiles as tile (tile.label)}
        <div class="a-tile">
          <p class="a-label">{tile.label}</p>
          <p class="a-value">{tile.value}</p>
          {#if tile.note}<p class="a-note">{tile.note}</p>{/if}
        </div>
      {/each}
    </div>

    <div class="a-footprint">
      <div class="a-footprint-head">
        <h3>{sourceFootprint.repositories.length ? 'Where the site lives' : 'SR-Main source'}</h3>
        <p>Physical lines, including comments and blank lines. Dependencies, vendored files and build output are excluded.</p>
      </div>
      <div class="a-counts" aria-label="Source line counts by type">
        <div><span>Code</span><strong>{fmt(sourceFootprint.categories.code.lines)}</strong></div>
        <div><span>Documentation</span><strong>{fmt(sourceFootprint.categories.documentation.lines)}</strong></div>
        <div><span>Tests</span><strong>{fmt(sourceFootprint.categories.tests.lines)}</strong></div>
      </div>
      {#if sourceFootprint.repositories.length}
        <p class="a-scroll-hint">Swipe across the table for each repository's tests and revision →</p>
        <div class="a-repositories" role="region" aria-label="Source lines by site repository">
          <table>
            <thead><tr><th scope="col">Repository</th><th scope="col">Code</th><th scope="col">Documentation</th><th scope="col">Tests</th><th scope="col">Revision</th></tr></thead>
            <tbody>
              {#each sourceFootprint.repositories as repository (repository.id)}
                <tr>
                  <th scope="row"><a href={repository.url} target="_blank" rel="noopener noreferrer">{repository.name}</a><small>{repository.role}</small></th>
                  <td>{fmt(repository.code.lines)}</td>
                  <td>{fmt(repository.documentation.lines)}</td>
                  <td>{fmt(repository.tests.lines)}</td>
                  <td class="a-rev">{repository.revision?.slice(0, 8) ?? 'local build'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      <p class="a-source">
        {#if sourceFootprint.repositories.length}
          {sourceFootprint.repositories.length} active site service repositories are included. SR-Main is measured from this build;
          the others are revision-pinned snapshots
          {#if sourceFootprint.snapshotAt}measured <time datetime={sourceFootprint.snapshotAt}>{shortDate(sourceFootprint.snapshotAt.slice(0, 10))}</time>{/if}.
        {:else}
          SR-Main is measured from this build.
        {/if}
        The deployment chart below currently records SR-Main releases only.
        Shared source copied into more than one repository is counted in each repository's row.
      </p>
    </div>

    {#if queue}
      <div class="a-ops">
        <p class="a-ops-state">
          {#if queue.pending > 0}
            <span class="a-flag">{queue.pending}</span> release{queue.pending === 1 ? '' : 's'} awaiting
            a summary{#if queue.failed}, <span class="a-flag bad">{queue.failed}</span> failed{/if}.
          {:else if queue.failed > 0}
            <span class="a-flag bad">{queue.failed}</span> summar{queue.failed === 1 ? 'y' : 'ies'} failed
            on the last pass.
          {:else}
            Every release in this view has been summarised.
          {/if}
        </p>
        <div class="a-ops-actions">
          {#if busyMsg}<span class="a-busy">{busyMsg}</span>{/if}
          {#if queue.pending > 0}
            <button
              type="button"
              class="a-btn"
              disabled={busy}
              onclick={() => onSummarise({ limit: 25 }, 'summarising…')}
            >
              {busy ? 'Working…' : `Summarise ${Math.min(queue.pending, 25)}`}
            </button>
          {/if}
          {#if queue.failed > 0}
            <button
              type="button"
              class="a-btn ghost"
              disabled={busy}
              onclick={() => onSummarise({ limit: 25, retryFailed: true }, 'retrying…')}
            >
              Retry {queue.failed} failed
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .a {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(30px, 3.5vw, 52px) clamp(20px, 3vw, 44px) clamp(28px, 3.5vw, 46px);
  }
  .a-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  /* Cell OUTLINES, not a 1px gap over the ground — `auto-fit` paints unfilled
     tracks and the gap trick leaves hairlines hanging in mid-air. */
  .a-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
  }
  .a-tile {
    border: 1px solid rgba(237, 228, 212, 0.16);
    padding: 12px 14px;
    min-width: 0;
  }
  .a-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 7px;
  }
  .a-value {
    font-family: var(--font-display);
    font-size: 30px;
    line-height: 0.86;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .a-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
    margin: 6px 0 0;
  }

  .a-source {
    margin: 10px 0 0;
    max-width: 110ch;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    color: var(--bg);
    opacity: 0.7;
  }

  .a-footprint { margin-top: 20px; padding-top: 17px; border-top: 1px solid rgba(237, 228, 212, 0.22); }
  .a-footprint-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px 30px; flex-wrap: wrap; }
  .a-footprint-head h3 { font: 500 var(--fs-label) var(--font-mono); letter-spacing: .14em; text-transform: uppercase; margin: 0; }
  .a-footprint-head p { color: rgba(237, 228, 212, .72); font: var(--fs-label) var(--font-body); margin: 0; }
  .a-counts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid rgba(237, 228, 212, .2); margin-top: 12px; }
  .a-counts > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; padding: 11px 14px; }
  .a-counts > div + div { border-left: 1px solid rgba(237, 228, 212, .2); }
  .a-counts span { color: rgba(237, 228, 212, .68); font: var(--fs-label-xs) var(--font-mono); text-transform: uppercase; letter-spacing: .1em; }
  .a-counts strong { font: 600 clamp(1.2rem, 2vw, 1.8rem) var(--font-code); font-variant-numeric: tabular-nums; }
  .a-repositories { overflow-x: auto; margin-top: 10px; }
  .a-scroll-hint { display: none; }
  .a-repositories:focus-visible { outline: 2px solid var(--accent-on-dark); outline-offset: 2px; }
  .a-repositories table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .a-repositories th, .a-repositories td { padding: 7px 11px; border-bottom: 1px solid rgba(237, 228, 212, .16); }
  .a-repositories thead th { color: rgba(237, 228, 212, .65); font: 500 var(--fs-label-xs) var(--font-mono); letter-spacing: .1em; text-transform: uppercase; text-align: right; white-space: nowrap; }
  .a-repositories thead th:first-child { text-align: left; }
  .a-repositories tbody th { text-align: left; font-weight: 600; min-width: 190px; }
  .a-repositories tbody th a { color: var(--bg); text-underline-offset: 3px; }
  .a-repositories tbody th a:hover { color: var(--accent-on-dark); }
  .a-repositories tbody th small { display: block; color: rgba(237, 228, 212, .55); font: var(--fs-label-xs) var(--font-body); }
  .a-repositories td { text-align: right; font: var(--fs-label) var(--font-code); white-space: nowrap; }
  .a-repositories .a-rev { color: rgba(237, 228, 212, .58); }
  @media (max-width: 680px) {
    .a-counts { grid-template-columns: 1fr; }
    .a-counts > div + div { border-left: 0; border-top: 1px solid rgba(237, 228, 212, .2); }
    .a-scroll-hint { display: block; color: rgba(237, 228, 212, .62); font: var(--fs-label-xs) var(--font-mono); margin: 10px 0 0; }
  }

  .a-ops {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
  }
  .a-ops-state {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.7);
    margin: 0;
  }
  .a-flag {
    color: var(--accent-on-dark);
    font-weight: 700;
  }
  .a-flag.bad {
    color: var(--error);
  }
  .a-ops-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .a-busy {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: rgba(237, 228, 212, 0.55);
  }

  .a-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px 16px;
    border: 1px solid var(--accent-on-dark);
    border-radius: 0;
    background: var(--accent-on-dark);
    color: var(--text-primary);
    cursor: pointer;
    transition:
      background 0.2s ease-out,
      color 0.2s ease-out;
  }
  .a-btn.ghost {
    background: transparent;
    color: var(--accent-on-dark);
  }
  .a-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: var(--bg);
    color: var(--text-primary);
  }
  .a-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
