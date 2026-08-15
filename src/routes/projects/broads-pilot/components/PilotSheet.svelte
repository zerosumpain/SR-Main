<script lang="ts">
  // The single, mode-aware information surface. Mobile = a bottom sheet with
  // three snap points (peek/half/full) — drag the grip or tap it to cycle.
  // Desktop = a docked left card showing everything. No scrim: the map stays
  // pannable behind at every height. Header + summary are always visible (peek);
  // the body shows at half/full (and always on desktop).
  import type { Snippet } from 'svelte';
  import { app } from '../lib/appState.svelte';

  let {
    snap = $bindable('peek'),
    header,
    summary,
    children,
  }: { snap?: 'peek' | 'half' | 'full'; header?: Snippet; summary?: Snippet; children?: Snippet } = $props();

  const SNAPS = ['peek', 'half', 'full'] as const;
  const vh = () => (typeof window !== 'undefined' ? window.innerHeight : 800);
  const snapPx = (s: string) => (s === 'peek' ? 142 : s === 'half' ? Math.round(vh() * 0.5) : Math.round(vh() * 0.92));

  let liveH = $state<number | null>(null);
  const heightStyle = $derived(`${liveH ?? snapPx(snap)}px`);
  // publish the height so the FABs can ride up with the sheet
  $effect(() => { app.sheetPx = liveH ?? snapPx(snap); });

  let startY = 0, startH = 0, dragged = false;
  function onDown(e: PointerEvent) {
    startY = e.clientY; startH = snapPx(snap); dragged = false; liveH = startH;
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  }
  function onMove(e: PointerEvent) {
    if (liveH == null) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 6) dragged = true;
    liveH = Math.max(90, Math.min(vh() * 0.95, startH + dy));
  }
  function onUp() {
    if (liveH == null) return;
    if (dragged) {
      let best: typeof snap = 'half', bd = Infinity;
      for (const s of SNAPS) { const d = Math.abs(snapPx(s) - liveH!); if (d < bd) { bd = d; best = s; } }
      snap = best;
    }
    liveH = null;
  }
  // A tap (no drag) cycles the snap point; a drag is handled above, so guard it.
  function onGripClick() {
    if (dragged) { dragged = false; return; }
    snap = SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length];
  }
</script>

<aside class="sheet {snap}" class:dragging={liveH != null} style:height={heightStyle}>
  <button class="grip" onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onclick={onGripClick}
    aria-label="Resize panel — drag or tap to expand"></button>
  <div class="sheet-head">
    {@render header?.()}
    {@render summary?.()}
  </div>
  <div class="body">{@render children?.()}</div>
</aside>

<style>
  .sheet {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 450;
    display: flex; flex-direction: column;
    background: var(--surface-elevated); border-top: 1px solid var(--card-border);
    border-radius: var(--radius-sharp) var(--radius-sharp) 0 0;
  }
  .sheet:not(.dragging) { transition: height 0.2s var(--ease-out); }
  .grip { display: block; width: 100%; height: 30px; border: none; background: transparent; cursor: grab; position: relative; flex: 0 0 auto; touch-action: none; z-index: 2; }
  .grip::before { content: ''; position: absolute; left: 50%; top: 12px; transform: translateX(-50%); width: 40px; height: 4px; border-radius: var(--radius-sharp); background: var(--card-border); }
  .grip:active { cursor: grabbing; }
  .sheet-head { flex: 0 0 auto; padding: 0 0.7rem 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .body { flex: 1 1 auto; overflow-y: auto; padding: 0.1rem 0.7rem 0.9rem; display: flex; flex-direction: column; gap: 0.7rem; }
  .sheet.peek .body { display: none; }

  @media (min-width: 760px) {
    .sheet {
      left: 0.6rem; right: auto; top: 0.6rem; bottom: auto; width: 23rem;
      height: auto !important; max-height: calc(100% - 5.5rem);
      border: 1px solid var(--card-border); border-top: 1px solid var(--card-border);
      border-radius: var(--radius-sharp);
    }
    .grip { display: none; }
    .sheet-head { padding-top: 0.7rem; }
    .sheet.peek .body { display: flex; }
  }
</style>
