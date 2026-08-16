<script lang="ts">
  // Compact header: a boat chip (name + air draft → opens the boat sheet) and a
  // start chip (origin → opens the set-start menu). Replaces the always-on boat
  // spec card and the origin row.
  import { app } from '../lib/appState.svelte';
  import { mToFtIn } from '../lib/format';

  let { onBoat, onStart }: { onBoat: () => void; onStart: () => void } = $props();
</script>

<div class="hdr">
  <button class="chip" onclick={onBoat} aria-label="Choose boat and see bridge fit">
    <span class="ic"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5v9M9 4.5 3.5 11.5H9z" /><path d="M10.5 8 14 11.5h-3.5z" /><path d="M3 14h14l-2 3.5H5z" /></svg></span>
    <span class="txt">
      <span class="nm">{app.boat?.name ?? 'Choose a boat'}</span>
      {#if app.boat}<span class="sub">{mToFtIn(app.boat.air_draft_m)} air draft</span>{/if}
    </span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>
  <button class="chip" onclick={onStart} aria-label="Set start location">
    <span class="ic">◉</span>
    <span class="txt">
      <span class="nm">{app.origin?.label ?? 'Set start'}</span>
      <span class="sub">Start</span>
    </span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>
</div>

<style>
  .hdr { display: flex; gap: 0.5rem; }
  .chip {
    flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 0.5rem;
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp);
    padding: 0.45rem 0.55rem; min-height: 44px; cursor: pointer; text-align: left; color: var(--text-primary);
  }
  .chip:hover { border-color: var(--accent); }
  .ic { flex: 0 0 auto; display: inline-flex; line-height: 1; color: var(--accent); }
  .txt { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
  .nm { font-family: var(--font-body); font-weight: 600; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .caret { flex: 0 0 auto; color: var(--text-muted); font-size: var(--fs-label-xs); }
</style>
