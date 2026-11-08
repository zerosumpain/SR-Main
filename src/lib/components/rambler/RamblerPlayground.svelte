<script lang="ts">
  // A toy page with four boxes, and the real rambler living on it: the same
  // world builder, climbing code and drawing as the landing page. The buttons
  // send him somewhere so you can watch how he gets there.
  import { onMount } from 'svelte';
  import { drawWorld } from '$lib/landing/ramblers/draw';
  import { HEIGHT, Resident, type Activity } from '$lib/landing/ramblers/resident';
  import { buildWorld, type SceneryRect, type World } from '$lib/landing/ramblers/world';
  import { artPixel, readInk } from './ink';

  let canvas: HTMLCanvasElement;
  let caption = $state('He is finding his feet.');
  let send: (a: Activity) => void = () => {};

  const CAPTIONS: Record<string, string> = {
    walk: 'Walking: each foot stays put on the floor while it carries him.',
    run: 'Running: the trip is long, so he jogs it.',
    land: 'Landing: knees bend to take it.',
    jump: 'Jumping: the gap is a little taller than he is, so he springs it.',
    hop: 'Jumping: the gap is a little taller than he is, so he springs it.',
    wall: "Scaling a wall: the box's side comes down near the floor, so he climbs it.",
    mantle: 'Pulling himself up and over the edge.',
    aim: 'Aiming the grappling hook: nothing to climb here, so he fires a rope.',
    rope: 'On the rope, hand over hand.',
    fall: 'Stepping off: a short drop is quicker than climbing down.',
  };

  onMount(() => {
    const ctx = canvas.getContext('2d')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let world: World | null = null;
    let P = 1.5;
    let r = new Resident(Math.random, P);
    let size = '';
    const build = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      P = artPixel(window.devicePixelRatio || 1, w < 520 ? 1 : 1.5);
      r = new Resident(Math.random, P);
      // Four boxes: the floor, a low shelf, a tall tower, and a ledge to jump to.
      const rects: SceneryRect[] = [
        { key: 1, x1: 0, x2: w, y: h - 12, spot: 'bed', at: 0.15 },
        { key: 2, x1: w * 0.06, x2: w * 0.36, y: h - 92, bottom: h - 12, spot: 'desk' },
        { key: 3, x1: w * 0.58, x2: w * 0.8, y: h - 250, bottom: h - 12, spot: 'lookout', at: 0.5 },
        { key: 4, x1: w * 0.36, x2: w * 0.56, y: h - 150, bottom: h - 120, spot: 'think' },
      ];
      const S = (HEIGHT * P) / 36;
      world = buildWorld(rects, { margin: 8 * S, standOff: 8 * S, jump: 52 * S, drop: 160 * S, pageWidth: w });
      r.setWorld(world);
    };
    send = (a) => r.start(a);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (`${w}x${h}` !== size) {
        size = `${w}x${h}`;
        canvas.width = w;
        canvas.height = h;
        build();
      }
      if (!world) return;
      r.update(still.matches ? 0 : dt);
      const ink = readInk();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = ink.muted;
      ctx.globalAlpha = 0.18;
      for (const f of world.floors) if (f.y < canvas.clientHeight - 20) ctx.fillRect(f.x1, f.y, f.x2 - f.x1, Math.max(4, Math.min(f.leftWall, f.rightWall) - f.y));
      ctx.globalAlpha = 0.5;
      for (const f of world.floors) ctx.fillRect(f.x1, f.y, f.x2 - f.x1, 2);
      ctx.globalAlpha = 1;
      drawWorld(ctx, world, r, P, ink, { left: 0, right: canvas.clientWidth }, dpr);
      const c = CAPTIONS[r.mode];
      if (c && c !== caption) caption = c;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="play">
  <canvas bind:this={canvas} aria-label="A small model page with the rambler climbing between boxes"></canvas>
  <div class="row">
    <button type="button" onclick={() => send('lookout')}>Up the tower</button>
    <button type="button" onclick={() => send('think')}>Onto the ledge</button>
    <button type="button" onclick={() => send('study')}>To the shelf</button>
    <button type="button" onclick={() => send('sleep')}>Back to the floor</button>
  </div>
  <p class="caption" aria-live="polite">{caption}</p>
</div>

<style>
  .play {
    display: grid;
    gap: 0.75rem;
  }
  canvas {
    width: 100%;
    height: 22rem;
    display: block;
    border: 1px solid var(--line-hair);
    image-rendering: pixelated;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .caption {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-secondary);
    min-height: 1.5em;
  }
</style>
