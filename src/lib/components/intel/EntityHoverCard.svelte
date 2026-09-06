<script lang="ts">
  // The single floating entity card. Mount once per page that renders chat.
  //
  // Positions itself against the mention that triggered it, flipping above or
  // sideways when it would fall off-screen. Portalled to <body> so it is never
  // clipped by the chat column's overflow.

  import { onMount, untrack } from 'svelte';
  import EntityCard from './EntityCard.svelte';
  import RelationshipModal from './RelationshipModal.svelte';
  import { portal } from '$lib/canvas/portal';
  import { dragPanel } from '$lib/actions/drag-panel';
  import { entityHover, computeHoverLayout, constrainPanel, CARD_W, type HoverAnchor } from './entity-hover.svelte';
  import { commission } from '$lib/jkai/intel/entity-card-store';
  import { goto } from '$app/navigation';

  let host = $state<HTMLDivElement | null>(null);
  let height = $state(300);
  let busy = $state(false);

  // Positioning reads the viewport, so it has to be reactive or the card stays
  // where it was when the window changes size under it.
  let viewport = $state({
    w: typeof window === 'undefined' ? 1200 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  });

  /** Open relationship, as [from, to]. Clicking a name under "Connected to"
   *  used to navigate to /jkai/intel/network, which does not exist and 404'd;
   *  a relationship is small enough to read in an overlay and leaves the
   *  conversation where it was. */
  let relation = $state<{ from: string; to: string } | null>(null);

  const anchor = $derived(entityHover.current);

  // Measure after render so the flip decision uses the real height.
  //
  // The comparison READS `height` and the branch WRITES it, which is exactly the
  // cycle shape rule 1 of the svelte5-pitfalls skill warns about. The tracked
  // dependencies are hoisted (anchor, host) and the read+write pair is wrapped
  // in untrack, so the effect cannot re-trigger itself.
  $effect(() => {
    const a = anchor;
    const el = host;
    if (!a || !el) return;

    // EntityCard fetches its content asynchronously, so measuring once on mount
    // captures the height of the "Loading…" state and the above/below flip is
    // then decided on a number that is about to change. A ResizeObserver keeps
    // the measurement honest as the real content arrives.
    const measure = () =>
      untrack(() => {
        const scroll = el.querySelector<HTMLElement>('.scroll');
        // Measure the uncapped content, otherwise a short loading card can
        // become trapped below its anchor after the real details arrive.
        const h = scroll ? el.offsetHeight - scroll.clientHeight + scroll.scrollHeight : el.offsetHeight;
        if (h && Math.abs(h - height) > 1) height = h;
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const content = el.querySelector('.entity-card');
    if (content) ro.observe(content);
    return () => ro.disconnect();
  });

  // A move belongs to this opening, so switching entities starts at its own anchor.
  let moved = $state<{ anchor: HoverAnchor; left: number; top: number; maxHeight: number } | null>(null);
  const manual = $derived(moved?.anchor === anchor ? moved : null);
  const width = $derived(Math.min(CARD_W, Math.max(0, viewport.w - 24)));

  function move(position: { left: number; top: number }) {
    if (!anchor || !host) return;
    const bounded = constrainPanel(position, { w: host.offsetWidth, h: host.offsetHeight }, viewport);
    moved = { anchor, ...bounded, maxHeight: manual?.maxHeight ?? layout.maxHeight };
  }

  // Pure maths, so it is unit-tested in entity-hover.layout.test.ts rather than
  // eyeballed against a live chat.
  const layout = $derived(
    manual
      ? { ...constrainPanel(manual, { w: width, h: Math.min(height, manual.maxHeight, viewport.h - 24) }, viewport),
          maxHeight: Math.max(0, Math.min(manual.maxHeight, viewport.h - 24)), placement: 'overlay' as const, bottom: undefined }
      : anchor
      ? computeHoverLayout(anchor.rect, height, viewport)
      : { top: 0, left: 0, maxHeight: 0, placement: 'below' as const },
  );

  // Exactly one vertical anchor is set; 'above' uses `bottom` so the card grows
  // upward instead of sliding down over the mention.
  const vStyle = $derived(
    layout.bottom !== undefined ? `bottom: ${layout.bottom}px` : `top: ${layout.top ?? 0}px`,
  );

  async function onCommission(kind: string, payload: string, entityIds: string[]) {
    if (busy) return;
    busy = true;
    try {
      const result = await commission(kind, payload, entityIds);
      entityHover.close();
      await goto(result.url);
    } catch (err) {
      console.error('[intel] commission failed:', err);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') entityHover.close();
    };
    const onScroll = (e: Event) => {
      // Scrolling INSIDE the card must not dismiss it — that is the whole point
      // of capping the height. This listener is on window with capture:true, so
      // it sees scroll from every element, including the card's own overflow.
      const t = e.target;
      if (host && t instanceof Node && host.contains(t)) return;
      // Page scroll is different: the card is anchored to a viewport rect, which
      // scrolling invalidates.
      if (entityHover.current && !entityHover.current.pinned) entityHover.close();
    };
    const onResize = () => {
      viewport = { w: window.innerWidth, h: window.innerHeight };
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  });
</script>

{#if anchor}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={host}
    use:portal
    use:dragPanel={{ handle: '.drag-handle', move, reset: () => (moved = null) }}
    class="hover-card"
    class:pinned={anchor.pinned}
    style="{vStyle}; left: {layout.left}px; width: {width}px; max-height: {layout.maxHeight}px;"
    onmouseenter={() => entityHover.keepOpen()}
    onmouseleave={() => entityHover.release()}
    role="dialog"
    aria-label="Entity details"
  >
    {#if anchor.pinned}
      <div class="toolbar">
        <button class="drag-handle" type="button" aria-label="Move entity details"
          title="Drag to move · Arrow keys move · Shift moves faster · Home resets position">
          <span aria-hidden="true">⠿</span> Entity details <span class="drag-hint">Drag to move</span>
        </button>
        <button class="close" type="button" onclick={() => entityHover.close()} aria-label="Close">×</button>
      </div>
    {/if}
    <!-- The scroller is INSIDE the positioned host so the close button stays put
         while the content moves under it. -->
    <div class="scroll">
      <EntityCard
        entityId={anchor.entityId}
        compact={!anchor.pinned}
        onCommission={anchor.pinned ? onCommission : undefined}
        onFocus={(id) => (relation = { from: anchor.entityId, to: id })}
      />
    </div>
  </div>
{/if}

{#if relation}
  <RelationshipModal
    fromEntityId={relation.from}
    toEntityId={relation.to}
    onClose={() => (relation = null)}
    onOpenEntity={(id) => (relation = relation ? { from: relation.to, to: id } : null)}
  />
{/if}

<style>
  .hover-card {
    position: fixed;
    z-index: 90;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    box-shadow: var(--elev-pop);
    animation: card-in var(--t-fast) var(--ease-out);
  }
  .hover-card.pinned {
    z-index: 95;
  }

  .toolbar {
    display: flex;
    flex: none;
    align-items: stretch;
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 2px solid var(--accent);
  }
  .drag-handle {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .hover-card[data-dragging] .drag-handle { cursor: grabbing; }
  .drag-hint {
    margin-left: auto;
    text-transform: none;
    letter-spacing: normal;
    color: var(--accent-on-dark);
  }
  .drag-handle:focus-visible, .close:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: -3px;
  }
  .scroll {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--card-border) transparent;
  }
  .scroll :global(.entity-card) {
    background: none;
    border: 0;
    border-radius: 0;
    /* The shell is already CARD_W wide and the card's own 420px cap would fight
       it, leaving the surface wider than the content it frames. */
    max-width: none;
  }
  .scroll::-webkit-scrollbar {
    width: 6px;
  }
  .scroll::-webkit-scrollbar-thumb {
    background: var(--card-border);
    border-radius: var(--radius-round);
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hover-card {
      animation: none;
    }
  }

  .close {
    flex: none;
    width: 34px;
    min-height: 34px;
    line-height: 1;
    font-size: var(--fs-body-lg);
    border: 0;
    border-left: 1px solid color-mix(in srgb, var(--bg) 25%, transparent);
    background: transparent;
    color: var(--bg);
    cursor: pointer;
  }
  .close:hover { color: var(--accent-on-dark); }
</style>
