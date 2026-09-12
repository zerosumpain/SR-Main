<script lang="ts">
  /**
   * 01 / THE MAP — the filter, the picture frame, the focus control and the key.
   *
   * The map is the page now, so everything that decides WHAT it draws sits
   * directly above it rather than two screens up: a v1 reader had to scroll past
   * the standings and a whole filter section before seeing any ground.
   *
   * The frame is `SegmentGround`'s: 2px `--card-border`, 12px of padding, a head
   * row naming the basemap, and a key underneath. The map is the one panel on
   * this page that is a picture, and it is framed like one.
   */
  import TerritoryMap from './TerritoryMap.svelte';
  import Swatch from './Swatch.svelte';
  import { DATE_WINDOWS, identityMap, km2, windowShort } from './identity';
  import type { LandgrabData } from './types';

  type TerritoryTap = { lat: number; lon: number; subject: string | null };

  let {
    lg,
    chips,
    selectedActivityKeys,
    selectedWindow,
    selectedSubjects,
    applying,
    ontoggleActivity,
    onpickWindow,
    ontoggleSubject,
    ontap,
  }: {
    lg: LandgrabData;
    /** The page's shared clock. Nothing in this section is relative to it — the
     *  head prints the window, not an age — but it stays in the contract so a
     *  child that grows one does not have to be re-plumbed. */
    now: number;
    chips: Array<{ key: string; label: string }>;
    selectedActivityKeys: Set<string>;
    selectedWindow: string;
    selectedSubjects: Set<string>;
    applying: boolean;
    ontoggleActivity: (key: string) => void;
    onpickWindow: (key: string) => void;
    ontoggleSubject: (subject: string) => void;
    ontap: (hit: TerritoryTap) => void;
  } = $props();

  // UI state, not handles: the template reads both, so both are $state.
  let view = $state<'changed' | 'home' | 'all'>('changed');
  let isolate = $state<string | null>(null);

  const VIEWS = [
    { key: 'changed', label: 'Changed', hint: 'Fit where the ground moved' },
    { key: 'home', label: 'Home', hint: 'Fit the Darlington box' },
    { key: 'all', label: 'All', hint: 'Fit every territory' },
  ] as const;

  const roster = $derived(lg.players.filter((p) => lg.available.subjects.includes(p.subject)));
  const who = $derived(identityMap(lg.players));

  function toggleIsolate(subject: string) {
    isolate = isolate === subject ? null : subject;
  }
</script>

<div class="lg-stage">
  <div class="lg-tools" aria-label="What counts">
    <div class="lg-tool">
      <span class="metric-label">Counts as territory</span>
      <div class="lg-chips">
        {#each chips as c (c.key)}
          <button
            type="button"
            class="lg-chip"
            class:on={selectedActivityKeys.has(c.key)}
            aria-pressed={selectedActivityKeys.has(c.key)}
            onclick={() => ontoggleActivity(c.key)}
            disabled={applying}>{c.label}</button
          >
        {/each}
      </div>
    </div>

    <div class="lg-tool">
      <span class="metric-label">Captured within</span>
      <div class="lg-chips" role="radiogroup" aria-label="Date window">
        {#each DATE_WINDOWS as w (w.key)}
          <button
            type="button"
            class="lg-chip"
            role="radio"
            class:on={selectedWindow === w.key}
            aria-checked={selectedWindow === w.key}
            onclick={() => onpickWindow(w.key)}
            disabled={applying}>{w.label}</button
          >
        {/each}
      </div>
    </div>

    <div class="lg-tool">
      <span class="metric-label">Players</span>
      <div class="lg-chips">
        {#each roster as p (p.subject)}
          <button
            type="button"
            class="lg-chip lg-chip--who"
            class:on={selectedSubjects.has(p.subject)}
            style="--who: {p.colour}"
            aria-pressed={selectedSubjects.has(p.subject)}
            onclick={() => ontoggleSubject(p.subject)}
            disabled={applying}
          >
            <Swatch colour={p.colour} hatch={p.hatch} />{p.name}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="lg-frame">
    <div class="lg-frame-head">
      <p class="lg-frame-label">Territory · light basemap</p>
      <p class="lg-frame-meta">{lg.focus.label} · {windowShort(lg.window.key)}</p>
    </div>

    <div class="lg-frame-map">
      <TerritoryMap
        territory={lg.territory}
        handovers={lg.handovers}
        players={lg.players}
        cellAreaM2={lg.cellAreaM2}
        focus={lg.focus}
        {view}
        {isolate}
        {ontap}
        height="100%"
      />
      <div class="lg-view" role="radiogroup" aria-label="Fit the map to">
        {#each VIEWS as v (v.key)}
          <button
            type="button"
            role="radio"
            aria-checked={view === v.key}
            title={v.hint}
            onclick={() => (view = v.key)}>{v.label}</button
          >
        {/each}
      </div>
    </div>

    <ul class="lg-key">
      {#each lg.share as row (row.subject)}
        {@const p = who.get(row.subject)}
        <li style="--who: {p?.colour ?? 'var(--text-primary)'}">
          <button
            type="button"
            class="lg-key-btn"
            class:on={isolate === row.subject}
            aria-pressed={isolate === row.subject}
            disabled={row.cells === 0}
            onclick={() => toggleIsolate(row.subject)}
          >
            <Swatch colour={p?.colour ?? 'var(--text-primary)'} hatch={p?.hatch ?? 'diag'} />
            <b>{p?.initial ?? '?'}</b>
            {p?.name ?? row.subject}
            <span class="lg-key-v">{km2(row.areaM2)} km²</span>
          </button>
        </li>
      {/each}
      <li class="lg-key-changed">
        <span class="lg-key-dash" aria-hidden="true"></span>
        Changed hands
        <span class="lg-key-v">
          {lg.handovers.cells
            ? `${lg.handovers.cells.toLocaleString('en-GB')} cells`
            : 'none this window'}
        </span>
      </li>
      {#if lg.share.length === 0}
        <li class="lg-key-none">Nobody holds ground under this filter.</li>
      {/if}
    </ul>
  </div>
</div>

<style>
  .lg-stage {
    min-width: 0;
  }

  /* ---- the filter ---- */
  .lg-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 12px 32px;
    padding: 14px 16px;
    margin-bottom: 1.25rem;
    border: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .lg-tool {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .lg-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .lg-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    padding: 6px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition:
      color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      background var(--t-fast) var(--ease-out);
  }
  .lg-chip:hover:not(:disabled) {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }
  .lg-chip.on {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .lg-chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .lg-chip--who {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .lg-chip--who.on {
    background: var(--who);
    border-color: var(--who);
    color: var(--bg);
  }
  /* The swatch inverts inside a filled chip, or its hatch disappears into it. */
  .lg-chip--who.on :global(.sw) {
    border-color: var(--bg);
    --who: var(--bg);
  }

  /* ---- the picture frame ---- */
  .lg-frame {
    border: 2px solid var(--card-border);
    border-radius: 0;
    background: var(--card-bg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .lg-frame-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 4px 6px 12px;
  }
  .lg-frame-label,
  .lg-frame-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0;
  }
  .lg-frame-meta {
    font-weight: 400;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .lg-frame-map {
    position: relative;
    width: 100%;
    height: 60vh;
    min-height: 420px;
  }

  /* ---- the focus control, over the map ---- */
  .lg-view {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 5;
    display: flex;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--surface-card);
    overflow: hidden;
  }
  .lg-view button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    padding: 6px 10px;
    border: 0;
    border-left: 1px solid var(--line-strong);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--t-fast) var(--ease-out),
      background var(--t-fast) var(--ease-out);
  }
  .lg-view button:first-child {
    border-left: 0;
  }
  .lg-view button:hover {
    color: var(--text-primary);
  }
  .lg-view button[aria-checked='true'] {
    background: var(--text-primary);
    color: var(--bg);
  }

  /* ---- the key ---- */
  .lg-key {
    display: flex;
    align-items: center;
    gap: 10px 18px;
    flex-wrap: wrap;
    list-style: none;
    margin: 0;
    padding: 12px 6px 4px;
  }
  .lg-key li {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .lg-key-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 3px 0;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    cursor: pointer;
  }
  .lg-key-btn:hover:not(:disabled),
  .lg-key-btn.on {
    color: var(--text-primary);
    border-bottom-color: var(--who);
  }
  .lg-key-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .lg-key-btn b {
    color: var(--who);
    font-weight: 700;
  }
  .lg-key-v {
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .lg-key-dash {
    display: block;
    width: 14px;
    height: 14px;
    border: 2px dashed var(--accent);
    border-radius: var(--radius-sharp);
    flex: 0 0 auto;
  }
  .lg-key-none {
    color: var(--accent);
  }

  /* ---- the phone ---- */
  @media (max-width: 700px) {
    .lg-tools {
      gap: 12px 18px;
      padding: 12px;
    }
    .lg-tool {
      flex: 1 1 100%;
    }
    /* One row per group that scrolls sideways, rather than four rows of chips
       pushing the map off the first screen. */
    .lg-chips {
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .lg-frame-map {
      height: auto;
      aspect-ratio: 4 / 5;
    }
  }
  @media (pointer: coarse) {
    .lg-chip,
    .lg-view button {
      min-height: 40px;
    }
  }
</style>
