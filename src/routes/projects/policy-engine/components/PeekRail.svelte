<script lang="ts">
  // PeekRail — the slim middle state of the levers sidebar: shows the scenario and
  // which levers differ from the starting stance, without stealing space from the
  // prose. Click a chip to open the full drawer focused on that lever.
  import { app } from '../lib/appState.svelte';
  import { LEVERS_BY_ID, LEVER_ELI5_NAME } from '../lib/levers';

  const MAX_CHIPS = 8;
  const chips = $derived(app.changedFromBase.slice(0, MAX_CHIPS));
  const overflow = $derived(Math.max(0, app.changedFromBase.length - MAX_CHIPS));
  const lname = (id: string) => {
    const L = LEVERS_BY_ID[id];
    return app.narrative === 'eli5' ? LEVER_ELI5_NAME[id] ?? L.label : L.label;
  };
  const lval = (id: string, v: number) => {
    const L = LEVERS_BY_ID[id];
    return L.format ? L.format(v) : `${v}${L.unit === '%' ? '%' : ''}`;
  };
</script>

<div class="peek">
  <button class="pk-expand" onclick={() => app.openDrawer()} title="Open the full levers drawer">☰ Levers ›</button>
  <span class="pk-scn" title={app.scenarioDisplayName}>{app.scenarioDisplayName}</span>

  {#if chips.length === 0}
    <span class="pk-none">{app.narrative === 'eli5' ? 'No sliders changed' : 'No levers changed'}</span>
  {:else}
    <div class="pk-chips">
      {#each chips as c (c.id)}
        <button class="pk-chip" onclick={() => app.focusLever(c.id)} title="{lname(c.id)} — jump to this slider">
          <span class="pkc-name">{lname(c.id)}</span>
          <span class="pkc-val">{lval(c.id, c.value)}</span>
        </button>
      {/each}
      {#if overflow > 0}
        <button class="pk-more" onclick={() => app.openDrawer()}>+{overflow} more</button>
      {/if}
    </div>
    {#if app.basePreset && app.basePresetLevers}
      <button class="pk-reset" onclick={() => app.resetToBase()} title="Discard your changes and return to the stance">↺ back to base</button>
    {/if}
  {/if}

  <button class="pk-collapse" onclick={() => app.closeDrawer()} title="Collapse to the spine">‹ hide</button>
</div>

<style>
  .peek { display: flex; flex-direction: column; gap: 8px; height: 100%; padding: 10px 8px 14px; overflow-y: auto; overscroll-behavior: contain; }
  .pk-expand { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--accent-ink); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-sharp); padding: 6px 6px; cursor: pointer; }
  .pk-expand:hover { background: var(--accent-ink-tint-22); }
  .pk-scn { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label-xs); line-height: 1.3; color: var(--ink);
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .pk-none { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); line-height: 1.4; }
  .pk-chips { display: flex; flex-direction: column; gap: 5px; }
  .pk-chip { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; cursor: pointer;
    background: rgba(255,255,255,0.5); border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-sharp); padding: 4px 7px; }
  .pk-chip:hover { background: var(--accent-ink-tint-12); border-color: var(--accent-ink); }
  .pkc-name { font-size: var(--fs-label-xs); line-height: 1.25; color: var(--accent-ink); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .pkc-val { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--ink); }
  .pk-more { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); background: transparent;
    border: 1px dashed rgba(28,22,17,0.3); border-radius: var(--radius-sharp); padding: 4px 7px; cursor: pointer; }
  .pk-more:hover { color: var(--ink); border-color: rgba(28,22,17,0.5); }
  .pk-reset { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); background: transparent;
    border: 1px solid var(--error-border); border-radius: var(--radius-sharp); padding: 4px 6px; cursor: pointer; }
  .pk-reset:hover { background: var(--error-bg); }
  .pk-collapse { margin-top: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5);
    background: transparent; border: none; cursor: pointer; padding: 4px 0; text-align: left; }
  .pk-collapse:hover { color: var(--ink); }
</style>
