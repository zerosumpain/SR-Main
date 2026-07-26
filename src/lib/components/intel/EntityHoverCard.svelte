<script lang="ts">
  // The single floating entity card. Mount once per page that renders chat.
  //
  // Positions itself against the mention that triggered it, flipping above or
  // sideways when it would fall off-screen. Portalled to <body> so it is never
  // clipped by the chat column's overflow.

  import { onMount, untrack } from 'svelte';
  import EntityCard from './EntityCard.svelte';
  import { entityHover } from './entity-hover.svelte';
  import { commission } from '$lib/jkai/intel/entity-card-store';
  import { goto } from '$app/navigation';

  const CARD_W = 380;
  const GAP = 10;
  const MARGIN = 12;

  let host = $state<HTMLDivElement | null>(null);
  let height = $state(300);
  let busy = $state(false);

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

  const position = $derived.by(() => {
    if (!anchor) return { top: 0, left: 0 };
    const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight;

    let left = anchor.rect.left;
    if (left + CARD_W + MARGIN > vw) left = vw - CARD_W - MARGIN;
    if (left < MARGIN) left = MARGIN;

    // Prefer below; flip above when there isn't room and there is above.
    const below = anchor.rect.bottom + GAP;
    const above = anchor.rect.top - GAP - height;
    const top = below + height + MARGIN > vh && above > MARGIN ? above : below;

    return { top: Math.max(MARGIN, top), left };
  });

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
    const onScroll = () => {
      // The card is anchored to a viewport rect; scrolling invalidates it.
      if (entityHover.current && !entityHover.current.pinned) entityHover.close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  });
</script>

{#if anchor}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={host}
    class="hover-card"
    class:pinned={anchor.pinned}
    style="top: {position.top}px; left: {position.left}px; width: {CARD_W}px;"
    onmouseenter={() => entityHover.keepOpen()}
    onmouseleave={() => entityHover.release()}
    role="dialog"
    aria-label="Entity details"
  >
    {#if anchor.pinned}
      <button class="close" type="button" onclick={() => entityHover.close()} aria-label="Close">×</button>
    {/if}
    <EntityCard
      entityId={anchor.entityId}
      compact={!anchor.pinned}
      onCommission={anchor.pinned ? onCommission : undefined}
      onFocus={(id) => goto(`/jkai/intel/network?focus=${id}`)}
    />
  </div>
{/if}

<style>
  .hover-card {
    position: fixed;
    z-index: 90;
    /* Opaque background lives on EntityCard; this only positions and frames. */
    border-radius: var(--radius-round);
    animation: card-in var(--t-fast) var(--ease-out);
  }
  .hover-card.pinned {
    z-index: 95;
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
    right: 6px;
    z-index: 1;
    width: 22px;
    height: 22px;
    line-height: 1;
    font-size: 16px;
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
