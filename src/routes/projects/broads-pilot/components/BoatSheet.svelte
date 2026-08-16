<script lang="ts">
  // Second-level sheet (with scrim — this is a focused sub-task) holding the
  // boat selector, specs, and the "can my boat fit?" bridge matrix on demand.
  // The matrix lives here so it never clutters the map.
  import BoatPicker from './BoatPicker.svelte';
  let { onClose }: { onClose: () => void } = $props();
</script>

<div class="bs-backdrop" role="presentation" onclick={onClose}>
  <div class="bs" role="dialog" aria-label="Your boat" onclick={(e) => e.stopPropagation()}>
    <header class="bs-head">
      <span class="kicker">Your boat</span>
      <h2>Boat &amp; bridge fit</h2>
      <button class="close" onclick={onClose} aria-label="Close">✕</button>
    </header>
    <div class="bs-body">
      <BoatPicker />
      <p class="hint">Your boat's air draft decides which bridges you can pass — the planner uses it automatically. Pick a destination and any tight or blocked bridge is called out on the route.</p>
    </div>
  </div>
</div>

<style>
  .bs-backdrop { position: absolute; inset: 0; z-index: 1000; background: rgba(26, 16, 8, 0.42); display: grid; place-items: end center; padding: 0.6rem; }
  .bs { width: min(34rem, 100%); max-height: calc(100dvh - 1.2rem); display: flex; flex-direction: column; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: var(--radius-sharp); overflow: hidden; }
  .bs-head { position: relative; padding: 0.9rem 1rem 0.7rem; border-bottom: 1px solid var(--card-border); }
  .kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: var(--fs-label-xs); color: var(--accent); }
  .bs-head h2 { margin: 0.15rem 0 0; font-family: var(--font-display); text-transform: uppercase; font-size: 1.05rem; color: var(--text-primary); }
  .close { position: absolute; top: 0.6rem; right: 0.7rem; background: transparent; border: none; color: var(--text-muted); font-size: 1.1rem; cursor: pointer; min-height: 36px; min-width: 36px; }
  .close:hover { color: var(--text-primary); }
  .bs-body { overflow-y: auto; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.8rem; }
  .hint { margin: 0; font-family: var(--font-body); font-size: 0.78rem; color: var(--text-muted); line-height: 1.5; }
  @media (min-width: 760px) { .bs-backdrop { place-items: center; } }
</style>
