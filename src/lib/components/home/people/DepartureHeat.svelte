<script lang="ts">
  /**
   * When the house empties: departures from home by weekday and hour, from
   * the learned trips (people leaving together count once). One hue, light to
   * dark; the count is printed in every non-empty cell, so the reading never
   * rests on colour alone. Hours 06–22 only — nobody leaves at 03:00 often
   * enough to earn the width.
   */
  import { hhmm } from './format';

  let { grid }: { grid: number[][] } = $props();
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);
  const peak = $derived(Math.max(1, ...grid.flatMap((r) => HOURS.map((h) => r[h] ?? 0))));
  const total = $derived(grid.flat().reduce((a, b) => a + b, 0));
  const shade = (v: number) => (v ? 18 + Math.round((v / peak) * 72) : 0);
  /** Ink on light cells, paper on dark ones — by the step, measured once: 55% is where cream clears 4.5:1. */
  const dark = (v: number) => shade(v) >= 55;
</script>

{#if !total}
  <p class="dh-empty">No departures from home in this window yet.</p>
{:else}
  <div class="dh-wrap">
    <table class="dh">
      <caption>Departures from home by weekday and hour, {total} in this window.</caption>
      <thead>
        <tr><th scope="col"><span class="sr">Day</span></th>{#each HOURS as h (h)}<th scope="col">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}<span class="sr">{h % 3 === 0 ? '' : hhmm(h * 60)}</span></th>{/each}</tr>
      </thead>
      <tbody>
        {#each DAYS as d, i (d)}
          <tr>
            <th scope="row">{d}</th>
            {#each HOURS as h (h)}
              {@const v = grid[i]?.[h] ?? 0}
              <td
                style:background={v ? `color-mix(in srgb, var(--accent) ${shade(v)}%, var(--surface-card))` : undefined}
                class:dark={dark(v)}
                title={`${d} ${hhmm(h * 60)}: ${v} ${v === 1 ? 'departure' : 'departures'}`}
              >{v || ''}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .dh-wrap {
    overflow-x: auto;
  }
  .dh {
    width: 100%;
    min-width: 420px;
    border-collapse: separate;
    border-spacing: 2px;
    table-layout: fixed;
    font: var(--fs-label-xs) var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  caption {
    text-align: left;
    padding-bottom: 8px;
    font: var(--fs-label) var(--font-body);
    color: var(--text-muted);
  }
  th {
    font-weight: 500;
    color: var(--text-muted);
    text-align: center;
  }
  tbody th {
    text-align: left;
    width: 40px;
  }
  td {
    height: 26px;
    text-align: center;
    background: var(--surface-rail);
    color: var(--text-primary);
    border-radius: 1px;
  }
  td.dark {
    color: var(--bg);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .dh-empty {
    color: var(--text-muted);
  }
</style>
