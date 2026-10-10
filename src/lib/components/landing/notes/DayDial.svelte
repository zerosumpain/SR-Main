<svelte:options css="injected" />

<script lang="ts">
  // The daydreamer's wait as a small dial (HeroNotes): a hand-drawn face,
  // hatched for the time still to wait till the next think. Nothing is shaded
  // while it thinks, the face is dashed when the think is late, z's when it is
  // asleep and struck through when it is off; idle leaves the face bare.
  import type { Dial } from '$lib/landing/notes';
  import { dialHand, dialWedge, inkLine, inkRing, rng } from '$lib/landing/notes-ink';

  let { dial }: { dial: Dial } = $props();

  const FACE = inkRing(rng(23), 32, 32, 25, 25, 1.06, 0.03);
  const TICKS = [0, 1, 2, 3]
    .map((q) => {
      const a = (q * Math.PI) / 2;
      return inkLine(rng(29 + q), 32 + Math.sin(a) * 27, 32 - Math.cos(a) * 27, 32 + Math.sin(a) * 31, 32 - Math.cos(a) * 31, 0.3, 0);
    })
    .join(' ');
  const STRIKE = inkLine(rng(37), 8, 50, 56, 14, 0.6, 0.03);

  let wedge = $derived(dial.kind === 'wait' ? dialWedge(32, 32, 21, dial.f) : null);
  let hand = $derived(dial.kind === 'wait' || dial.kind === 'late' ? dialHand(32, 32, 19, dial.kind === 'wait' ? dial.f : 0) : null);
</script>

<svg class="hn-dial" class:late={dial.kind === 'late'} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="hn-hatch" width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <path d="M0,0 L0,3.5" />
    </pattern>
  </defs>
  {#if wedge}<path class="wedge" d={wedge} />{/if}
  <path class="face" d={FACE} />
  <path class="ticks" d={TICKS} />
  {#if hand}<path class="hand" d={hand} /><circle class="pin" cx="32" cy="32" r="2" />{/if}
  {#if dial.kind === 'asleep'}<text x="25" y="38">z</text><text class="z2" x="34" y="28">z</text>{/if}
  {#if dial.kind === 'off'}<path class="strike" d={STRIKE} />{/if}
</svg>

<style>
  .hn-dial {
    width: 64px;
    height: 64px;
    overflow: visible;
  }
  .hn-dial path {
    fill: none;
    stroke-linecap: round;
  }
  .hn-dial .face {
    stroke: var(--accent-ink-on-dark);
    stroke-width: 1.8;
  }
  .hn-dial.late .face {
    stroke-dasharray: 3 4;
  }
  .hn-dial .ticks {
    stroke: var(--accent-ink-on-dark);
    stroke-width: 1.6;
  }
  .hn-dial pattern path {
    stroke: var(--accent-ink-on-dark);
    stroke-width: 1;
    opacity: 0.75;
  }
  .hn-dial .wedge {
    fill: url(#hn-hatch);
  }
  .hn-dial .hand {
    stroke: var(--bg);
    stroke-width: 2;
  }
  .hn-dial .pin {
    fill: var(--bg);
  }
  .hn-dial .strike {
    stroke: var(--on-ink-70);
    stroke-width: 2;
  }
  .hn-dial text {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    fill: var(--accent-ink-on-dark);
  }
  .hn-dial .z2 {
    font-size: 13px;
  }
</style>
