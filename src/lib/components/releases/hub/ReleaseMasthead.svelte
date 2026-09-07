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
  import SectionHead from '$lib/components/health/hub/SectionHead.svelte';
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

    <p class="a-source">
      Current source counts the non-blank lines supporting the site and its features, including comments.
      Excludes tests, dependencies, vendored code and generated output. Recounted every build;
      measured <time datetime={sourceFootprint.measuredAt}>{shortDate(sourceFootprint.measuredAt.slice(0, 10))}</time>.
    </p>

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
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px) clamp(40px, 5vw, 68px);
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
    gap: 14px;
  }
  .a-tile {
    border: 1px solid rgba(237, 228, 212, 0.16);
    padding: 18px 20px;
    min-width: 0;
  }
  .a-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 12px;
  }
  .a-value {
    font-family: var(--font-display);
    font-size: 34px;
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
    margin: 10px 0 0;
  }

  .a-source {
    margin: 18px 0 0;
    max-width: 90ch;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    color: var(--bg);
    opacity: 0.7;
  }

  .a-ops {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    margin-top: 22px;
    padding-top: 20px;
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
