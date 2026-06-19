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
    <span class="ic">⛵</span>
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
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 0.5rem;
    padding: 0.45rem 0.55rem; min-height: 44px; cursor: pointer; text-align: left; color: var(--text-primary);
  }
  .chip:hover { border-color: var(--accent); }
  .ic { flex: 0 0 auto; font-size: 1rem; line-height: 1; }
  .txt { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
  .nm { font-family: var(--font-body); font-weight: 600; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .caret { flex: 0 0 auto; color: var(--text-muted); font-size: 0.7rem; }
</style>
