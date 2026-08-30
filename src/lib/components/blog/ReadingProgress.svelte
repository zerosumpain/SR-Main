<script lang="ts">
  /**
   * Reading progress rail plus the sticky article bar.
   *
   * Progress is measured against the ARTICLE element, not the document. A page
   * with a long comment thread and a footer under it would otherwise report 60%
   * when the reader has finished the piece, which is worse than showing nothing
   * — the bar's only job is to answer "how much of this is left".
   *
   * The rAF handle is a plain `let`, never `$state`. `tick()` both reads and
   * writes it, and it is called from a scroll listener; making it reactive is
   * the documented route to `effect_update_depth_exceeded` and a locked UI.
   */
  import { onMount } from 'svelte';

  let {
    title,
    target,
  }: {
    title: string;
    /** The article element to measure. Bound by the page. */
    target?: HTMLElement | null;
  } = $props();

  let progress = $state(0);
  let showBar = $state(false);

  // Internal handles — deliberately NOT reactive.
  let frame: number | null = null;
  let scrollHandler: (() => void) | null = null;

  function measure() {
    frame = null;
    const el = target;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewport = window.innerHeight;
    // Distance scrolled into the article, over the distance there is to scroll
    // through it. Clamped, because both ends overshoot: the article starts
    // below the fold and ends above it.
    const total = Math.max(1, rect.height - viewport * 0.4);
    const scrolled = Math.min(Math.max(-rect.top + viewport * 0.25, 0), total);
    progress = Math.round((scrolled / total) * 100);

    // The bar appears once the headline has genuinely left the screen, so it
    // never double-prints the title the reader can already see.
    showBar = rect.top < -160;
  }

  function tick() {
    if (frame !== null) return;
    frame = requestAnimationFrame(measure);
  }

  onMount(() => {
    scrollHandler = tick;
    window.addEventListener('scroll', scrollHandler, { passive: true });
    window.addEventListener('resize', scrollHandler, { passive: true });
    measure();

    return () => {
      if (scrollHandler) {
        window.removeEventListener('scroll', scrollHandler);
        window.removeEventListener('resize', scrollHandler);
      }
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
  });
</script>

<div class="progress-rail" aria-hidden="true">
  <div class="progress-fill" style="width: {progress}%"></div>
</div>

<div class="sticky-bar" class:visible={showBar}>
  <div class="sb-inner">
    <a class="sb-mark" href="/blog" title="All writing">sr.</a>
    <span class="sb-title">{title}</span>
    <span class="sb-pct">{progress}%</span>
  </div>
</div>

<style>
  .progress-rail {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: transparent;
    z-index: 60;
    pointer-events: none;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.08s linear;
  }

  .sticky-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 55;
    background: var(--bg);
    border-bottom: 2px solid var(--line-strong);
    transform: translateY(-100%);
    transition: transform 0.2s ease-out;
  }

  .sticky-bar.visible {
    transform: translateY(0);
  }

  .sb-inner {
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: 78rem;
    margin: 0 auto;
    padding: 0.6rem 1.5rem;
  }

  .sb-mark {
    font-family: var(--font-brand);
    font-size: var(--fs-body);
    color: var(--accent);
    text-decoration: none;
    flex: none;
  }

  .sb-title {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sb-pct {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  @media print {
    .progress-rail,
    .sticky-bar {
      display: none;
    }
  }
</style>
