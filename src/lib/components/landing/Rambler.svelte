<script lang="ts">
  // The landing page's resident: one viewport-sized canvas laid over the page,
  // drawing a small pixel character who treats elements marked `use:scenery`
  // as floors. It never takes a click (pointer-events: none) and is hidden from
  // assistive tech — it is decoration, and the page reads the same without it.
  import { onMount } from 'svelte';
  import { drawWorld, type Ink } from '$lib/landing/ramblers/draw';
  import { Resident } from '$lib/landing/ramblers/resident';
  import { onSceneryChange, sceneryElements } from '$lib/landing/ramblers/scenery';
  import { loadRamblerPreference, rambler } from '$lib/landing/ramblers/visibility.svelte';
  import { buildWorld, type SceneryRect, type World } from '$lib/landing/ramblers/world';

  /** Screen pixels per art pixel: an 18-unit character stands 36px tall. */
  const P = 2;
  /** Below this width the page is one column; see SceneryOptions.compact. */
  const COMPACT = 720;

  let canvas: HTMLCanvasElement;

  onMount(() => {
    loadRamblerPreference();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const resident = new Resident();
    const ids = new WeakMap<HTMLElement, number>();
    let nextId = 0;
    let world: World | null = null;
    let dirty = true;
    let ink: Ink = { ink: '#1a1008', paper: '#ede4d4', muted: '#6b6158' };
    let inkAt = -Infinity;

    const readInk = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
      ink = { ink: v('--text-primary', ink.ink), paper: v('--bg', ink.paper), muted: v('--text-muted', ink.muted) };
    };

    const rebuild = () => {
      const rects: SceneryRect[] = [];
      const compact = innerWidth < COMPACT;
      for (const [el, opts] of sceneryElements) {
        if (compact && !opts.compact) continue;
        const b = el.getBoundingClientRect();
        if (!b.width) continue;
        if (!ids.has(el)) ids.set(el, nextId++);
        rects.push({
          key: ids.get(el)!,
          x1: b.left + scrollX,
          x2: b.right + scrollX,
          y: (opts.edge === 'bottom' ? b.bottom : b.top) + scrollY,
          spot: opts.spot,
          at: opts.at,
          ladder: opts.ladder,
        });
      }
      const pageWidth = document.documentElement.clientWidth;
      world = rects.length ? buildWorld(rects, { margin: 4 * P, ladderHalf: 4 * P, pageWidth }) : null;
      if (world && world.floors.length) resident.setWorld(world, { asleep: still.matches });
      else world = null;
    };

    const markDirty = () => (dirty = true);
    const ro = new ResizeObserver(markDirty);
    ro.observe(document.body);
    const offScenery = onSceneryChange(markDirty);
    still.addEventListener('change', markDirty);

    // Wave at a mouse that comes near him; at most once every eight seconds.
    let lastWave = -Infinity;
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || rambler.hidden || still.matches) return;
      const x = e.clientX + scrollX;
      const y = e.clientY + scrollY;
      if (Math.abs(x - resident.x) < 10 * P && y < resident.y + 2 * P && y > resident.y - 22 * P && e.timeStamp - lastWave > 8000) {
        lastWave = e.timeStamp;
        resident.greet();
      }
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    // Development only: `rambler.start('drive')` in the console to watch one.
    if (import.meta.env.DEV) Object.assign(window, { rambler: resident });

    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(innerWidth * dpr);
      const h = Math.round(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (rambler.hidden) return;
      if (dirty) {
        dirty = false;
        rebuild();
      }
      if (!world) return;
      if (now - inkAt > 1000) {
        inkAt = now;
        readInk();
      }
      if (!still.matches) resident.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, -scrollX * dpr, -scrollY * dpr);
      drawWorld(ctx, world, resident, P, ink);
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offScenery();
      still.removeEventListener('change', markDirty);
      window.removeEventListener('pointermove', onPointer);
    };
  });
</script>

<canvas bind:this={canvas} class="rambler" aria-hidden="true"></canvas>

<style>
  .rambler {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    /* Above the page, below the sticky header (30): he walks behind it. */
    z-index: 20;
  }
  @media print {
    .rambler {
      display: none;
    }
  }
</style>
