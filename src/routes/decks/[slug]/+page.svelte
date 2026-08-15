<script lang="ts">
  // The deck player. The deck is a 2D field: the main pathway runs left→right;
  // a slide with children advertises a side journey with a floating pill
  // (down off the main path, right off a vertical journey — planes alternate
  // axis by depth). Arrows walk the current plane; the free axis enters the
  // journey; ↑/← past the first slide (or Escape) climbs back the way you
  // came. The nav map (bottom left) shows the whole active path and jumps.
  // Runes only; timer/pointer internals are plain lets (svelte5-pitfalls §1).
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import DeckShell from '$lib/components/presentation/DeckShell.svelte';
  import SlideView from '$lib/components/presentation/SlideView.svelte';
  import TransitionFx from '$lib/components/presentation/TransitionFx.svelte';
  import type { EffectBlock } from '$lib/presentation/types';
  import { isWipe, VEIL_WIPES, type EffectTint, type Zone } from '$lib/presentation/effects';
  import {
    branchTravel,
    buildPlanes,
    exitBranch,
    jumpTravel,
    pathTo,
    planeAxis,
    resolveArrow,
    windowStrip,
    type ArrowKey,
    type Travel,
  } from '$lib/presentation/navigation';
  import { maxStep, stepArrow } from '$lib/presentation/steps';
  import { slideIn, slideOut } from '$lib/presentation/transitions';
  import { STAGE_H, STAGE_W } from '$lib/presentation/types';

  let { data } = $props();

  let current = $state(data.startId);
  /** Build-step cursor within the current slide (0 = only unstaged blocks). */
  let stepIndex = $state(0);
  /** Stage host size — drives the uniform scale of the fixed 1280×720 canvas. */
  let hostW = $state(0);
  let hostH = $state(0);
  let travel = $state<Travel>('right');
  let major = $state(false);
  /** Active wipe effect id for the current move (null = plain glide/sweep). */
  let wiping = $state<string | null>(null);
  let chromeVisible = $state(true);
  /** Nav-map position once the user has dragged it; null = the CSS default
   *  (bottom left). Persisted so it stays out of the content's way. */
  let mapPos = $state<{ x: number; y: number } | null>(null);

  /** The transition-role effect playing over the current camera move. */
  let fx = $state<{ effect: EffectBlock; travel: Travel; key: number; zones: Zone[] } | null>(null);

  // non-reactive internals
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let trackedSlides = new Set<string>();
  let touchX = 0;
  let touchY = 0;
  let wheelLock = 0;
  let fxKey = 0;
  let shell: HTMLElement | undefined = $state();
  let mapEl: HTMLElement | undefined;
  let mapDrag: { px: number; py: number; x: number; y: number } | null = null;
  let mapDragMoved = false;
  let dragResetTimer: ReturnType<typeof setTimeout> | null = null;

  const MAP_POS_KEY = 'sr-decks-navmap-pos';

  const byId = $derived(new Map(data.slides.map((s) => [s.id, s])));
  const slide = $derived(byId.get(current) ?? data.slides[0]);
  const planes = $derived(buildPlanes(data.slides));
  const chain = $derived(pathTo(data.slides, current));
  const depth = $derived(chain.length - 1);
  const axis = $derived(planeAxis(depth));
  const plane = $derived(planes.get(slide?.parentSlideId ?? null) ?? []);
  const planeIdx = $derived(plane.indexOf(current));
  const children = $derived(planes.get(current) ?? []);
  const childCount = $derived(children.length);
  const pillTravel = $derived(branchTravel(depth));
  const pillLabel = $derived(
    slide?.journeyLabel ?? byId.get(children[0] ?? '')?.title ?? `${childCount} more`,
  );
  // Slides hosting an interactive (sim orbit-drags, iframes, video controls)
  // keep the pointer to themselves: no swipe nav, no invisible edge click-zones.
  const hasInteractive = $derived(
    slide.blocks.some((b) => b.type === 'embed' || b.type === 'iframe' || b.type === 'video'),
  );
  const stepMax = $derived(maxStep(slide?.blocks ?? []));
  /** Uniform scale fitting the fixed design canvas into the window. Hidden
   *  until measured so the first paint never flashes unscaled. */
  const stageScale = $derived(hostW && hostH ? Math.min(hostW / STAGE_W, hostH / STAGE_H) : 0);

  // Nav-map strips along the active path: the root row, then one strip per
  // branch level. Each strip is WINDOWED — one dot behind the on-path dot and
  // up to four ahead, ellipses marking the cut — so long planes and nested
  // journeys never balloon the map.
  const mapStrips = $derived.by(() => {
    const strips: {
      axis: 'h' | 'v';
      ids: string[];
      leading: boolean;
      trailing: boolean;
      /** Rendered cell index (incl. the leading ellipsis cell) of this
       *  level's on-path dot — anchors the child strip. */
      activeRender: number;
    }[] = [];
    for (let d = 0; d <= Math.min(depth, 2); d++) {
      const planeIds = planes.get(d === 0 ? null : chain[d - 1]) ?? [];
      const activeIdx = Math.max(0, planeIds.indexOf(chain[d]));
      const win = windowStrip(planeIds.length, activeIdx);
      strips.push({
        axis: planeAxis(d),
        ids: planeIds.slice(win.start, win.end),
        leading: win.leading,
        trailing: win.trailing,
        activeRender: (win.leading ? 1 : 0) + (activeIdx - win.start),
      });
    }
    return strips;
  });

  function goTo(id: string, t: Travel, isMajor: boolean) {
    travel = t;
    major = isMajor;
    const fxBlock = (byId.get(id)?.blocks.find(
      (b) => b.type === 'effect' && (b as EffectBlock).role === 'transition',
    ) ?? null) as EffectBlock | null;
    wiping = fxBlock && isWipe(fxBlock.effect) ? fxBlock.effect : null;
    // melt/shatter spawn their particles from the OUTGOING content — capture
    // the block rects before the slide switches out from under us
    let zones: Zone[] = [];
    if (wiping && VEIL_WIPES.has(wiping) && shell) {
      const host = shell.getBoundingClientRect();
      zones = Array.from(shell.querySelectorAll<HTMLElement>('.stage .block')).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
      });
    }
    fx = fxBlock ? { effect: fxBlock, travel: t, key: ++fxKey, zones } : null;
    current = id;
    // Forward arrivals start a staged slide unrevealed; walking back (or a
    // map jump upward/leftward) lands with the page as you left it — built.
    stepIndex = t === 'right' || t === 'down' ? 0 : maxStep(byId.get(id)?.blocks ?? []);
    trackSlide(id);
    const url = new URL(page.url);
    url.searchParams.set('s', id);
    replaceState(url, {});
    wakeChrome();
  }

  function arrow(key: ArrowKey) {
    // Build steps intercept the plane axis: forward reveals the next staged
    // block, backward re-hides — navigation resumes past either end.
    const act = stepArrow(axis, key, stepIndex, stepMax);
    if (act) {
      stepIndex += act === 'reveal' ? 1 : -1;
      wakeChrome();
      return;
    }
    const mv = resolveArrow(data.slides, current, key);
    if (!mv) return;
    const depthChanged = pathTo(data.slides, mv.id).length !== chain.length;
    goTo(mv.id, mv.travel, depthChanged);
  }

  /** Share-viewer telemetry: beacon each slide once per session so the owner
   *  can see how far a share link actually got. Owner/public views are not
   *  tracked — only via-share sessions, attributed by the share cookie. */
  function trackSlide(id: string) {
    if (!data.viaShare || trackedSlides.has(id)) return;
    trackedSlides.add(id);
    // Under /decks (not /api) so the path-scoped share cookie rides along.
    const url = `/decks/${data.deck.slug}/track`;
    const body = JSON.stringify({ slideId: id });
    try {
      if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) {
        void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch {
      /* telemetry must never break navigation */
    }
  }

  function exit() {
    const mv = exitBranch(data.slides, current);
    if (!mv) return;
    goTo(mv.id, mv.travel, true);
  }

  function jump(id: string) {
    if (id === current) return;
    const isMajor = pathTo(data.slides, id).length !== chain.length;
    goTo(id, jumpTravel(data.slides, current, id), isMajor);
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
        e.preventDefault();
        arrow('right');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        arrow('left');
        break;
      case 'ArrowDown':
        e.preventDefault();
        arrow('down');
        break;
      case 'ArrowUp':
        e.preventDefault();
        arrow('up');
        break;
      case ' ':
      case 'PageDown':
        e.preventDefault();
        arrow(axis === 'h' ? 'right' : 'down');
        break;
      case 'PageUp':
        e.preventDefault();
        arrow(axis === 'h' ? 'left' : 'up');
        break;
      case 'Enter':
        if (childCount > 0) {
          e.preventDefault();
          arrow(pillTravel);
        }
        break;
      case 'Escape':
        // let the browser consume Escape for real fullscreen; otherwise exit
        if (!document.fullscreenElement) exit();
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
    if (target?.closest('a, button, iframe, video')) return;
    const dx = e.clientX - touchX;
    const dy = e.clientY - touchY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      arrow(dx < 0 ? 'right' : 'left');
    } else if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      arrow(dy < 0 ? 'down' : 'up');
    }
  }

  /** Scroll wheel walks the deck: plain wheel = left/right along the main
   *  axis, shift+wheel = up/down. Cooldown keeps one notch = one slide;
   *  wheels over live embeds/iframes are theirs (sim zoom etc.). */
  function onWheel(e: WheelEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('iframe, canvas, video')) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 12) return;
    wheelLock = now + 650;
    if (e.shiftKey) arrow(d > 0 ? 'down' : 'up');
    else arrow(d > 0 ? 'right' : 'left');
  }

  function wakeChrome() {
    chromeVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (chromeVisible = false), 3500);
  }

  // --- nav-map drag: click-and-drag it anywhere it isn't in the way. A drag
  // only starts after 5px of travel, so the dots stay clickable; a finished
  // drag suppresses the trailing click. Position clamps to the player.
  function clampPos(x: number, y: number): { x: number; y: number } {
    const host = shell?.getBoundingClientRect();
    const map = mapEl?.getBoundingClientRect();
    if (!host || !map) return { x, y };
    return {
      x: Math.min(Math.max(x, 6), Math.max(6, host.width - map.width - 6)),
      y: Math.min(Math.max(y, 6), Math.max(6, host.height - map.height - 6)),
    };
  }

  function onMapPointerDown(e: PointerEvent) {
    e.stopPropagation(); // not a slide swipe
    const host = shell?.getBoundingClientRect();
    const map = mapEl?.getBoundingClientRect();
    if (!host || !map) return;
    mapDrag = { px: e.clientX, py: e.clientY, x: map.left - host.left, y: map.top - host.top };
    mapDragMoved = false;
    mapEl?.setPointerCapture(e.pointerId);
  }
  function onMapPointerMove(e: PointerEvent) {
    if (!mapDrag) return;
    const dx = e.clientX - mapDrag.px;
    const dy = e.clientY - mapDrag.py;
    if (!mapDragMoved && Math.hypot(dx, dy) < 5) return;
    mapDragMoved = true;
    mapPos = clampPos(mapDrag.x + dx, mapDrag.y + dy);
  }
  function onMapPointerUp(e: PointerEvent) {
    e.stopPropagation();
    if (!mapDrag) return;
    mapDrag = null;
    if (mapDragMoved) {
      try {
        localStorage.setItem(MAP_POS_KEY, JSON.stringify(mapPos));
      } catch {
        /* private mode */
      }
      // swallow the click that follows this drag
      if (dragResetTimer) clearTimeout(dragResetTimer);
      dragResetTimer = setTimeout(() => (mapDragMoved = false), 250);
    }
  }
  /** Dot/back clicks are ignored when they are the tail of a drag. */
  function mapClickGuard(): boolean {
    return mapDragMoved;
  }

  onMount(() => {
    wakeChrome();
    trackSlide(current);
    try {
      const raw = localStorage.getItem(MAP_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) mapPos = clampPos(p.x, p.y);
      }
    } catch {
      /* corrupt/blocked storage — default position */
    }
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      if (dragResetTimer) clearTimeout(dragResetTimer);
    };
  });
</script>

<svelte:head>
  <title>{data.deck.title} — sr. decks</title>
  <meta name="robots" content="noindex" />
  {#if data.deck.ogImage}
    <meta property="og:type" content="website" />
    <meta property="og:title" content={data.deck.title} />
    {#if data.deck.description}<meta property="og:description" content={data.deck.description} />{/if}
    <meta property="og:image" content={new URL(data.deck.ogImage, page.url.origin).href} />
    <meta name="twitter:card" content="summary_large_image" />
  {/if}
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
      onwheel={onWheel}
    >
      <div class="stage-wrap" bind:clientWidth={hostW} bind:clientHeight={hostH}>
        <!-- The fixed 1280×720 design canvas, uniformly scaled to fit: resizing
             the window scales the whole composition — the layout never reflows. -->
        <div
          class="stage-fixed"
          style:transform={`translate(-50%, -50%) scale(${stageScale || 1})`}
          style:visibility={stageScale ? 'visible' : 'hidden'}
        >
          {#key current}
            <div class="stage" in:slideIn={{ travel, major, wipe: wiping ?? undefined }} out:slideOut={{ travel, major, wipe: wiping ?? undefined }}>
              <SlideView {slide} revealStep={stepIndex} />
            </div>
          {/key}
        </div>
      </div>

      {#if fx}
        {#key fx.key}
          <TransitionFx
            mode={isWipe(fx.effect.effect) ? fx.effect.effect : 'sweep'}
            travel={fx.travel}
            tint={(fx.effect.tint ?? 'accent') as EffectTint}
            intensity={fx.effect.intensity ?? 0.5}
            zones={fx.zones}
            onDone={() => (fx = null)}
          />
        {/key}
      {/if}

      <header class="chrome chrome-top" class:hidden={!chromeVisible}>
        <span class="deck-title">{data.deck.title}</span>
      </header>

      {#if childCount > 0}
        {#key current}
          <button class="pill" class:right={pillTravel === 'right'} onclick={() => arrow(pillTravel)}>
            <span class="pill-arrow">{pillTravel === 'down' ? '↓' : '→'}</span>
            {pillTravel === 'down' ? 'down' : 'right'} for {pillLabel}
          </button>
        {/key}
      {/if}

      <nav
        class="navmap"
        class:hidden={!chromeVisible && depth === 0}
        class:moved={mapPos !== null}
        style:left={mapPos ? `${mapPos.x}px` : undefined}
        style:top={mapPos ? `${mapPos.y}px` : undefined}
        aria-label="Deck map (drag to move)"
        bind:this={mapEl}
        onpointerdown={onMapPointerDown}
        onpointermove={onMapPointerMove}
        onpointerup={onMapPointerUp}
      >
        <span class="nm-grip" aria-hidden="true" title="Drag to move">⠿</span>
        {#snippet stripDots(strip: (typeof mapStrips)[number])}
          {#if strip.leading}<span class="nm-ell" aria-hidden="true">{strip.axis === 'v' ? '⋮' : '…'}</span>{/if}
          {#each strip.ids as id (id)}
            <button
              class="nm-dot"
              class:here={id === current}
              class:onpath={chain.includes(id) && id !== current}
              title={byId.get(id)?.title ?? ''}
              aria-label={byId.get(id)?.title ?? 'slide'}
              onclick={() => { if (!mapClickGuard()) jump(id); }}
            ></button>
          {/each}
          {#if strip.trailing}<span class="nm-ell" aria-hidden="true">{strip.axis === 'v' ? '⋮' : '…'}</span>{/if}
        {/snippet}
        <div class="nm-strip" class:vert={mapStrips[0].axis === 'v'}>
          {@render stripDots(mapStrips[0])}
        </div>
        {#if mapStrips.length > 1}
          <div class="nm-branch" style:margin-left={`${mapStrips[0].activeRender * 14}px`}>
            <div class="nm-strip" class:vert={mapStrips[1].axis === 'v'}>
              {@render stripDots(mapStrips[1])}
            </div>
            {#if mapStrips.length > 2}
              <div
                class="nm-strip"
                class:vert={mapStrips[2].axis === 'v'}
                style:margin-top={mapStrips[1].axis === 'v' ? `${mapStrips[1].activeRender * 14}px` : '0'}
              >
                {@render stripDots(mapStrips[2])}
              </div>
            {/if}
          </div>
        {/if}
        {#if depth > 0}
          <button class="nm-return" onclick={() => { if (!mapClickGuard()) jump(chain[0]); }}>↰ main track</button>
        {/if}
      </nav>

      <footer class="chrome chrome-bottom" class:hidden={!chromeVisible}>
        <span class="hint">
          {axis === 'h' ? '← → move' : '↑ ↓ move'} ·
          {childCount > 0 ? `${pillTravel === 'down' ? '↓' : '→'} side story · ` : ''}{depth > 0 ? 'esc back · ' : ''}f fullscreen
        </span>
        <span class="progress">
          {#if stepMax > 0}<span class="step-dots" aria-label="Build step {stepIndex} of {stepMax}">
            {#each Array.from({ length: stepMax }) as _, i (i)}<span class="step-dot" class:lit={i < stepIndex}></span>{/each}
          </span>{/if}
          {String(planeIdx + 1).padStart(2, '0')} / {String(plane.length).padStart(2, '0')}
        </span>
      </footer>

      {#if !hasInteractive}
        <button class="zone zone-left" aria-label="Previous slide" onclick={() => arrow('left')}></button>
        <button class="zone zone-right" aria-label="Next slide" onclick={() => arrow('right')}></button>
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
  .stage-fixed {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 1280px;
    height: 720px;
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
    font-size: var(--fs-label-xs);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  /* The journey pill — the invitation into a side story. Always visible. */
  .pill {
    position: absolute;
    z-index: 12;
    left: 50%;
    transform: translateX(-50%);
    bottom: clamp(44px, 7vh, 64px);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--paper);
    background: var(--accent-ink);
    border: none;
    border-radius: var(--radius-pill);
    padding: 8px 16px;
    cursor: pointer;
    transition: transform 0.2s ease;
  }
  .pill:hover { transform: translateX(-50%) scale(1.05); }
  .pill.right {
    left: auto;
    right: clamp(16px, 3vw, 40px);
    transform: none;
  }
  .pill.right:hover { transform: scale(1.05); }
  .pill-arrow { font-size: var(--fs-label); }
  @media (prefers-reduced-motion: no-preference) {
    .pill-arrow { animation: pill-nudge 2.2s ease-in-out infinite; }
  }
  @keyframes pill-nudge {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(3px); }
  }
  .pill.right .pill-arrow { animation-name: pill-nudge-x; }
  @keyframes pill-nudge-x {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(3px); }
  }

  /* Nav map — where you are in the 2D field, and the way back. Opaque panel
     (modal token rule: floating chrome never sits transparent over content);
     draggable anywhere via its own pointer handlers. */
  .navmap {
    position: absolute;
    z-index: 11;
    left: 20px;
    bottom: 44px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 12px 14px 10px;
    background: var(--paper-deep, var(--paper));
    border: 1px solid rgba(28, 22, 17, 0.22);
    border-radius: 4px;
    transition: opacity 0.5s ease;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .navmap:active { cursor: grabbing; }
  .navmap.moved { bottom: auto; }
  .navmap.hidden { opacity: 0; pointer-events: none; }
  .nm-grip {
    position: absolute;
    top: 2px;
    right: 6px;
    font-size: var(--fs-label-xs);
    color: var(--ink-soft);
    opacity: 0.7;
  }
  .nm-strip { display: flex; gap: 6px; }
  .nm-strip.vert { flex-direction: column; }
  .nm-branch { display: flex; align-items: flex-start; gap: 8px; }
  .nm-ell {
    width: 8px;
    height: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-label-xs);
    line-height: 1;
    color: var(--ink-soft);
    opacity: 0.75;
    pointer-events: none;
  }
  .nm-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
    border: 1.5px solid var(--ink-soft);
    background: none;
    padding: 0;
    cursor: pointer;
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  }
  .nm-dot:hover { transform: scale(1.35); border-color: var(--accent); }
  .nm-dot.here { background: var(--accent); border-color: var(--accent); }
  .nm-dot.onpath { border-color: var(--accent-ink); background: var(--accent-ink-tint-35); }
  .nm-return {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
    background: var(--accent-ink-tint-12);
    border: none;
    border-radius: var(--radius-pill);
    padding: 4px 10px;
    cursor: pointer;
    margin-top: 2px;
  }
  .nm-return:hover { background: var(--accent-ink-tint-35); }

  .chrome-bottom {
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 24px;
    padding: 12px 20px;
  }
  .hint,
  .progress {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .progress { display: inline-flex; align-items: center; gap: 10px; }
  .step-dots { display: inline-flex; gap: 4px; }
  .step-dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--ink-soft);
  }
  .step-dot.lit { background: var(--accent); border-color: var(--accent); }

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
    .pill { bottom: 58px; }
  }
</style>
