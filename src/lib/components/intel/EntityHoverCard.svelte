<script lang="ts">
  // The single floating entity card. Mount once per page that renders chat.
  //
  // Positions itself against the mention that triggered it, flipping above or
  // sideways when it would fall off-screen. Portalled to <body> so it is never
  // clipped by the chat column's overflow.

  import { onMount, untrack } from 'svelte';
  import EntityCard from './EntityCard.svelte';
  import RelationshipModal from './RelationshipModal.svelte';
  import { entityHover, computeHoverLayout, CARD_W } from './entity-hover.svelte';
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
        const h = el.offsetHeight;
        if (h && Math.abs(h - height) > 4) height = h;
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Pure maths, so it is unit-tested in entity-hover.layout.test.ts rather than
  // eyeballed against a live chat.
  const layout = $derived(
    anchor
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
    class="hover-card"
    class:pinned={anchor.pinned}
    style="{vStyle}; left: {layout.left}px; width: {CARD_W}px;"
    onmouseenter={() => entityHover.keepOpen()}
    onmouseleave={() => entityHover.release()}
    role="dialog"
    aria-label="Entity details"
  >
    {#if anchor.pinned}
      <button class="close" type="button" onclick={() => entityHover.close()} aria-label="Close">×</button>
    {/if}
    <!-- The scroller is INSIDE the positioned host so the close button stays put
         while the content moves under it. -->
    <div class="scroll" style="max-height: {layout.maxHeight}px;">
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
    /* Positions only. The surface is on `.scroll` — see below. */
    animation: card-in var(--t-fast) var(--ease-out);
  }
  .hover-card.pinned {
    z-index: 95;
  }

  /*
   * THE SCROLLER IS THE CARD.
   *
   * These were two elements: `.scroll` owned the overflow, and the opaque
   * background, border and radius lived on EntityCard INSIDE it. So the
   * scrollbar was painted on a transparent parent — it appeared in a gutter
   * beside the card rather than within it, and the card's own border scrolled
   * away with the content. It read as a scrollbar detached from the modal,
   * because it was.
   *
   * Giving the surface to the element that actually scrolls puts the scrollbar
   * inside the opaque, bordered box and pins the border in place. The inner
   * card then drops its own surface, or there would be two nested frames.
   */
  .scroll {
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    /* Stop a flick at the end of the card scrolling the chat behind it — which
       would then fire the page-scroll handler and dismiss the card. */
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
    position: absolute;
    top: 6px;
    /* Clears the scroller's 6px gutter so the two never overlap. */
    right: 12px;
    z-index: 1;
    width: 22px;
    height: 22px;
    line-height: 1;
    font-size: var(--fs-body);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--surface-elevated);
    color: var(--text-muted);
    cursor: pointer;
  }
  .close:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
</style>
