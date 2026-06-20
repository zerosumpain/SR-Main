<script lang="ts">
  import type { Snippet } from 'svelte';
  import { portal } from './portal';

  interface Props {
    open: boolean;
    onClose: () => void;
    title?: string;
    maxHeightVh?: number;
    children: Snippet;
  }

  let { open, onClose, title, maxHeightVh = 90, children }: Props = $props();

  let dragStartY: number | null = null;
  let dragStartT: number | null = null;
  let dragDeltaY = $state(0);

  function onHandleTouchStart(e: TouchEvent) {
    dragStartY = e.touches[0].clientY;
    dragStartT = performance.now();
    dragDeltaY = 0;
  }
  function onHandleTouchMove(e: TouchEvent) {
    if (dragStartY === null) return;
    const dy = e.touches[0].clientY - dragStartY;
    dragDeltaY = Math.max(0, dy);
  }
  function onHandleTouchEnd() {
    if (dragStartY === null || dragStartT === null) {
      dragDeltaY = 0;
      return;
    }
    const elapsed = performance.now() - dragStartT;
    // Dismiss if dragged >80px in <300ms (quick swipe) OR dragged >180px slowly.
    if ((dragDeltaY > 80 && elapsed < 300) || dragDeltaY > 180) {
      onClose();
    }
    dragStartY = null;
    dragStartT = null;
    dragDeltaY = 0;
  }

  function onBackdropClick() {
    onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onClose();
  }

  // Keyboard-aware height via visualViewport. Falls back to innerHeight when
  // visualViewport is unavailable (older browsers).
  let viewportHeight = $state(0);
  $effect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) {
      viewportHeight = window.innerHeight;
      return;
    }
    const update = () => {
      viewportHeight = vv.height;
    };
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  });

  // Lock body scroll while open so background doesn't move under the sheet.
  $effect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="sheet-root" use:portal role="presentation">
    <button
      class="backdrop"
      type="button"
      aria-label="Close"
      onclick={onBackdropClick}
    ></button>
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Bottom sheet'}
      style:max-height="min({maxHeightVh}vh, {viewportHeight || 0}px)"
      style:transform="translateY({dragDeltaY}px)"
    >
      <div
        class="handle-zone"
        ontouchstart={onHandleTouchStart}
        ontouchmove={onHandleTouchMove}
        ontouchend={onHandleTouchEnd}
        role="presentation"
      >
        <div class="handle"></div>
        {#if title}<div class="title">{title}</div>{/if}
      </div>
      <div class="body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .sheet-root {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    animation: fadeIn 200ms ease-out;
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: auto;
    background: var(--surface-elevated);
    border-radius: var(--radius-round) var(--radius-round) 0 0;
    border-top: 1px solid var(--card-border);
    display: flex;
    flex-direction: column;
    animation: slideUp 200ms ease-out;
    overflow: hidden;
    transition: transform 50ms linear;
  }
  .handle-zone {
    flex: 0 0 auto;
    padding: 8px 16px 12px;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .handle {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--divider);
    margin: 0 auto 8px;
  }
  .title {
    text-align: center;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0 16px 16px;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
</style>
