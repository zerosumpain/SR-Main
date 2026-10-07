<script lang="ts">
  // The landing page's resident: one viewport-sized canvas laid over the page,
  // drawing a small pixel character who treats elements marked `use:scenery`
  // as floors. The canvas never takes a click (pointer-events: none) and is
  // hidden from assistive tech — it is decoration, and the page reads the
  // same without it. One small link follows his body, so clicking him (and
  // only him) opens /rambler, the page that explains how he works; keyboard
  // and screen-reader visitors get the footer's "How he works" link instead.
  import { getContext, onMount } from 'svelte';
  import { HEALTH_TIMEZONE } from '$lib/constants/health-day';
  import type { DayFlags } from '$lib/landing/ramblers/day';
  import { moodFor, type MoodInput } from '$lib/landing/ramblers/mood';
  import type { VitalsStore } from '$lib/vitals/store.svelte';
  import { drawWorld, type Ink } from '$lib/landing/ramblers/draw';
  import { HEIGHT, Resident } from '$lib/landing/ramblers/resident';
  import { onSceneryChange, sceneryElements } from '$lib/landing/ramblers/scenery';
  import { loadRamblerPreference, rambler } from '$lib/landing/ramblers/visibility.svelte';
  import { buildWorld, type SceneryRect, type World } from '$lib/landing/ramblers/world';

  /** Coarse flags about the owner's day, from the landing loader. */
  let { day }: { day: DayFlags } = $props();

  // The site's live readings (pulse, weather, time of day), already polled
  // for the header; the rambler only reads them.
  const vitals = getContext<VitalsStore | undefined>('vitals');

  let canvas: HTMLCanvasElement;
  let link: HTMLAnchorElement;

  /**
   * Screen pixels per art pixel: 1.5 where that lands on whole device pixels
   * (3 on a 2x screen), otherwise the nearest whole number of device pixels.
   * About 58px tall on phones and laptops, 78px on a standard monitor.
   */
  function artPixel(dpr: number) {
    const device = Math.max(2, Math.floor(1.5 * dpr + 0.01));
    return device / dpr;
  }

  /** The owner's local hour and whether it is a weekday, where the readings come from. */
  function ownerClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: HEALTH_TIMEZONE, hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const hour = (Number(get('hour')) % 24) + Number(get('minute')) / 60;
    return { hour, weekday: !['Sat', 'Sun'].includes(get('weekday')) };
  }

  onMount(() => {
    loadRamblerPreference();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let P = artPixel(window.devicePixelRatio || 1);
    let resident = new Resident(Math.random, P);
    const ids = new WeakMap<HTMLElement, number>();
    let nextId = 0;
    let world: World | null = null;
    let dirty = true;
    let today = day;
    let ink: Ink = { ink: '#1a1008', paper: '#ede4d4', muted: '#6b6158', font: 'ui-monospace, monospace' };
    let inkAt = -Infinity;
    let moodAt = -Infinity;
    let dayAt = performance.now();

    // What the day, the weather and his pulse make him feel like doing.
    const readMood = () => {
      const s = vitals?.targetState;
      const clock = ownerClock();
      const input: MoodInput = {
        sky: s?.sources?.weather ? s.weather.condition : 'cloudy',
        temp: s?.weather.temp ?? 12,
        pulse: s?.sources?.heartRate && !s.stale && s.pulse > 0 ? s.pulse : null,
        dayPhase: s?.dayPhase ?? 'day',
        day: today,
        hour: clock.hour,
        weekday: clock.weekday,
        sleep: today.sleep ?? null,
        recovery: today.recovery ?? null,
      };
      resident.setMood(moodFor(input));
    };

    // A long visit: re-read the day, and celebrate a flag that flips while he watches.
    const readDay = async () => {
      try {
        const r = await fetch('/api/rambler/day');
        if (!r.ok) return;
        const next = (await r.json()) as DayFlags;
        const better = (next.steps === 'high' && today.steps !== 'high') || (next.exercised && !today.exercised) || (next.mindful && !today.mindful);
        today = next;
        if (better) resident.celebrate();
        moodAt = -Infinity;
      } catch {
        // Offline or blocked: keep the day he started with.
      }
    };

    const readInk = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
      ink = { ink: v('--text-primary', ink.ink), paper: v('--bg', ink.paper), muted: v('--text-muted', ink.muted), font: v('--font-mono', ink.font) };
    };

    const rebuild = () => {
      const dprP = artPixel(window.devicePixelRatio || 1);
      if (dprP !== P) {
        // Dragged to a screen of another density: a new man at the new scale.
        P = dprP;
        resident = new Resident(Math.random, P);
        moodAt = -Infinity;
      }
      const rects: SceneryRect[] = [];
      for (const [el, opts] of sceneryElements) {
        const b = el.getBoundingClientRect();
        if (!b.width) continue;
        if (!ids.has(el)) ids.set(el, nextId++);
        rects.push({
          key: ids.get(el)!,
          x1: b.left + scrollX,
          x2: b.right + scrollX,
          y: (opts.edge === 'bottom' ? b.bottom : b.top) + scrollY,
          bottom: b.bottom + scrollY,
          spot: opts.spot,
          at: opts.at,
        });
      }
      const pageWidth = document.documentElement.clientWidth;
      // Thresholds scale with his height (36px when they were tuned): he
      // clears a gap a little taller than himself and steps off ledges up to
      // four times his height; deeper than that he abseils.
      const S = (HEIGHT * P) / 36;
      const opts = { margin: 8 * S, standOff: 8 * S, jump: 52 * S, drop: 160 * S, longest: 700, pageWidth };
      world = rects.length ? buildWorld(rects, opts) : null;
      if (world && world.floors.length) resident.setWorld(world, { asleep: still.matches });
      else world = null;
    };

    const markDirty = () => (dirty = true);
    const ro = new ResizeObserver(markDirty);
    ro.observe(document.body);
    const offScenery = onSceneryChange(markDirty);
    still.addEventListener('change', markDirty);

    // Eyes follow a mouse nearby; he waves when it comes close, at most once every eight seconds.
    let lastWave = -Infinity;
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || rambler.hidden || still.matches) return;
      const x = e.clientX + scrollX;
      const y = e.clientY + scrollY;
      const h = resident.height;
      if (Math.abs(x - resident.x) < 240 && Math.abs(y - (resident.y - h / 2)) < 200) resident.lookAt(x);
      if (Math.abs(x - resident.x) < h * 0.35 && y < resident.y + 4 && y > resident.y - h * 1.2 && e.timeStamp - lastWave > 8000) {
        lastWave = e.timeStamp;
        resident.greet();
      }
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    // Development only: `rambler.start('mad')` in the console to watch one.
    if (import.meta.env.DEV) Object.defineProperty(window, 'rambler', { configurable: true, get: () => resident });

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
        dirty = true;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      link.style.display = 'none';
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
      if (now - moodAt > 30_000) {
        moodAt = now;
        readMood();
      }
      if (now - dayAt > 600_000) {
        dayAt = now;
        void readDay();
      }
      resident.setView(scrollY, scrollY + innerHeight);
      resident.update(still.matches ? 0 : dt);
      ctx.setTransform(dpr, 0, 0, dpr, -scrollX * dpr, -scrollY * dpr);
      const at = drawWorld(ctx, world, resident, P, ink, { left: scrollX, right: scrollX + innerWidth }, dpr);
      if (at) {
        // Never smaller than a comfortable tap target.
        const pad = Math.max(0, (44 - at.w) / 2);
        link.style.display = 'block';
        link.style.transform = `translate(${Math.round(at.x - scrollX - pad)}px, ${Math.round(at.y - scrollY)}px)`;
        link.style.width = `${Math.round(at.w + 2 * pad)}px`;
        link.style.height = `${Math.round(Math.max(44, at.h))}px`;
      }
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
<a bind:this={link} class="rambler-hit" href="/rambler" tabindex="-1" aria-hidden="true" title="How the rambler works"></a>

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
  .rambler-hit {
    position: fixed;
    top: 0;
    left: 0;
    display: none;
    z-index: 21;
    cursor: pointer;
  }
  @media print {
    .rambler,
    .rambler-hit {
      display: none;
    }
  }
</style>
