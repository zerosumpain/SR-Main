<script lang="ts">
  // The deck player. Linear ←/→ walks the current plane; Enter dives into a
  // slide's sub-deck; Escape rises back out; the end of a sub-deck spills to
  // the parent's next slide. All camera moves in transitions.ts. Runes only;
  // timer/pointer internals are plain lets (svelte5-pitfalls rule 1).
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import DeckShell from '$lib/components/presentation/DeckShell.svelte';
  import SlideView from '$lib/components/presentation/SlideView.svelte';
  import { breadcrumb, nextSlide, prevSlide, zoomIn as navZoomIn } from '$lib/presentation/navigation';
  import { slideIn, slideOut, type MoveKind } from '$lib/presentation/transitions';

  let { data } = $props();

  let current = $state(data.startId);
  let moveKind = $state<MoveKind>('next');
  let chromeVisible = $state(true);

  // non-reactive internals
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let touchX = 0;
  let touchY = 0;
  let shell: HTMLElement | undefined = $state();

  const byId = $derived(new Map(data.slides.map((s) => [s.id, s])));
  const slide = $derived(byId.get(current) ?? data.slides[0]);
  const chain = $derived(breadcrumb(data.slides, current));
  const depth = $derived(chain.length - 1);
  const plane = $derived(
    data.slides
      .filter((s) => s.parentSlideId === (slide?.parentSlideId ?? null))
      .sort((a, b) => a.position - b.position),
  );
  const planeIdx = $derived(plane.findIndex((s) => s.id === current));
  const childCount = $derived(data.slides.filter((s) => s.parentSlideId === current).length);
  const parentTitle = $derived(
    depth > 0 ? (byId.get(chain[chain.length - 2])?.title ?? 'overview') : null,
  );
  // Slides hosting an interactive (sim orbit-drags, iframes) keep the pointer
  // to themselves: no swipe nav, no invisible edge click-zones.
  const hasInteractive = $derived(slide.blocks.some((b) => b.type === 'embed' || b.type === 'iframe'));

  function goTo(id: string, kind: MoveKind) {
    moveKind = kind;
    current = id;
    const url = new URL(page.url);
    url.searchParams.set('s', id);
    replaceState(url, {});
    wakeChrome();
  }

  function next() {
    const mv = nextSlide(data.slides, current);
    if (mv) goTo(mv.id, mv.move === 'zoomOut' ? 'zoomOut' : 'next');
  }
  function prev() {
    const mv = prevSlide(data.slides, current);
    if (mv) goTo(mv.id, mv.move === 'zoomOut' ? 'zoomOut' : 'prev');
  }
  function dive() {
    const child = navZoomIn(data.slides, current);
    if (child) goTo(child, 'zoomIn');
  }
  function rise() {
    if (depth > 0) goTo(chain[chain.length - 2], 'zoomOut');
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell?.requestFullscreen?.();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    switch (e.key) {
      case 'ArrowRight':
      case ' ':
      case 'PageDown':
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        prev();
        break;
      case 'Enter':
      case 'ArrowDown':
        if (childCount > 0) {
          e.preventDefault();
          dive();
        }
        break;
      case 'Escape':
        // let the browser consume Escape for real fullscreen; otherwise rise
        if (!document.fullscreenElement) rise();
        break;
      case 'f':
        toggleFullscreen();
        break;
    }
  }

  function onPointerDown(e: PointerEvent) {
    touchX = e.clientX;
    touchY = e.clientY;
  }
  function onPointerUp(e: PointerEvent) {
    if (hasInteractive) return; // an orbit-drag on the sim is not a swipe
    const target = e.target as HTMLElement | null;
    if (target?.closest('a, button, iframe')) return;
    const dx = e.clientX - touchX;
    const dy = e.clientY - touchY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next();
      else prev();
    }
  }

  function wakeChrome() {
    chromeVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (chromeVisible = false), 3500);
  }

  onMount(() => {
    wakeChrome();
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
    };
  });
</script>

<svelte:head>
  <title>{data.deck.title} — sr. decks</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onKeydown} />

{#key data.deck.id}
  <DeckShell theme={data.deck.theme}>
    <div
      class="player"
      role="presentation"
      bind:this={shell}
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
      onpointermove={wakeChrome}
    >
      <div class="stage-wrap">
        {#key current}
          <div class="stage" in:slideIn={{ move: moveKind }} out:slideOut={{ move: moveKind }}>
            <SlideView {slide} />
          </div>
        {/key}
      </div>

      <header class="chrome chrome-top" class:hidden={!chromeVisible}>
        <span class="deck-title">{data.deck.title}</span>
        {#if depth > 0}
          <button class="crumb" onclick={rise} title="Back up (Esc)">↩ {parentTitle}</button>
        {/if}
      </header>

      <footer class="chrome chrome-bottom" class:hidden={!chromeVisible}>
        <span class="hint">← → move · {childCount > 0 ? '↵ dive · ' : ''}{depth > 0 ? 'esc rise · ' : ''}f fullscreen</span>
        <span class="progress">
          {#if depth > 0}<span class="depth">{'·'.repeat(depth)} </span>{/if}
          {String(planeIdx + 1).padStart(2, '0')} / {String(plane.length).padStart(2, '0')}
        </span>
      </footer>

      {#if childCount > 0}
        <button class="chrome dive-pill" class:hidden={!chromeVisible} onclick={dive}>
          ⤵ dive — {childCount} slide{childCount === 1 ? '' : 's'} inside
        </button>
      {/if}

      {#if !hasInteractive}
        <button class="zone zone-left" aria-label="Previous slide" onclick={prev}></button>
        <button class="zone zone-right" aria-label="Next slide" onclick={next}></button>
      {/if}
    </div>
  </DeckShell>
{/key}

<style>
  .player {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: hidden;
  }
  .stage-wrap {
    position: absolute;
    inset: 0;
  }
  .stage {
    position: absolute;
    inset: 0;
    will-change: transform, opacity;
  }

  .chrome {
    position: absolute;
    z-index: 10;
    transition: opacity 0.5s ease;
    opacity: 1;
  }
  .chrome.hidden { opacity: 0; pointer-events: none; }

  .chrome-top {
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 20px;
  }
  .deck-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .crumb {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-ink);
    background: var(--accent-ink-tint-12);
    border: none;
    border-radius: var(--radius-pill);
    padding: 5px 12px;
    cursor: pointer;
  }
  .crumb:hover { background: var(--accent-ink-tint-35); }

  .chrome-bottom {
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
  }
  .hint,
  .progress {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .depth { color: var(--accent-ink); letter-spacing: 0.3em; }

  .dive-pill {
    bottom: 46px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--paper);
    background: var(--accent-ink);
    border: none;
    border-radius: var(--radius-pill);
    padding: 8px 16px;
    cursor: pointer;
  }
  .dive-pill:hover { background: var(--accent-ink-hover); }

  .zone {
    position: absolute;
    z-index: 5;
    top: 15%;
    bottom: 15%;
    width: 12%;
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0;
  }
  .zone-left { left: 0; }
  .zone-right { right: 0; }

  @media (max-width: 760px) {
    .hint { display: none; }
    .zone { width: 18%; }
  }
</style>
