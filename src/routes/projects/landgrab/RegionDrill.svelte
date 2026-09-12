<script lang="ts">
  /**
   * One region's past, in a drawer.
   *
   * The shell is `MethodologyDrawer`'s — backdrop, panel, Escape, click-out —
   * because the site already has one modal manner and a second would be a
   * second set of rules to keep in step. What is new here is the fetch: the
   * page carries no region histories at all (every region's history in the
   * payload is O(regions x events) per load), so the drawer asks the guarded
   * endpoint for exactly the one that was tapped.
   *
   * The drawer is MOUNTED ONCE by the page and driven by `open`; it is not
   * created per tap. That is what lets an in-flight fetch for the last region
   * be aborted when the next one is tapped.
   */
  import { untrack } from 'svelte';
  import Swatch from './Swatch.svelte';
  import StackedTimeline from './StackedTimeline.svelte';
  import { UNCLAIMED_IDENTITY, identityMap, km2, titleCase } from './identity';
  import type { PlayerIdentity } from './identity';
  import type { RegionHistory } from './types';

  let {
    open,
    filterQuery,
    players,
    cellAreaM2,
    onclose,
  }: {
    /** The tapped cell, or null when the drawer is shut. */
    open: { x: number; y: number } | null;
    /** The page's current `?activity&who&window`, WITHOUT the leading `?`. */
    filterQuery: string;
    players: PlayerIdentity[];
    /** One cell in square metres — what a cell count is worth on the ground. */
    cellAreaM2: number;
    onclose: () => void;
  } = $props();

  let loading = $state(false);
  let history = $state<RegionHistory | null>(null);
  let problem = $state<string | null>(null);

  // NOT `$state`. An AbortController is an internal handle: nothing reactive
  // reads it, and a `$state` handle that a function both reads and writes from
  // inside an effect is the `effect_update_depth_exceeded` trap.
  let inflight: AbortController | null = null;

  async function load(at: { x: number; y: number }, query: string) {
    const ctl = new AbortController();
    inflight = ctl;
    loading = true;
    problem = null;
    history = null;
    try {
      const res = await fetch(
        `/projects/landgrab/geo?x=${at.x}&y=${at.y}${query ? `&${query}` : ''}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      if (res.status === 404) {
        problem = 'No ground here.';
        return;
      }
      if (!res.ok) {
        problem = 'Could not load this ground — try again.';
        return;
      }
      history = (await res.json()) as RegionHistory;
    } catch {
      // An abort is the next tap arriving, not a failure — the run that
      // replaced this one owns the state now.
      if (ctl.signal.aborted) return;
      problem = 'Could not load this ground — try again.';
    } finally {
      if (!ctl.signal.aborted) loading = false;
    }
  }

  // Keyed on `open` ALONE. The body is untracked so the writes below (and the
  // `filterQuery` read inside them) cannot subscribe the effect to what it just
  // wrote, and a filter change while the drawer is open does not silently
  // re-fetch under the reader.
  $effect(() => {
    const at = open;
    untrack(() => {
      inflight?.abort();
      inflight = null;
      if (!at) {
        history = null;
        problem = null;
        loading = false;
        return;
      }
      void load(at, filterQuery);
    });
    return () => {
      inflight?.abort();
      inflight = null;
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onclose();
  }

  const byId = $derived(identityMap(players));
  const holder = $derived(
    history
      ? (byId.get(history.subject) ?? {
          ...UNCLAIMED_IDENTITY,
          subject: history.subject,
          name: titleCase(history.subject),
          initial: (history.subject.charAt(0) || '?').toUpperCase(),
        })
      : null,
  );

  const nameOf = (subject: string | null): string =>
    subject === null ? 'open ground' : (byId.get(subject)?.name ?? titleCase(subject));

  const dayFmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const longFmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const fmtDay = (day: string): string => {
    const t = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(t) ? dayFmt.format(new Date(t)) : day;
  };
  const fmtSince = (iso: string | null): string | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? longFmt.format(new Date(t)) : null;
  };

  const heldSince = $derived(history ? fmtSince(history.since) : null);
  /** Most recent first, ten at most — `flips` arrive oldest first. */
  const lastFlips = $derived(history ? [...history.flips].slice(-10).reverse() : []);
  const n = (v: number) => v.toLocaleString('en-GB');
  /** What a cell count is on the ground, for the columns that count cells. */
  const asArea = (cells: number) => `${km2(cells * cellAreaM2)} km²`;
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="lg-drill-backdrop" onclick={onclose}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="lg-drill-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Region history"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="lg-drill-head">
        <span class="lg-drill-kicker">REGION · WHO HAS HELD THIS GROUND</span>
        <button type="button" class="lg-drill-close" onclick={onclose}>CLOSE ✕</button>
      </div>

      {#if loading}
        <p class="lg-drill-msg">Reading the ledger…</p>
      {:else if problem}
        <p class="lg-drill-msg">{problem}</p>
      {:else if history && holder}
        <div class="lg-drill-id">
          <Swatch colour={holder.colour} hatch={holder.hatch} size={18} />
          <div class="lg-drill-id-t">
            <h2 class="lg-drill-name">{history.name ?? 'Territory'}</h2>
            <p class="lg-drill-holder">
              {holder.name} · {n(history.cells)} cells · {km2(history.areaM2)} km²
            </p>
          </div>
        </div>
        {#if heldSince}
          <p class="lg-drill-since">Held since {heldSince}</p>
        {/if}
        <p class="lg-drill-scope">
          History ignores the date window; the filter's activities and players still apply.
        </p>

        <section class="lg-drill-sec">
          <header class="lg-drill-sec-hd">
            <span class="metric-label">Ownership over time</span>
            <span class="metric-label muted">cells held</span>
          </header>
          <StackedTimeline
            timeline={history.timeline}
            {players}
            label="Cells held per player over {history.name ?? 'this ground'}"
          />
        </section>

        {#if history.battle.length}
          <section class="lg-drill-sec">
            <header class="lg-drill-sec-hd">
              <span class="metric-label">The battle</span>
              <span class="metric-label muted">{n(history.handovers)} handovers in all</span>
            </header>
            <table class="lg-drill-table">
              <!-- Seven columns in a panel that is 360px wide on a phone: a
                   table's `width: 100%` does not bind it below its min-content,
                   so fixed layout plus declared widths makes the panel the
                   authority rather than the header text. -->
              <colgroup>
                <col style="width: 28%" />
                <col style="width: 12%" />
                <col style="width: 12%" />
                <col style="width: 12%" />
                <col style="width: 12%" />
                <col style="width: 12%" />
                <col style="width: 12%" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" class="metric-label">Player</th>
                  <th scope="col" class="metric-label num">Events</th>
                  <th scope="col" class="metric-label num">Active days</th>
                  <th scope="col" class="metric-label num">Holds</th>
                  <th scope="col" class="metric-label num">Peak</th>
                  <th scope="col" class="metric-label num">Took</th>
                  <th scope="col" class="metric-label num">Lost</th>
                </tr>
              </thead>
              <tbody>
                {#each history.battle as row (row.subject)}
                  {@const who = byId.get(row.subject)}
                  <tr>
                    <th scope="row" class="lg-drill-who">
                      <!-- The flex lives on a SPAN inside the cell, never on the
                           cell: `display: flex` on a `th` drops it out of the
                           table layout and the colgroup stops binding it. -->
                      <span class="lg-drill-who-in">
                        <Swatch
                          colour={who?.colour ?? UNCLAIMED_IDENTITY.colour}
                          hatch={who?.hatch ?? UNCLAIMED_IDENTITY.hatch}
                          size={12}
                        />
                        <span class="lg-drill-who-n">{who?.name ?? titleCase(row.subject)}</span>
                      </span>
                    </th>
                    <td class="num">{row.loops}/{row.tramples}/{row.fills}</td>
                    <td class="num">{n(row.activeDays)}</td>
                    <td class="num" title={asArea(row.cellsNow)}>{n(row.cellsNow)}</td>
                    <td class="num" title={asArea(row.cellsPeak)}>{n(row.cellsPeak)}</td>
                    <td class="num">{n(row.took)}</td>
                    <td class="num">{n(row.lost)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <p class="lg-drill-legend">
              Events read L/T/F — loops, tramples, fills. Took counts cells taken off somebody;
              ground claimed from open country is neither took nor lost.
            </p>
          </section>
        {/if}

        {#if lastFlips.length}
          <section class="lg-drill-sec">
            <header class="lg-drill-sec-hd">
              <span class="metric-label">Last handovers</span>
              <span class="metric-label muted">most recent first</span>
            </header>
            <ol class="lg-drill-flips">
              {#each lastFlips as f (`${f.day}|${f.from ?? ''}|${f.to}`)}
                <li>
                  <span class="lg-drill-day">{fmtDay(f.day)}</span>
                  <span class="lg-drill-move">{nameOf(f.from)} → {nameOf(f.to)}</span>
                  <span class="lg-drill-cells">{n(f.cells)} cell{f.cells === 1 ? '' : 's'}</span>
                </li>
              {/each}
            </ol>
          </section>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .lg-drill-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(26, 16, 8, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 20px;
    animation: md-fade 140ms ease;
  }
  /* OPAQUE. `--card-bg` and `--surface-overlay` are tints, and a tinted panel
     over the map reads as a bug. */
  .lg-drill-panel {
    width: 100%;
    max-width: 720px;
    max-height: 84vh;
    overflow: auto;
    background: var(--bg);
    border: 2px solid var(--line-strong);
    padding: 22px 22px 24px;
  }
  .lg-drill-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 14px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--line-hair);
  }
  .lg-drill-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .lg-drill-close {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 3px 8px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color 80ms ease,
      color 80ms ease;
  }
  .lg-drill-close:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .lg-drill-msg {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .lg-drill-id {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }
  .lg-drill-id-t {
    min-width: 0;
  }
  .lg-drill-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .lg-drill-holder {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .lg-drill-since {
    margin: 8px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  /* The one line that stops the drawer being read as the filtered board. */
  .lg-drill-scope {
    margin: 12px 0 0;
    padding: 8px 10px;
    background: var(--surface-sunken);
    border-left: 2px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
  }

  .lg-drill-sec {
    margin-top: 22px;
    min-width: 0;
  }
  .lg-drill-sec-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--line-strong);
  }

  .lg-drill-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }
  .lg-drill-table th,
  .lg-drill-table td {
    padding: 7px 6px;
    text-align: left;
    border-bottom: 1px solid var(--line-hair);
    vertical-align: middle;
  }
  .lg-drill-table thead th {
    border-bottom: 1px solid var(--line-strong);
  }
  .lg-drill-table tbody tr:last-child th,
  .lg-drill-table tbody tr:last-child td {
    border-bottom: 0;
  }
  .lg-drill-table td,
  .lg-drill-table tbody th {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .lg-drill-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .lg-drill-who {
    font-weight: 500;
  }
  .lg-drill-who-in {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .lg-drill-who-n {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lg-drill-legend {
    margin: 10px 0 0;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
  }

  .lg-drill-flips {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lg-drill-flips li {
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line-hair);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
  }
  .lg-drill-flips li:last-child {
    border-bottom: 0;
  }
  .lg-drill-day,
  .lg-drill-cells {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    color: var(--text-ghost);
  }
  .lg-drill-move {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  @keyframes md-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lg-drill-backdrop {
      animation: none;
    }
  }

  /* A bottom sheet on a phone: the panel is where the thumb is, and it stops
     being a card floating in the middle of a 20px gutter. */
  @media (max-width: 700px) {
    .lg-drill-backdrop {
      align-items: flex-end;
      padding: 0;
    }
    .lg-drill-panel {
      max-height: 85dvh;
      max-width: none;
      border-width: 2px 0 0;
      padding: 18px 16px 22px;
    }
  }
</style>
