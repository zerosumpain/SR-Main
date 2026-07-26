<script lang="ts">
  // The active lens, in one control.
  //
  // A lens is a perspective, not a filter widget, so the picker deliberately
  // shows what each one NARROWS rather than just its name — "everything" versus
  // "professional · 2 types" is the difference between choosing a saved view and
  // guessing at one. Clearing is a first-class row, not a hidden ✕: the failure
  // mode of saved views is getting stuck inside one without noticing.
  //
  // The panel is a floating surface, so it takes an OPAQUE background
  // (--surface-elevated); a translucent one over the graph is unreadable.

  interface PickerLens {
    id: string;
    slug: string;
    name: string;
    /** Human-readable description of the filters, from describeLensFilters. */
    summary?: string;
    description?: string | null;
    /** Present when the lens is a live query. */
    cron?: string | null;
    lastCount?: number | null;
  }

  let {
    lenses = [],
    activeId = null,
    onSelect,
    busy = false,
    label = 'Lens',
  }: {
    lenses: PickerLens[];
    activeId?: string | null;
    /** Null means "no lens" — the caller must show everything again. */
    onSelect: (lens: PickerLens | null) => void;
    busy?: boolean;
    label?: string;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  const active = $derived(lenses.find((l) => l.id === activeId) ?? null);

  /** Escape closes without choosing — bound to the trigger and to the panel,
   *  which between them own every element focus can be on while it is open. */
  function dismissOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    open = false;
    event.stopPropagation();
  }

  function choose(lens: PickerLens | null) {
    open = false;
    onSelect(lens);
  }

  // Outside-click dismissal. The listener is only attached while the panel is
  // open, and it writes `open` from a DOM event rather than from inside the
  // effect, so there is no read-own-write cycle here.
  $effect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) open = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });
</script>

<div class="picker" bind:this={root}>
  <span class="label">{label}</span>

  <button
    type="button"
    class="trigger"
    class:on={Boolean(active)}
    aria-haspopup="listbox"
    aria-expanded={open}
    disabled={busy || lenses.length === 0}
    onclick={() => (open = !open)}
    onkeydown={dismissOnEscape}
  >
    <span class="name">{active ? active.name : 'All entities'}</span>
    {#if active?.cron}
      <span class="live" title="Live query — re-evaluated on a schedule">live</span>
    {/if}
    <span class="chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
  </button>

  {#if open}
    <div class="panel" role="listbox" aria-label="Saved lenses" tabindex="-1" onkeydown={dismissOnEscape}>
      <button
        type="button"
        role="option"
        aria-selected={!active}
        class="row"
        class:selected={!active}
        onclick={() => choose(null)}
      >
        <span class="row-name">All entities</span>
        <span class="row-sub">no lens — everything in the graph</span>
      </button>

      {#each lenses as lens (lens.id)}
        <button
          type="button"
          role="option"
          aria-selected={lens.id === activeId}
          class="row"
          class:selected={lens.id === activeId}
          onclick={() => choose(lens)}
        >
          <span class="row-name">
            {lens.name}
            {#if lens.cron}<span class="live">live</span>{/if}
            {#if typeof lens.lastCount === 'number'}<span class="count">{lens.lastCount}</span>{/if}
          </span>
          <span class="row-sub">{lens.description || lens.summary || 'everything'}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 260px;
    padding: 5px 9px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  .trigger:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .trigger.on {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .trigger:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    font-size: 10px;
    color: var(--text-ghost);
  }

  .live {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent-ink);
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-pill);
    padding: 0 5px;
  }
  .count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .panel {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    z-index: 40;
    min-width: 260px;
    max-width: 340px;
    max-height: 320px;
    overflow-y: auto;
    /* Opaque: this floats over the chart and the graph. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    cursor: pointer;
    font-family: var(--font-body);
  }
  .row:hover {
    background: var(--accent-tint-08);
    border-color: var(--accent-tint-14);
  }
  .row.selected {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }

  .row-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-body-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .row-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
