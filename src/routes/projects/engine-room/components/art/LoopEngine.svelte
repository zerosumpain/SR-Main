<script lang="ts">
  // LoopEngine — the index's centrepiece. Three meshing gears, one per part, turning at the
  // speeds their teeth dictate, with notes travelling the loop that runs round all three.
  //
  // The geometry is real enough to read as machinery: the teeth share one pitch, so the tooth
  // counts set the radii, the radii set the speeds, and each driven gear is phased so a gap
  // meets a tooth at the contact point. Each gear is a link to its part. Pointing at one
  // brings it forward and names what it does.
  //
  // Motion is CSS for the gears and SMIL for the travelling notes; both stop for a reader
  // with reduced motion, and pause when the drawing is off screen.
  import { onMount } from 'svelte';
  import { inView } from 'motion';
  import { PARTS, href, type PartId } from '../../lib/nav';
  import { still } from '../../lib/motion';

  interface Props {
    /** Optional captions under each part name, e.g. a live figure. */
    captions?: Partial<Record<PartId, string>>;
  }
  let { captions = {} }: Props = $props();

  const PITCH = (2 * Math.PI * 112) / 16; // one tooth pitch, shared by all three gears
  const radius = (n: number) => (PITCH * n) / (2 * Math.PI);
  const rad = (d: number) => (d * Math.PI) / 180;

  // Driver at c1; the others mesh with it at the given contact angles (degrees, clockwise from +x).
  const N = { daydream: 16, build: 12, app: 10 } as const;
  const c1 = { x: 236, y: 214 };
  const contact = { build: 18, app: 112 };
  const at = (deg: number, d: number) => ({ x: c1.x + d * Math.cos(rad(deg)), y: c1.y + d * Math.sin(rad(deg)) });
  const r1 = radius(N.daydream), r2 = radius(N.build), r3 = radius(N.app);
  const PERIOD = 46; // seconds for one turn of the driver

  const GEARS = [
    { id: 'daydream' as PartId, n: N.daydream, r: r1, c: c1, phase: contact.build, period: PERIOD, dir: 1 },
    { id: 'build' as PartId, n: N.build, r: r2, c: at(contact.build, r1 + r2), phase: contact.build + 180 - 180 / N.build, period: (PERIOD * N.build) / N.daydream, dir: -1 },
    { id: 'app' as PartId, n: N.app, r: r3, c: at(contact.app, r1 + r3), phase: contact.app + 180 - 180 / N.app, period: (PERIOD * N.app) / N.daydream, dir: -1 },
  ];

  /** A gear outline as one path: trapezoid teeth on a pitch circle, with an axle hole. */
  function gear(r: number, n: number) {
    const depth = 15, ro = r + depth / 2, ri = r - depth / 2, p = (2 * Math.PI) / n;
    const pt = (rr: number, a: number) => `${(rr * Math.cos(a)).toFixed(2)},${(rr * Math.sin(a)).toFixed(2)}`;
    let d = '';
    for (let k = 0; k < n; k++) {
      const a = k * p;
      d += `${k ? 'L' : 'M'}${pt(ri, a - 0.32 * p)}L${pt(ro, a - 0.17 * p)}L${pt(ro, a + 0.17 * p)}L${pt(ri, a + 0.32 * p)}`;
    }
    const h = r * 0.62;
    return `${d}Z M${h},0 A${h},${h} 0 1 0 ${-h},0 A${h},${h} 0 1 0 ${h},0Z`;
  }

  // The loop the notes travel: an ellipse round all three gears.
  const LOOP = 'M 40 270 A 252 222 0 1 1 544 270 A 252 222 0 1 1 40 270';
  const NOTES = 6;

  const partOf = (id: PartId) => PARTS.find((p) => p.id === id)!;
  // Where each gear's name sits, outside the loop, and the anchor its leader line starts from.
  const LABEL: Record<PartId, { x: number; y: number; anchor: 'start' | 'end' }> = {
    daydream: { x: 24, y: 40, anchor: 'start' },
    build: { x: 566, y: 128, anchor: 'end' },
    app: { x: 24, y: 506, anchor: 'start' },
  };

  let focus = $state<PartId | null>(null);
  let svg: SVGSVGElement | undefined = $state();
  let moving = $state(false);

  onMount(() => {
    if (still() || !svg) return;
    moving = true;
    return inView(svg, () => {
      svg?.unpauseAnimations();
      return () => svg?.pauseAnimations();
    }, { amount: 0 });
  });
</script>

<div class="le" class:focused={!!focus}>
  <svg bind:this={svg} viewBox="0 0 584 540" role="group" aria-label="The three parts turn together: Daydream drives Build, and Build's work reaches the App.">
    <defs>
      <path id="er-loop" d={LOOP} />
      <radialGradient id="er-glow" cx="50%" cy="45%" r="55%">
        <stop offset="0%" stop-color="#e8863a" stop-opacity="0.22" />
        <stop offset="100%" stop-color="#e8863a" stop-opacity="0" />
      </radialGradient>
    </defs>

    <ellipse cx="292" cy="270" rx="290" ry="262" fill="url(#er-glow)" />
    <use href="#er-loop" class="loop" />
    <use href="#er-loop" class="loop-flow" />

    {#each GEARS as g (g.id)}
      {@const p = partOf(g.id)}
      {@const lab = LABEL[g.id]}
      <a href={href(g.id)} class="g" data-part={g.id} class:on={focus === g.id}
         onpointerenter={() => (focus = g.id)} onpointerleave={() => (focus = null)}
         onfocus={() => (focus = g.id)} onblur={() => (focus = null)}
         aria-label="Part {p.no}, {p.name}: {p.strap}">
        <line class="lead" x1={lab.anchor === 'start' ? lab.x + 4 : lab.x - 4} y1={lab.y + 14} x2={g.c.x} y2={g.c.y} />
        <g transform="translate({g.c.x} {g.c.y})">
          <g class="spin" style="--from:{g.phase}deg;--to:{g.phase + 360 * g.dir}deg;--t:{g.period}s">
            <path class="body" d={gear(g.r, g.n)} fill-rule="evenodd" />
          </g>
          <circle class="hub" r={g.r * 0.5} />
          <g class="icon" transform="scale({g.r / 112})">
            {#if g.id === 'daydream'}
              <path d="M10 -30 A30 30 0 1 0 30 12 A24 24 0 1 1 10 -30Z" />
              <circle cx="22" cy="-22" r="3.5" /><circle cx="33" cy="-6" r="2.5" />
            {:else if g.id === 'build'}
              <path d="M-26 -10 L-40 0 L-26 10 M26 -10 L40 0 L26 10 M8 -24 L-8 24" fill="none" stroke-width="7" stroke-linecap="square" />
            {:else}
              <rect x="-17" y="-30" width="34" height="60" rx="7" fill="none" stroke-width="6" />
              <path d="M-6 -22 H6" stroke-width="4" />
            {/if}
          </g>
        </g>
        <text class="name" x={lab.x} y={lab.y} text-anchor={lab.anchor}>{p.no} · {p.name}</text>
        <text class="cap" x={lab.x} y={lab.y + 20} text-anchor={lab.anchor}>{captions[g.id] ?? p.strap}</text>
      </a>
    {/each}

    {#if moving}
      {#each Array(NOTES) as _, i}
        <g class="note">
          <rect x="-11" y="-8" width="22" height="16" rx="2" />
          <path d="M-6 -2 H6 M-6 3 H2" />
          <animateMotion dur="14s" repeatCount="indefinite" rotate="auto" begin="{(-14 * i) / NOTES}s">
            <mpath href="#er-loop" />
          </animateMotion>
        </g>
      {/each}
    {/if}
  </svg>
</div>

<style>
  .le { width: 100%; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .loop { fill: none; stroke: var(--rule-strong); stroke-width: 1.5; }
  .loop-flow { fill: none; stroke: var(--er-orange-ink); stroke-width: 2; stroke-dasharray: 2 18; animation: flow 3s linear infinite; opacity: 0.8; }
  @keyframes flow { to { stroke-dashoffset: -40; } }

  .g { cursor: pointer; outline: none; }
  .g .body { fill: var(--tone); transition: fill 0.4s, opacity 0.4s; }
  .g .hub { fill: var(--er-ink); stroke: var(--tone-text); stroke-width: 2; }
  .g .icon { fill: var(--tone-text); stroke: var(--tone-text); }
  .spin { transform: rotate(var(--from)); animation: spin var(--t) linear infinite; }
  @keyframes spin { from { transform: rotate(var(--from)); } to { transform: rotate(var(--to)); } }

  .lead { stroke: var(--tone-text); stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.5; transition: opacity 0.3s; }
  .name { font-family: var(--er-display); font-size: 22px; fill: var(--fg); text-transform: uppercase; letter-spacing: 0.01em; }
  .cap { font-family: var(--er-mono); font-size: 13px; fill: var(--tone-text); }

  .focused .g:not(.on) .body { opacity: 0.28; }
  .focused .g:not(.on) .name, .focused .g:not(.on) .cap, .focused .g:not(.on) .lead { opacity: 0.35; }
  .g.on .lead { opacity: 1; stroke-dasharray: none; }
  .g:focus-visible .hub { stroke: var(--you); stroke-width: 4; }

  .note rect { fill: var(--er-cream); }
  .note path { stroke: var(--er-ink); stroke-width: 1.6; }
</style>
