<svelte:options css="injected" />

<script lang="ts">
  // The hairline between chapters: the hero's heartbeat line again, as a
  // printer's rule. With a fresh reading it is drawn at the exact rate (the
  // spacing of the beats IS the rate, as on the hero's line) and a head sweeps
  // along it once a beat; with no fresh reading it lies flat and dim and says
  // nothing about the watch. The sweep is CSS on --beat (60/bpm s), runs only
  // on screen in a visible tab, stops under reduced motion and whenever the
  // reader asks it to hold still; the switch sits right beside every line.
  // Only the first line says the rate in words (`caption`); the rest just
  // beat. The line that opens the ink band runs full-bleed (`bleed`), at the
  // hero's scale, while its switch keeps to the measure.
  import { onMount } from 'svelte';
  import { clampBpm, heartLine } from '$lib/landing/traces';
  import { onScreen, prefersReducedMotion } from '$lib/landing/showcase-motion';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    bpm,
    held,
    onhold,
    ground = 'paper',
    caption = false,
    bleed = false,
  }: {
    /** A fresh reading, or null (then the line lies flat). */
    bpm: number | null;
    held: boolean;
    onhold: () => void;
    ground?: 'paper' | 'ink';
    /** Say the rate in words beside the switch (the first line only). */
    caption?: boolean;
    /** Run the line edge to edge, as the hero's does. */
    bleed?: boolean;
  } = $props();

  let w = $state(1184);
  let h = $state(40);
  let on = $state(false);
  let reduced = $state(false);
  let line = $derived(heartLine(bpm, w, h));
  let drawn = $derived(bpm == null ? null : clampBpm(bpm));
  let moving = $derived(drawn != null && line.beats > 0 && !held && !reduced && on);

  onMount(() => {
    reduced = prefersReducedMotion();
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => (reduced = mq.matches);
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  });

  const TAIL = [
    { len: 0.85, op: 0.22 },
    { len: 0.45, op: 0.42 },
    { len: 0.16, op: 0.95 },
  ];
  const dash = (len: number) => {
    const l = Math.round((len / Math.max(1, line.beats)) * 10_000) / 10_000;
    return `0 ${3 - l} ${l} 0`;
  };
</script>

<div
  class="ss-er"
  class:ss-live={drawn != null}
  data-ground={ground}
  data-bleed={bleed ? '' : undefined}
  style:--beat="{(60 / (drawn ?? 60)).toFixed(4)}s"
  style:--beats={line.beats}
>
  <!-- A floor too: the rambler walks the line (the box never moves; only the sweep inside does). -->
  <div
    class="ss-ln"
    aria-hidden="true"
    bind:clientWidth={w}
    bind:clientHeight={h}
    use:onScreen={(v) => (on = v)}
    use:scenery={{ at: 0.7 }}
  >
    <svg viewBox="0 0 {w} {h}" preserveAspectRatio="none" focusable="false">
      <path class="ss-base" d={line.d} />
      {#if moving}
        {#each TAIL as t (t.len)}
          <path class="ss-run" d={line.d} pathLength="1" style:stroke-dasharray={dash(t.len)} style:opacity={t.op} />
        {/each}
        <path class="ss-run ss-head" d={line.d} pathLength="1" />
      {/if}
    </svg>
  </div>
  {#if drawn != null && (caption || !reduced)}
    <p class="ss-cap">
      {#if caption}<span>{reduced || held ? `drawn at ${drawn} bpm` : `keeping time at ${drawn} bpm`}</span>{/if}
      {#if !reduced}
        <button type="button" class="ss-hold" aria-pressed={held} onclick={onhold}>
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            {#if held}<path d="M2 1 L9 5 L2 9 Z" />{:else}<path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" />{/if}
          </svg>
          hold still
        </button>
      {/if}
    </p>
  {/if}
</div>

<style>
  .ss-er {
    --rule: var(--line-strong);
    --run: var(--accent-hover);
    --cap: var(--text-muted);
    --cap-on: var(--text-primary);
    --focus: var(--accent-hover);
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut, 16px);
    box-sizing: border-box;
  }
  .ss-er[data-ground='ink'] {
    --rule: var(--on-ink-16);
    --run: var(--accent-on-dark);
    --cap: var(--on-ink-55);
    --cap-on: var(--on-ink-80);
    --focus: var(--accent-on-dark);
  }
  .ss-er[data-bleed] {
    max-width: none;
    padding: 0;
  }
  .ss-ln {
    height: 40px;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .ss-base {
    stroke: var(--rule);
    stroke-width: 1;
  }
  .ss-live .ss-base {
    stroke: var(--run);
    opacity: 0.42;
  }
  .ss-run {
    stroke: var(--run);
    stroke-width: 1.5;
    stroke-dashoffset: 0;
    animation: ss-er-run calc(var(--beat, 1s) * var(--beats, 1)) linear infinite;
  }
  .ss-head {
    stroke-linecap: round;
    stroke-dasharray: 0 3;
    stroke-width: 4.5;
  }
  @keyframes ss-er-run {
    to {
      stroke-dashoffset: -1;
    }
  }

  .ss-cap {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 16px;
    margin: 6px 0 0;
    /* Clear of the rambler's rope lane at the right-hand end. */
    padding-right: var(--lane, 40px);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    line-height: 1.6;
    color: var(--cap);
  }
  .ss-er[data-bleed] .ss-cap {
    max-width: 1312px;
    margin: 6px auto 0;
    padding: 0 calc(var(--gut, 16px) + var(--lane, 40px)) 0 var(--gut, 16px);
    box-sizing: border-box;
  }
  /* A 44px target that takes only its text's height in the caption's line:
     the negative margins give back what the minimum height adds. */
  .ss-hold {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    margin: -10px 0;
    padding: 2px 4px;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    color: var(--cap-on);
    cursor: pointer;
  }
  .ss-hold::after {
    content: '';
    position: absolute;
    inset: 0 -6px;
  }
  .ss-hold:hover,
  .ss-hold[aria-pressed='true'] {
    color: var(--run);
  }
  .ss-hold:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
  }
  .ss-hold svg {
    width: 9px;
    height: 9px;
    fill: currentColor;
  }
  @media (prefers-reduced-motion: reduce) {
    .ss-run {
      display: none;
    }
    .ss-live .ss-base {
      opacity: 0.6;
    }
  }
  @media print {
    .ss-er {
      display: none;
    }
  }
</style>
