<script lang="ts">
  // Every thing he does, playing live, each in the view the landing page uses
  // for it. Drawn with the landing page's own rig, so this never drifts.
  import { onMount } from 'svelte';
  import { accents } from '$lib/landing/ramblers/accents';
  import { ACCENT, paintAccent, pixels } from '$lib/landing/ramblers/draw';
  import { pose, render, type Mode, type View } from '$lib/landing/ramblers/rig';
  import { readInk } from './ink';

  interface Entry {
    mode: Mode;
    label: string;
    view: View;
    note: string;
  }

  const ENTRIES: Entry[] = [
    { mode: 'walk', label: 'Walk', view: 'side', note: 'feet pinned to the floor' },
    { mode: 'run', label: 'Run', view: 'side', note: 'both feet off between steps' },
    { mode: 'wall', label: 'Scale a wall', view: 'side', note: 'up the side of a box' },
    { mode: 'rope', label: 'Climb a rope', view: 'back', note: 'hand over hand' },
    { mode: 'think', label: 'Think', view: 'front', note: 'work pull, a worry' },
    { mode: 'yawn', label: 'Yawn', view: 'front', note: 'sleep pressure' },
    { mode: 'meditate', label: 'Meditate', view: 'front', note: 'stress' },
    { mode: 'wave', label: 'Wave', view: 'front', note: 'a mouse nearby' },
    { mode: 'stressed', label: 'Stressed', view: 'front', note: 'a pulse up with no exercise' },
    { mode: 'mad', label: 'Mad', view: 'front', note: 'a plan foiled, once a visit' },
    { mode: 'surprised', label: 'Surprised', view: 'front', note: 'a cloud out of nowhere' },
    { mode: 'fidget', label: "Can't decide", view: 'front', note: 'two needs tied' },
    { mode: 'shiver', label: 'Shiver', view: 'front', note: 'under 8 °C' },
    { mode: 'fan', label: 'Too hot', view: 'front', note: 'over 24 °C' },
    { mode: 'celebrate', label: 'Celebrate', view: 'front', note: 'a good day, mid-visit' },
    { mode: 'tea', label: 'Tea', view: 'side', note: 'eleven and half three' },
    { mode: 'eat', label: 'Eat', view: 'side', note: 'the meal clock' },
    { mode: 'sofa', label: 'Sofa', view: 'side', note: 'tired, or a wet day' },
    { mode: 'study', label: 'Read', view: 'side', note: 'working hours' },
    { mode: 'dig', label: 'Garden', view: 'side', note: 'a tired brain, a sunny day' },
    { mode: 'cycle', label: 'Cycle', view: 'side', note: 'restless, dry, daylight' },
    { mode: 'puddle', label: 'Puddles', view: 'side', note: 'when it rains' },
    { mode: 'skip', label: 'Work out', view: 'side', note: 'restless, wound up' },
    { mode: 'sleep', label: 'Sleep', view: 'side', note: 'night, and a heavy day' },
  ];
  const SEATED = new Set<Mode>(['tea', 'eat', 'sofa', 'study']);

  let canvases: HTMLCanvasElement[] = $state([]);

  onMount(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let ink = readInk();
    let inkAt = 0;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - inkAt > 1000) {
        inkAt = now;
        ink = readInk();
      }
      const t = still.matches ? 1.3 : (now - start) / 1000;
      const dpr = window.devicePixelRatio || 1;
      ENTRIES.forEach((e, i) => {
        const c = canvases[i];
        if (!c) return;
        const r = c.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        const w = Math.round(r.width * dpr);
        const h = Math.round(r.height * dpr);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const ctx = c.getContext('2d')!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const P = Math.max(2, Math.floor(Math.min(w / 46, h / 62)));
        const lt = t + i * 0.41;
        const p = pose(e.mode, lt, e.view);
        const f = render(p, 1);
        const ox = Math.round(w / 2);
        const ground = h - 3 * P;
        const seat = SEATED.has(e.mode) ? 8 * P : 0;
        ctx.fillStyle = ink.muted;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(0, ground + P, w, Math.max(1, P / 2));
        if (seat) ctx.fillRect(ox - 7 * P, ground - seat + P, 14 * P, seat);
        ctx.globalAlpha = 1;
        pixels(ctx, f.px, ox, ground - seat, P);
        const kind = ACCENT[e.mode];
        if (kind) paintAccent(ctx, accents(kind, lt, f.head, f.crown, 1), ox, ground - seat, P, ink);
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<ul class="gallery">
  {#each ENTRIES as e, i (e.mode)}
    <li>
      <canvas bind:this={canvases[i]} aria-hidden="true"></canvas>
      <span class="name">{e.label}</span>
      <span class="when"><span class="view">{e.view === 'front' ? 'front on' : e.view === 'back' ? 'from behind' : 'side on'}</span> · {e.note}</span>
    </li>
  {/each}
</ul>

<style>
  .gallery {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 1px;
    background: var(--line-hair);
    border: 1px solid var(--line-hair);
  }
  li {
    background: var(--bg);
    display: grid;
    gap: 0.2rem;
    padding: 0.5rem 0.6rem 0.75rem;
    min-width: 0;
  }
  canvas {
    width: 100%;
    height: 8.5rem;
    display: block;
    image-rendering: pixelated;
  }
  .name {
    font-family: var(--font-body);
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text-primary);
  }
  .when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    line-height: 1.4;
  }
  .view {
    color: var(--accent);
  }
</style>
