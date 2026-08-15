<script lang="ts">
  // CityRun — the set piece. One message, walked through the machine as a journey across
  // a small isometric town.
  //
  // Why this exists: the band map is accurate and it is a diagram, which means the reader
  // has to do the animating in their own head. Most won't. This does it for them, and it
  // makes the study's least intuitive claim — that the carrying costs more than the
  // thinking — something you watch happen rather than something you are told.
  //
  // Hand-rolled isometric SVG, no 3D library: the study argues for the simpler tool out
  // loud, and shipping half a megabyte of WebGL onto a public page to draw nine boxes
  // would rather undercut that. Projection is the standard 2:1 dimetric —
  // screen x from (gx − gy), screen y from (gx + gy), minus height.
  //
  // Rendering rules (svelte5-pitfalls §1): the rAF handle and the observer are plain
  // `let`, never $state — an effect that reads a handle it also writes is the documented
  // way to lock this page up. Only the frame's *values* are reactive.
  import { goto } from '$app/navigation';
  import { BLOCKS, ROADS, ROUTE, VERDICT, NIGHT_ALIAS, type Block, type Leg } from '../lib/city';

  let {
    route = ROUTE,
    verdict = VERDICT,
    night = false,
    idle = 'Nine legs, six buildings, one message. Press play.',
    playLabel = 'Run a message',
    showMeter = true,
  }: {
    route?: Leg[];
    verdict?: { head: string; body: string; section: string };
    night?: boolean;
    idle?: string;
    playLabel?: string;
    showMeter?: boolean;
  } = $props();

  // ---- projection ---------------------------------------------------------
  const TW = 42;   // half tile width
  const TH = 21;   // half tile height
  const OX = 292;
  const OY = 66;
  const px = (gx: number, gy: number) => OX + (gx - gy) * TW;
  const py = (gx: number, gy: number, z = 0) => OY + (gx + gy) * TH - z;
  const pt = (gx: number, gy: number, z = 0) => `${px(gx, gy)},${py(gx, gy, z)}`;

  const byId = new Map(BLOCKS.map((b) => [b.id, b]));
  /** Centre of a block's footprint, on the ground plane. */
  const centre = (b: Block) => ({ gx: b.gx + b.w / 2, gy: b.gy + b.d / 2 });

  /** Painter's algorithm: things further from the viewer are drawn first. */
  const ordered = [...BLOCKS].sort((a, b) => a.gx + a.gy - (b.gx + b.gy));

  /** The three visible faces of an extruded box. */
  function faces(b: Block) {
    const { gx: x, gy: y, w, d, h } = b;
    return {
      top: [pt(x, y, h), pt(x + w, y, h), pt(x + w, y + d, h), pt(x, y + d, h)].join(' '),
      right: [pt(x + w, y, h), pt(x + w, y + d, h), pt(x + w, y + d), pt(x + w, y)].join(' '),
      front: [pt(x, y + d, h), pt(x + w, y + d, h), pt(x + w, y + d), pt(x, y + d)].join(' '),
    };
  }

  /** Windows: a couple of rows of lit squares on the front face, so a box reads as a building. */
  function windows(b: Block) {
    const rows = Math.max(1, Math.floor((b.h - 12) / 18));
    const out: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        const gx = b.gx + (b.w * (c + 0.8)) / 3.4;
        const z = b.h - 11 - r * 18;
        if (z < 7) continue;
        out.push({ x: px(gx, b.gy + b.d), y: py(gx, b.gy + b.d, z) });
      }
    }
    return out;
  }

  /**
   * Label anchor: above the BACK corner of the roof, not the roof's centre. Centred on the
   * roof it printed straight across the top face and was unreadable on the darker tones.
   */
  const labelY = (b: Block) => py(b.gx, b.gy, b.h) - 9;

  // ---- the run ------------------------------------------------------------
  let leg = $state(0);
  let t = $state(0);            // 0..1 within the current leg
  let running = $state(false);
  let done = $state(false);
  let started = $state(false);

  // Handles are NOT reactive. See the note at the top of this file.
  let raf = 0;
  let last = 0;
  let observer: IntersectionObserver | null = null;

  const reduced = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now: number) {
    if (!running) return;
    const dt = last ? now - last : 16;
    last = now;
    const l = route[leg];
    const next = t + dt / l.ms;
    if (next >= 1) {
      if (leg >= route.length - 1) {
        t = 1;
        running = false;
        done = true;
        return;
      }
      leg = leg + 1;
      t = 0;
    } else {
      t = next;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    started = true;
    done = false;
    leg = 0;
    t = 0;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /** Autoplay once, when the scene actually reaches the reader. */
  function autoplay(node: HTMLElement) {
    if (reduced()) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started) start();
        }
      },
      { threshold: 0.45 },
    );
    observer.observe(node);
    return {
      destroy() {
        observer?.disconnect();
        observer = null;
        stop();
      },
    };
  }

  // ---- what the frame looks like -----------------------------------------
  const resolve = (id: string) => byId.get(NIGHT_ALIAS[id] ?? id) ?? BLOCKS[0];
  const from = $derived(resolve(route[Math.max(0, leg - 1)].to));
  const to = $derived(resolve(route[leg].to));

  /** Ease so the message settles into a building instead of slamming into it. */
  const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

  const packet = $derived.by(() => {
    const a = centre(from);
    const b = centre(to);
    const u = ease(t);
    const gx = a.gx + (b.gx - a.gx) * u;
    const gy = a.gy + (b.gy - a.gy) * u;
    // A gentle hop, so the eye can follow it across a flat plane.
    const hop = Math.sin(Math.PI * t) * 13;
    return { x: px(gx, gy), y: py(gx, gy, 10 + hop) };
  });

  /** A building is "hot" while the message is arriving at or sitting in it. */
  const hot = $derived(t > 0.62 ? to.id : t < 0.12 ? from.id : null);

  const pennies = $derived.by(() => {
    const prev = leg > 0 ? route[leg - 1].cost : 0;
    return prev + (route[leg].cost - prev) * t;
  });
  const money = $derived(`£${(pennies / 100).toFixed(4)}`);

  const roads = ROADS.map(([x, y]) => ({
    a: centre(byId.get(x) ?? BLOCKS[0]),
    b: centre(byId.get(y) ?? BLOCKS[0]),
  }));

  function open(b: Block) {
    if (b.section) goto(`/projects/engine-room/${b.section}`);
  }
</script>

<div class="city" class:night use:autoplay>
  <div class="scene">
    <svg viewBox="0 0 680 380" role="img"
         aria-label="An isometric town of six buildings — the front desk, the runtime, the archive, the tower, the outside and the works — with one message travelling between them.">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(28,22,17,0.05)" />
          <stop offset="100%" stop-color="rgba(28,22,17,0)" />
        </linearGradient>
        <radialGradient id="glow">
          <stop offset="0%" stop-color="#f0c98a" stop-opacity="0.9" />
          <stop offset="100%" stop-color="#f0c98a" stop-opacity="0" />
        </radialGradient>
      </defs>

      <rect width="680" height="380" fill="url(#sky)" />

      <!-- roads, on the ground plane, drawn before anything standing on it -->
      <g class="roads">
        {#each roads as r}
          <line x1={px(r.a.gx, r.a.gy)} y1={py(r.a.gx, r.a.gy)}
                x2={px(r.b.gx, r.b.gy)} y2={py(r.b.gx, r.b.gy)} />
        {/each}
      </g>

      <!-- buildings, far to near -->
      {#each ordered as b (b.id)}
        {@const f = faces(b)}
        <g class="block" class:hot={hot === b.id} class:clickable={!!b.section}
           style="--tone:{b.tone}"
           role="button" tabindex="0"
           aria-label="{b.label}. {b.what}"
           onclick={() => open(b)}
           onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(b); } }}>
          <polygon points={f.front} class="face front" />
          <polygon points={f.right} class="face right" />
          <polygon points={f.top} class="face top" />
          {#each windows(b) as w}
            <rect x={w.x - 3} y={w.y - 8} width="5" height="7" class="win" />
          {/each}
          <text x={px(b.gx + b.w / 2, b.gy + b.d / 2)} y={labelY(b)}
                text-anchor="middle" class="blabel">{b.label}</text>
        </g>
      {/each}

      <!-- the message -->
      {#if started}
        <g class="packet" transform="translate({packet.x},{packet.y})">
          <circle r="19" fill="url(#glow)" />
          <polygon points="0,-8 7,0 0,8 -7,0" class="gem" />
        </g>
      {/if}
    </svg>
  </div>

  <div class="hud">
    <!--
      Control first, on the left. It used to sit at the far right, directly underneath the
      site's fixed "Ask the system" dock — a play button you cannot press is not a control.
    -->
    <button type="button" class="h-btn" onclick={running ? stop : start}>
      {running ? 'Pause' : done || started ? 'Run it again' : playLabel}
    </button>
    <span class="h-step">{String(Math.min(leg + 1, route.length)).padStart(2, '0')}<em>/{route.length}</em></span>
    <p class="h-cap" aria-live="polite">
      {done ? verdict.head : started ? route[leg].caption : idle}
    </p>
    {#if showMeter}
      <span class="h-meter" aria-label="Running cost">{money}</span>
    {/if}
  </div>

  {#if done}
    <p class="verdict">
      {verdict.body}
      <a href="/projects/engine-room/{verdict.section}">Read the chapter →</a>
    </p>
  {/if}
</div>

<style>
  .city { margin: 4px 0 0; }

  .scene { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-sharp);
    background: linear-gradient(180deg, #f7f2e8 0%, #efe7d9 100%); overflow: hidden; }
  .scene svg { display: block; width: 100%; height: auto; }

  .roads line { stroke: rgba(28,22,17,0.13); stroke-width: 9; stroke-linecap: round; }

  .block { transition: opacity 0.2s; }
  .block.clickable { cursor: pointer; }
  .face { stroke: rgba(28,22,17,0.28); stroke-width: 0.9; stroke-linejoin: round;
    transition: fill 0.25s, filter 0.25s; }
  /* Low-poly shading: one hue, three flat values. No gradients on the solids. */
  .top   { fill: color-mix(in srgb, var(--tone) 62%, #fff); }
  .right { fill: color-mix(in srgb, var(--tone) 88%, #000 6%); }
  .front { fill: color-mix(in srgb, var(--tone) 70%, #000 22%); }
  .block.hot .top   { fill: color-mix(in srgb, var(--tone) 34%, #ffd9a0); }
  .block.hot .right { fill: color-mix(in srgb, var(--tone) 70%, #f0c98a 30%); }
  .block.hot .front { fill: color-mix(in srgb, var(--tone) 60%, #c98f3d 30%); }
  .block:hover .face, .block:focus-visible .face { filter: brightness(1.08); }
  .block:focus { outline: none; }
  .block:focus-visible .top { stroke: var(--accent); stroke-width: 2.5; }

  .win { fill: rgba(255,240,205,0.34); transition: fill 0.25s; }
  .block.hot .win { fill: rgba(255,238,190,0.95); }

  .blabel { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em;
    fill: rgba(28,22,17,0.6); text-transform: uppercase; }
  .block.hot .blabel { fill: var(--text-primary); font-weight: 600; }

  .gem { fill: #f6d9a0; stroke: #b8791f; stroke-width: 1.2; }

  .hud { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 10px;
    padding: 10px 14px; border: 1px solid rgba(28,22,17,0.13); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.5); }
  .h-step { font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 600;
    color: var(--accent-ink); flex-shrink: 0; }
  .h-step em { font-style: normal; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.4); }
  .h-cap { margin: 0; font-size: var(--fs-nav); line-height: 1.45; color: var(--text-primary); min-width: 0; flex: 1 1 260px; }

  .h-meter { margin-left: auto; }
  .h-meter { font-family: var(--font-mono); font-size: var(--fs-nav); font-variant-numeric: tabular-nums;
    color: var(--accent-ink); }
  .h-btn { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; cursor: pointer;
    color: #fff; background: var(--accent-ink); border: 1px solid var(--accent-ink);
    border-radius: var(--radius-sharp); padding: 7px 15px; white-space: nowrap; }
  .h-btn:hover { background: #0b4a53; }

  .verdict { margin: 10px 0 0; padding: 11px 15px; font-size: var(--fs-label); line-height: 1.6;
    color: rgba(28,22,17,0.78); max-width: 86ch;
    border-left: 3px solid var(--accent-ink); border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: var(--accent-ink-tint-12, rgba(14,91,102,0.08)); }
  .verdict a { color: var(--accent-ink); font-weight: 600; text-decoration: none; white-space: nowrap; }
  .verdict a:hover { text-decoration: underline; }

  /* ---- half past three in the morning -------------------------------------
     Same geometry, same component, different hour. Only the palette moves: the
     ground goes to ink, the roofs desaturate, and the windows become the only
     thing with any light in them — which is exactly what the chapter is about. */
  .night .scene { background: linear-gradient(180deg, #1c2129 0%, #12161c 100%); }
  .night .roads line { stroke: rgba(255,255,255,0.07); }
  .night .face { stroke: rgba(255,255,255,0.14); }
  .night .top   { fill: color-mix(in srgb, var(--tone) 30%, #161b22); }
  .night .right { fill: color-mix(in srgb, var(--tone) 22%, #0b0e13); }
  .night .front { fill: color-mix(in srgb, var(--tone) 16%, #070a0e); }
  .night .block.hot .top   { fill: color-mix(in srgb, var(--tone) 40%, #e8b96a); }
  .night .block.hot .right { fill: color-mix(in srgb, var(--tone) 40%, #8a6a2e); }
  .night .block.hot .front { fill: color-mix(in srgb, var(--tone) 34%, #4a3a1c); }
  .night .win { fill: rgba(255,236,182,0.22); }
  .night .block.hot .win { fill: rgba(255,232,168,0.98); }
  .night .blabel { fill: rgba(255,255,255,0.42); }
  .night .block.hot .blabel { fill: #f6e2bd; }

  @media (prefers-reduced-motion: reduce) {
    .packet { display: none; }
  }
</style>
