<svelte:options css="injected" />

<script lang="ts">
  // A page's headline figure, inked: the number counts up the first time it
  // scrolls into view while its mark (a double underline, or a ring drawn
  // round it) draws itself in the same breath, by stroke-dashoffset alone.
  // One observer starts both, so the count and the pen never drift apart.
  //
  // The server's HTML, a browser without JavaScript and a reader who prefers
  // less motion all get the final figure with its mark already drawn. Live,
  // the figure is set back to nought at once (its width held, so nothing
  // moves) and the mark taken back into the pen; both wait there, below the
  // fold, until they are seen. A figure already in view at hydration is left
  // final. So a figure is never seen final and then snapped back to nought.
  //
  // The figure's line box is a whole number of the page's 32px rules, so the
  // page's lines carry on below it in step.
  import { onMount } from 'svelte';
  import type { Fig } from '$lib/landing/showcase-notes';
  import { figureEm, ringPad } from '$lib/landing/showcase-notes';
  import { belowFold, COUNT_MS, firstView, formatFigure, prefersReducedMotion, tweenValue } from '$lib/landing/showcase-motion';
  import { inkLine, inkRing, rng } from '$lib/landing/notes-ink';

  let {
    f,
    unit,
    mark = 'under',
    tone = 'accent',
    suffix = '',
    seed = 1,
    size = 'xl',
  }: {
    f: Fig;
    unit: string;
    mark?: 'under' | 'ring';
    tone?: 'accent' | 'ink';
    /** Printed straight after the figure, inside the count ("%"). */
    suffix?: string;
    seed?: number;
    size?: 'xl' | 'lg' | 'md';
  } = $props();

  // Two strokes for an underline, a ring and its overshoot for a circle.
  // svelte-ignore state_referenced_locally
  const marks =
    mark === 'under'
      ? [inkLine(rng(seed), 1, 3, 99, 4.6, 0.4, 0.012), inkLine(rng(seed + 1), 6, 9, 95, 10, 0.4, 0.012)]
      : [inkRing(rng(seed), 60, 40, 56, 35, 1.12, 0.04)];

  const fmt = (n: number) => `${formatFigure(n, f.decimals)}${suffix}`;
  let text = $derived(f.n != null ? fmt(f.n) : '—');
  // The ring's room either side, from the figure's own width, so it never cuts a digit.
  let pad = $derived(ringPad(figureEm(text)));

  let armed = $state(false);
  let drawn = $state(false);
  let el: HTMLElement;
  let num = $state<HTMLSpanElement>();

  onMount(() => {
    // Only a figure still below the fold is armed: one already in view when
    // the page hydrates (or scrolled past) keeps the server's final figure
    // and drawn mark rather than dropping to nought in front of the reader.
    if (prefersReducedMotion() || f.n == null || f.n === 0 || !num || !belowFold(el)) return;
    const node = num;
    const textNode = () => {
      for (const c of node.childNodes) if (c.nodeType === 3) return c as Text;
      return null;
    };
    const write = (s: string) => {
      const t = textNode();
      if (t && t.data !== s) t.data = s;
    };
    // Hold the final width, then set the figure back to nought until it is seen.
    node.style.minWidth = `${node.getBoundingClientRect().width}px`;
    write(fmt(0));
    armed = true;

    let frame = 0;
    const settle = () => {
      if (f.n != null) write(fmt(f.n));
      node.style.minWidth = '';
    };
    const seen = firstView(el, () => {
      drawn = true;
      const t0 = performance.now();
      const step = (t: number) => {
        const to = f.n;
        if (to == null) return settle();
        const e = t - t0;
        write(fmt(tweenValue(to, e, COUNT_MS, f.decimals)));
        if (e < COUNT_MS) frame = requestAnimationFrame(step);
        else settle();
      };
      frame = requestAnimationFrame(step);
    });
    return () => {
      seen.destroy();
      if (frame) cancelAnimationFrame(frame);
    };
  });
</script>

<p class="sf sf-{size} sf-m-{mark}" data-tone={tone} class:armed class:drawn bind:this={el} style:--pad="{pad}em">
  <span class="sf-n">
    {#if f.n != null}
      <span class="sf-v" bind:this={num}>{text}</span>
      <svg
        class="sf-mark sf-{mark}"
        viewBox={mark === 'under' ? '0 0 100 12' : '0 0 120 80'}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {#each marks as d, i (i)}<path {d} pathLength="1" style:--i={i} />{/each}
      </svg>
    {:else}
      <span class="sf-v sf-dash" aria-hidden="true">—</span><span class="vh">{f.spoken}</span>
    {/if}
  </span>
  <span class="sf-u">{unit}</span>
</p>

<style>
  .sf {
    --tone: var(--accent);
    --tone-t: var(--accent-hover);
    display: flex;
    flex-wrap: wrap;
    /* Feet together: the unit's line sits at the foot of the figure's, which
       puts the two on the same rule without the baseline growing the row. */
    align-items: flex-end;
    gap: 0 16px;
    margin: 0;
  }
  .sf[data-tone='ink'] {
    --tone: var(--accent-ink);
    --tone-t: var(--accent-ink);
  }
  .sf-n {
    position: relative;
    display: inline-block;
    font-family: var(--font-display);
    font-weight: 800;
    line-height: 0.92;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .sf-v {
    display: inline-block;
    vertical-align: top;
  }
  .sf-xl .sf-n {
    font-size: clamp(52px, 7.4vw, 104px);
  }
  .sf-lg .sf-n {
    font-size: clamp(44px, 5.2vw, 72px);
  }
  .sf-md .sf-n {
    font-size: clamp(34px, 3.4vw, 48px);
  }
  /* A whole number of rules tall, so the page's lines carry on in step. */
  .sf-m-under .sf-n {
    line-height: round(up, 0.92em, 32px);
  }
  /* When the unit wraps under the figure, it skips a line to clear the underline. */
  .sf-m-under {
    row-gap: 32px;
  }
  .sf-m-ring .sf-n {
    line-height: round(up, 1.62em, 32px);
    margin: 0 var(--pad);
  }
  /* No figure: a pencilled dash, not a black bar. */
  .sf-dash {
    font-family: var(--fs-serif);
    font-weight: 400;
    color: var(--text-muted);
    letter-spacing: 0;
  }
  .sf-u {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--tone-t);
  }
  .sf-mark {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }
  /* The underline just under the digits' foot, wherever the line box puts them. */
  .sf-under {
    left: -2px;
    top: calc(50% + 0.4em);
    width: calc(100% + 6px);
    height: 14px;
  }
  /* The ring: wider than the figure by its own pad either side, and tall enough to clear the corners. */
  .sf-ring {
    left: calc(-1 * var(--pad));
    top: calc(50% - 0.8em);
    width: calc(100% + 2 * var(--pad));
    height: 1.6em;
  }
  .sf-mark path {
    fill: none;
    stroke: var(--tone);
    stroke-width: 2.6;
    stroke-linecap: round;
    /* A gap a touch longer than the stroke, so no round cap peeps out before it is drawn. */
    stroke-dasharray: 1 1.05;
    stroke-dashoffset: 0;
  }
  .sf-ring path {
    stroke-width: 2.2;
  }
  /* Live and not yet seen: the mark is still in the pen. */
  .armed .sf-mark path {
    stroke-dashoffset: 1.03;
  }
  .armed.drawn .sf-mark path {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 820ms cubic-bezier(0.3, 0.7, 0.2, 1) calc(var(--i) * 300ms);
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .sf-mark path,
    .armed .sf-mark path {
      stroke-dashoffset: 0;
      transition: none;
    }
  }
  @media print {
    .sf-n,
    .sf-u {
      color: #1a1008;
    }
    .sf-mark {
      display: none;
    }
  }
</style>
