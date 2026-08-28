<script lang="ts">
  // The recency slicer — "show me only what is new".
  //
  // The graph is a standing picture of everything ever ingested, which answers
  // "what is connected to what" and cannot answer "what changed". Those are
  // different questions and the second one is the one you ask every morning.
  //
  // Three decisions worth keeping:
  //
  //  - TWO CLOCKS, named. `Added` is when a row entered the graph; `Updated` is
  //    when it last changed. They disagree constantly — an entity known since
  //    May that picked up three new mentions last night is invisible under one
  //    and top of the list under the other. Anything that silently picks one is
  //    lying by omission, so the control names which is in force and the
  //    payload echoes it back.
  //
  //  - THE HISTOGRAM IS OF THE WHOLE GRAPH, never of the current selection. It
  //    comes from the server computed over the full index for exactly this
  //    reason: a chart that redraws as you brush it flattens the bars you are
  //    aiming at, and you can no longer see where the activity you are hunting
  //    actually is.
  //
  //  - THE PARENT OWNS THE WINDOW. Every change is reported up through
  //    `onChange` and comes back down as props; nothing is mirrored into local
  //    `$state` through an `$effect`. Syncing props into state in an effect is
  //    the documented route to a hydration stall in this codebase, and there is
  //    nothing here that needs it.

  interface ActivityDay {
    /** UTC day start, epoch ms. */
    t: number;
    nodes: number;
    edges: number;
  }

  let {
    activity = null,
    clock = 'updated',
    since = null,
    until = null,
    recentNodes = 0,
    recentEdges = 0,
    onChange,
  }: {
    activity: {
      from: number;
      to: number;
      days: ActivityDay[];
      olderNodes: number;
      olderEdges: number;
    } | null;
    clock: 'added' | 'updated';
    since: number | null;
    until: number | null;
    /** What the window itself admitted, for the honest count under the chart. */
    recentNodes?: number;
    recentEdges?: number;
    onChange: (next: { since: number | null; until: number | null; clock: 'added' | 'updated' }) => void;
  } = $props();

  const DAY = 86_400_000;

  /**
   * Presets in days, or null for "everything".
   *
   * Days rather than instants, resolved against the clock at click time: a
   * preset computed once at mount would still be saying "last 24 hours" about
   * yesterday if the tab were left open overnight.
   */
  const PRESETS: Array<{ label: string; days: number | null }> = [
    { label: '24h', days: 1 },
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: 'All', days: null },
  ];

  const active = $derived(since !== null || until !== null);

  /**
   * Which preset the current window corresponds to, if any.
   *
   * Matched with a tolerance of half a day because the window is a real instant
   * and the button that set it was pressed some time ago; an exact comparison
   * would un-highlight the preset you just clicked within milliseconds.
   */
  const activePreset = $derived.by(() => {
    if (!active) return 'All';
    if (until !== null) return null; // a bounded range is never a preset
    const span = Date.now() - (since ?? 0);
    const hit = PRESETS.find((p) => p.days !== null && Math.abs(span - p.days * DAY) < DAY / 2);
    return hit?.label ?? null;
  });

  function applyPreset(days: number | null) {
    if (days === null) onChange({ since: null, until: null, clock });
    else onChange({ since: Date.now() - days * DAY, until: null, clock });
  }

  function setClock(next: 'added' | 'updated') {
    if (next !== clock) onChange({ since, until, clock: next });
  }

  /** `YYYY-MM-DD` in the VIEWER's timezone, which is whose day the input means. */
  function toDateInput(ms: number | null): string {
    if (ms === null) return '';
    const d = new Date(ms);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }

  /** `25 May` — the axis end label. Short because the rail is 300px wide and a
   *  full ISO date wraps onto two lines and collides with the legend. */
  function shortDate(ms: number): string {
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function onSinceInput(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value;
    if (!raw) return onChange({ since: null, until, clock });
    // Local midnight, not UTC midnight: the user picked a day on their own
    // calendar, and `new Date('2026-08-22')` is parsed as UTC — an hour of
    // every British summer day would land in the wrong bucket.
    const d = new Date(`${raw}T00:00:00`);
    if (!Number.isNaN(d.getTime())) onChange({ since: d.getTime(), until, clock });
  }

  function onUntilInput(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value;
    if (!raw) return onChange({ since, until: null, clock });
    // End of the chosen day, so picking the same date for both ends means
    // "that day" rather than an empty instant-wide window.
    const d = new Date(`${raw}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) onChange({ since, until: d.getTime(), clock });
  }

  /** Tallest bar in the chart, so the bars can be scaled without a d3 import. */
  const peak = $derived(
    Math.max(1, ...(activity?.days ?? []).map((d) => d.nodes + d.edges)),
  );

  const inWindow = (t: number) =>
    (since === null || t + DAY > since) && (until === null || t <= until);

  const totalOlder = $derived((activity?.olderNodes ?? 0) + (activity?.olderEdges ?? 0));
</script>

<div class="ctl">
  <div class="clocks" role="group" aria-label="Which timestamp to filter on">
    <button
      type="button"
      class="clock"
      class:on={clock === 'added'}
      aria-pressed={clock === 'added'}
      onclick={() => setClock('added')}
    >
      Added
    </button>
    <button
      type="button"
      class="clock"
      class:on={clock === 'updated'}
      aria-pressed={clock === 'updated'}
      onclick={() => setClock('updated')}
    >
      Updated
    </button>
  </div>
  <p class="hint">
    {clock === 'added'
      ? 'When the entity or connection first entered the graph.'
      : 'When it last changed. Connections use their last observation.'}
  </p>

  {#if activity}
    <div class="chart" aria-hidden="true">
      {#each activity.days as d (d.t)}
        <div class="col" class:lit={inWindow(d.t)} title={`${toDateInput(d.t)} — ${d.nodes} entities, ${d.edges} connections`}>
          <div class="bar edges" style:height={`${((d.edges / peak) * 100).toFixed(1)}%`}></div>
          <div class="bar nodes" style:height={`${((d.nodes / peak) * 100).toFixed(1)}%`}></div>
        </div>
      {/each}
    </div>
    <div class="axis">
      <span>{shortDate(activity.from)}</span>
      <span>now</span>
    </div>
    <p class="legend">
      <i class="swatch nodes"></i> entities
      <i class="swatch edges"></i> connections
    </p>
  {/if}

  <div class="presets" role="group" aria-label="Recency window">
    {#each PRESETS as p (p.label)}
      <button
        type="button"
        class="preset"
        class:on={activePreset === p.label}
        aria-pressed={activePreset === p.label}
        onclick={() => applyPreset(p.days)}
      >
        {p.label}
      </button>
    {/each}
  </div>

  <div class="range">
    <label>
      <span>From</span>
      <input type="date" value={toDateInput(since)} oninput={onSinceInput} />
    </label>
    <label>
      <span>To</span>
      <input type="date" value={toDateInput(until)} oninput={onUntilInput} />
    </label>
  </div>

  {#if active}
    <p class="hint count">
      {recentNodes} entit{recentNodes === 1 ? 'y' : 'ies'} and {recentEdges} connection{recentEdges === 1
        ? ''
        : 's'} in the window, drawn solid. Anything faint is an endpoint pulled in for context.
    </p>
  {:else if totalOlder > 0}
    <p class="hint">
      {totalOlder.toLocaleString()} older than 90 days, off the left of the chart.
    </p>
  {/if}
</div>

<style>
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .clocks,
  .presets {
    display: flex;
    gap: 2px;
  }
  .clock,
  .preset {
    flex: 1;
    padding: 5px 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    background: none;
    font: inherit;
    font-size: var(--text-label);
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .clock:hover,
  .preset:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }
  .clock.on,
  .preset.on {
    border-color: var(--accent-ink);
    color: var(--text-primary);
    background: var(--surface-sunken);
  }

  .chart {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 46px;
    padding: 2px 0;
    border-bottom: 1px solid var(--line);
  }
  .col {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    opacity: 0.28;
    transition: opacity var(--t-fast) var(--ease-out);
  }
  .col.lit {
    opacity: 1;
  }
  .bar {
    width: 100%;
    min-height: 0;
  }
  .bar.nodes {
    background: var(--accent-ink);
  }
  .bar.edges {
    background: var(--accent);
  }

  .axis {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .legend .swatch:not(:first-child) {
    margin-left: 4px;
  }
  .swatch {
    display: inline-block;
    width: 7px;
    height: 7px;
  }
  .swatch.nodes {
    background: var(--accent-ink);
  }
  .swatch.edges {
    background: var(--accent);
  }

  .range {
    display: flex;
    gap: 6px;
  }
  .range label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--text-ghost);
  }
  .range input {
    width: 100%;
    padding: 4px 5px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    background: var(--surface);
    color: var(--text-primary);
    /* 16px floor on inputs — anything smaller zooms the page on iOS. */
    font-size: 16px;
    font-family: var(--font-mono);
  }

  .hint {
    margin: 0;
    font-size: var(--text-label);
    color: var(--text-ghost);
    line-height: 1.4;
  }
  .hint.count {
    color: var(--text-secondary);
  }
</style>
