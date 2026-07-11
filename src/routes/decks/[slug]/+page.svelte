<script lang="ts">
  // The deck player. Linear ←/→ walks the current plane; Enter dives into a
  // slide's sub-deck; Escape rises back out; the end of a sub-deck spills to
  // the parent's next slide. All camera moves in transitions.ts. Runes only;
  // timer/pointer internals are plain lets (svelte5-pitfalls rule 1).
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import DeckShell from '$lib/components/presentation/DeckShell.svelte';
  import MiniSlide from '$lib/components/presentation/MiniSlide.svelte';
  import SlideView from '$lib/components/presentation/SlideView.svelte';
  import { breadcrumb, nextSlide, prevSlide, zoomIn as navZoomIn } from '$lib/presentation/navigation';
  import { slideIn, slideOut, type MoveKind, type ZoomAnchor } from '$lib/presentation/transitions';

  let { data } = $props();

  let current = $state(data.startId);
  let moveKind = $state<MoveKind>('next');
  let zoomAnchor = $state<ZoomAnchor | null>(null);
  let chromeVisible = $state(true);

  // non-reactive internals
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let touchX = 0;
  let touchY = 0;
  let shell: HTMLElement | undefined = $state();
  let miniEl: HTMLElement | undefined;
  // Remembers where each parent's mini-slide card sat, so rising back out of a
  // sub-deck can shrink the slide into the same spot.
  const anchorByParent = new Map<string, ZoomAnchor>();

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
  const children = $derived(
    data.slides.filter((s) => s.parentSlideId === current).sort((a, b) => a.position - b.position),
  );
  const childCount = $derived(children.length);
  const firstChild = $derived(children[0] ?? null);
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

  /** Where the mini-slide card sits right now (also memoised for the rise). */
  function captureAnchor(): ZoomAnchor | null {
    if (!miniEl) return null;
    const r = miniEl.getBoundingClientRect();
    const anchor: ZoomAnchor = {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: r.width,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
    anchorByParent.set(current, anchor);
    return anchor;
  }

  function next() {
    const mv = nextSlide(data.slides, current);
    if (!mv) return;
    // Spilling out of a sub-deck lands on the parent's NEXT sibling — no card
    // to anchor to there, so use the centered zoom-out.
    zoomAnchor = null;
    goTo(mv.id, mv.move === 'zoomOut' ? 'zoomOut' : 'next');
  }
  function prev() {
    const mv = prevSlide(data.slides, current);
    if (!mv) return;
    zoomAnchor = mv.move === 'zoomOut' ? (anchorByParent.get(mv.id) ?? null) : null;
    goTo(mv.id, mv.move === 'zoomOut' ? 'zoomOut' : 'prev');
  }
  function dive() {
    const child = navZoomIn(data.slides, current);
    if (!child) return;
    zoomAnchor = captureAnchor();
    goTo(child, 'zoomIn');
  }
  function rise() {
    if (depth === 0) return;
    const parent = chain[chain.length - 2];
    zoomAnchor = anchorByParent.get(parent) ?? null;
    goTo(parent, 'zoomOut');
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
          <div
            class="stage"
            in:slideIn={{ move: moveKind, anchor: zoomAnchor }}
            out:slideOut={{ move: moveKind, anchor: zoomAnchor }}
          >
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

      {#if firstChild}
        {#key current}
          <button class="mini-door" bind:this={miniEl} onclick={dive} title="Dive in (Enter)">
            <MiniSlide slide={firstChild} />
            <span class="md-label">
              <span class="md-count">↵ dive — {childCount} slide{childCount === 1 ? '' : 's'} inside</span>
            </span>
          </button>
        {/key}
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
    /* Paint the paper here too: this element is what goes fullscreen, and a
       transparent fullscreen element renders on the browser's black backdrop. */
    background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255, 255, 255, 0.4), transparent 60%), var(--paper);
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

  .mini-door {
    position: absolute;
    z-index: 12;
    right: clamp(14px, 3vw, 40px);
    bottom: clamp(48px, 8vh, 72px);
    width: clamp(200px, 24vw, 340px);
    padding: 0;
    background: var(--paper);
    border: 2px solid var(--accent-ink);
    border-radius: var(--radius-round);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.25s ease, border-color 0.25s ease;
  }
  .mini-door:hover { transform: scale(1.04); border-color: var(--accent-ink-hover); }
  .mini-door:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .md-label {
    display: block;
    background: var(--accent-ink);
    padding: 7px 10px;
    text-align: center;
  }
  .md-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--paper);
  }
  @media (prefers-reduced-motion: no-preference) {
    .mini-door { animation: door-breathe 2.6s ease-in-out infinite; }
  }
  @keyframes door-breathe {
    0%, 100% { border-color: var(--accent-ink); }
    50% { border-color: var(--accent); }
  }
  @media (max-width: 760px) {
    .mini-door { width: 46vw; bottom: 58px; }
  }

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
