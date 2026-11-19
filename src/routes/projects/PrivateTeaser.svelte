<script lang="ts">
  // The public opened a private project. Instead of the page, the rambler runs
  // on from the left, turns, runs up to the camera — growing as he comes — and
  // says it is not for them. Run-in and line take 2 seconds, then he fades over
  // one more and the overlay ends itself. Drawn with the landing page's own rig
  // ($lib/landing/ramblers), so he is the same man as on the home page.
  //
  // Pointer events pass through the whole time: he is a joke, not a dialog,
  // and nothing on the page should wait for him.
  import { onMount } from 'svelte';
  import { pixels } from '$lib/landing/ramblers/draw';
  import { pose, render, type Pose } from '$lib/landing/ramblers/rig';
  import { readInk } from '$lib/components/rambler/ink';
  import { pickLockedLine } from './locked-lines';

  let { onDone }: { onDone: () => void } = $props();

  // Seconds. Side-on run to the middle, front-on run at the camera, the line.
  const RUN_IN = 0.65;
  const APPROACH = 1.15;
  const SAID = 2;
  const GONE = 3;
  // His height standing, in art pixels (rig.ts BUILD), and how much of the
  // screen he fills when he arrives.
  const TALL = 39;
  const NEAR = 0.6;
  const TAU = Math.PI * 2;

  const line = pickLockedLine();
  let canvas: HTMLCanvasElement;
  let saying = $state(false);
  let fade = $state(1);
  // Where the bubble sits: the top of his head, in CSS pixels.
  let at = $state({ x: 0, y: 0 });

  /** Front on, running at you: knees up towards the camera in turn, arms pumping, a bob. */
  function charge(t: number): Pose {
    const p = pose('idle', t, 'front');
    const s = Math.sin(t * TAU * 3.2);
    p.legAk = 1 - 0.4 * Math.max(0, s);
    p.legBk = 1 - 0.4 * Math.max(0, -s);
    p.armA = [22 + 30 * Math.max(0, -s), 70];
    p.armB = [22 + 30 * Math.max(0, s), 70];
    p.armAk = p.armBk = 0.85;
    p.dy = -Math.abs(s);
    p.face = 'happy';
    return p;
  }

  onMount(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ink = readInk();
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const start = performance.now();

    const frame = (now: number) => {
      // Reduced motion: no run, he is simply there for the line, then fades.
      const t = (now - start) / 1000 + (still ? APPROACH : 0);
      if (t >= GONE) return onDone();
      raf = requestAnimationFrame(frame);

      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(innerWidth * dpr);
      const h = Math.round(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      // Small and far at first, then as tall as NEAR of the screen (narrow
      // screens cap him by width), with his feet at the bottom edge.
      const far = Math.max(2, Math.round(1.5 * dpr));
      const near = Math.max(far, Math.round(Math.min((h * NEAR) / TALL, (w * 0.5) / 22)));
      const mid = Math.round(w / 2);
      const floorFar = Math.round(h * 0.7);
      const floorNear = h - Math.round(near * 1.5);

      let p: Pose;
      let P = far;
      let ox = mid;
      let oy = floorFar;
      if (t < RUN_IN) {
        // Ease out into the middle, from just off the left edge.
        const k = 1 - (1 - t / RUN_IN) ** 2;
        ox = Math.round(-20 * far + (mid + 20 * far) * k);
        p = pose('run', t, 'side');
      } else if (t < APPROACH) {
        // Getting closer reads as growing faster the nearer he is.
        const k = ((t - RUN_IN) / (APPROACH - RUN_IN)) ** 2;
        P = Math.round(far + (near - far) * k);
        oy = Math.round(floorFar + (floorNear - floorFar) * k);
        p = charge(t);
      } else {
        P = near;
        oy = floorNear;
        // A wagging finger: the wave, quick, with the line's face.
        p = pose('wave', t * 1.6, 'front');
        p.face = line.face;
      }
      const f = render(p, 1);
      pixels(ctx, f.px, ox, oy, P, ink);

      if (t >= APPROACH && !saying) {
        saying = true;
        at = { x: ox / dpr, y: (oy + f.top * P) / dpr };
      }
      fade = t <= SAID ? 1 : 1 - (t - SAID) / (GONE - SAID);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="teaser" style:opacity={fade} role="status" aria-live="polite">
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if saying}
    <p class="bubble" style:left="{at.x}px" style:top="{at.y}px">{line.text}</p>
  {:else}
    <span class="sr-only">{line.text}</span>
  {/if}
</div>

<style>
  .teaser {
    position: fixed;
    inset: 0;
    z-index: 40;
    pointer-events: none;
    background: radial-gradient(ellipse at 50% 80%, color-mix(in srgb, var(--bg) 70%, transparent), transparent 70%);
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    image-rendering: pixelated;
  }
  /* His speech bubble, as on the landing page: paper, an ink rule, mono, with
     a tail down to his head. */
  .bubble {
    position: absolute;
    transform: translate(-50%, calc(-100% - 14px));
    max-width: min(22rem, calc(100vw - 32px));
    width: max-content;
    margin: 0;
    padding: 0.55rem 0.8rem;
    background: var(--bg);
    color: var(--text-primary);
    border: 2px solid var(--text-primary);
    font-family: var(--font-mono);
    font-size: clamp(0.85rem, 2.4vw, 1.05rem);
    line-height: 1.4;
    text-align: center;
    animation: pop 120ms var(--ease-out) both;
  }
  .bubble::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -10px;
    width: 12px;
    height: 12px;
    background: var(--bg);
    border-right: 2px solid var(--text-primary);
    border-bottom: 2px solid var(--text-primary);
    transform: translateX(-50%) rotate(45deg);
  }
  @keyframes pop {
    from {
      transform: translate(-50%, calc(-100% - 6px)) scale(0.85);
      opacity: 0;
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
