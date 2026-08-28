<script lang="ts">
  // The plan is drawn at true size: the viewBox is millimetres, so a 1700 bath
  // is 1700 units long and the dimension lines are not decoration.
  import {
    FIX,
    doorGeom,
    foot,
    itemTransform,
    notchRect,
    place,
    wallPt,
    zone,
    type Item,
    type Plan,
  } from '../lib/fixtures';

  interface Props {
    plan: Plan;
    selected: number | null;
    onselect: (id: number | null) => void;
    onchange: () => void;
  }
  let { plan, selected, onselect, onchange }: Props = $props();

  let svgEl: SVGSVGElement | null = null;

  const M = 400; // margin for dimension lines
  const WT = 95; // drawn wall thickness

  const vb = $derived(`${-M} ${-M} ${plan.W + 2 * M} ${plan.D + 2 * M}`);
  const fs = $derived(Math.max(58, (plan.W + 2 * M) / 46));
  const dg = $derived(doorGeom(plan));
  const doorHole = $derived(opening(plan.door.wall, dg.A, dg.B));
  const dimY = -M + 220;
  const dimX = -M + 220;
  const nr = $derived(notchRect(plan));
  const stack = $derived(wallPt(plan, plan.stack.wall, plan.stack.pos));
  const gridX = $derived(
    Array.from({ length: Math.max(0, Math.floor((plan.W - 1) / 100)) }, (_, i) => (i + 1) * 100),
  );
  const gridY = $derived(
    Array.from({ length: Math.max(0, Math.floor((plan.D - 1) / 100)) }, (_, i) => (i + 1) * 100),
  );

  /** A hole punched through the wall band for a door or window opening. */
  function opening(wall: string, a: { x: number; y: number }, b: { x: number; y: number }) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const lx = Math.abs(b.x - a.x);
    const ly = Math.abs(b.y - a.y);
    if (wall === 'N') return { x, y: -WT, w: lx, h: WT };
    if (wall === 'S') return { x, y: plan.D, w: lx, h: WT };
    if (wall === 'W') return { x: -WT, y, w: WT, h: ly };
    return { x: plan.W, y, w: WT, h: ly };
  }

  const winPts = $derived.by(() => {
    if (!plan.win.on) return null;
    const a = wallPt(plan, plan.win.wall, plan.win.pos);
    const b = wallPt(plan, plan.win.wall, plan.win.pos + plan.win.w);
    const vert = plan.win.wall === 'W' || plan.win.wall === 'E';
    const sgn = plan.win.wall === 'N' || plan.win.wall === 'W' ? -1 : 1;
    return {
      hole: opening(plan.win.wall, a, b),
      lines: [0.34, 0.68].map((f) => {
        const k = sgn * WT * f;
        return {
          x1: a.x + (vert ? k : 0),
          y1: a.y + (vert ? 0 : k),
          x2: b.x + (vert ? k : 0),
          y2: b.y + (vert ? 0 : k),
        };
      }),
    };
  });

  function labelSize(it: Item) {
    const b = foot(it);
    return Math.max(30, Math.min(fs * 0.78, b.h * 0.42, b.w * 0.3));
  }

  /* ——— dragging ——— */
  let drag: { id: number; dx: number; dy: number; el: SVGGElement } | null = null;

  function toMM(ev: PointerEvent) {
    if (!svgEl) return { x: 0, y: 0 };
    const pt = svgEl.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const m = svgEl.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  function down(ev: PointerEvent, it: Item) {
    ev.preventDefault();
    onselect(it.id);
    const m = toMM(ev);
    const el = ev.currentTarget as SVGGElement;
    // The each block is keyed, so this node survives the re-render and keeps
    // the captured pointer.
    el.setPointerCapture(ev.pointerId);
    drag = { id: it.id, dx: m.x - it.x, dy: m.y - it.y, el };
  }

  function move(ev: PointerEvent) {
    if (!drag) return;
    const it = plan.items.find((i) => i.id === drag!.id);
    if (!it) return;
    const m = toMM(ev);
    place(plan, it, m.x - drag.dx, m.y - drag.dy);
    ev.preventDefault();
  }

  function up() {
    if (!drag) return;
    drag = null;
    onchange();
  }
</script>

<svg bind:this={svgEl} viewBox={vb} role="img" aria-label="Scale floor plan of the bathroom">
  <defs>
    <pattern
      id="bth-hatch"
      width="90"
      height="90"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line x1="0" y1="0" x2="0" y2="90" stroke="var(--line-strong)" stroke-width="16" />
    </pattern>
  </defs>

  <!-- wall band, then the room floor punched out of it -->
  <rect
    class="wall"
    x={-WT}
    y={-WT}
    width={plan.W + 2 * WT}
    height={plan.D + 2 * WT}
  />
  <rect class="paper" x="0" y="0" width={plan.W} height={plan.D} />

  {#each gridX as x (x)}
    <line class="grid" class:major={x % 500 === 0} x1={x} y1="0" x2={x} y2={plan.D} />
  {/each}
  {#each gridY as y (y)}
    <line class="grid" class:major={y % 500 === 0} x1="0" y1={y} x2={plan.W} y2={y} />
  {/each}

  {#if nr}
    <rect class="notch" x={nr.x} y={nr.y} width={nr.w} height={nr.h} />
  {/if}

  <!-- door -->
  <rect class="paper" x={doorHole.x} y={doorHole.y} width={doorHole.w} height={doorHole.h} />
  <line class="leaf" x1={dg.H.x} y1={dg.H.y} x2={dg.O.x} y2={dg.O.y} />
  {#if plan.door.swing.startsWith('in')}
    <path
      class="swing"
      d="M {dg.C.x},{dg.C.y} A {dg.dw},{dg.dw} 0 0 {dg.sweep} {dg.O.x},{dg.O.y}"
    />
  {/if}

  <!-- window -->
  {#if winPts}
    <rect class="paper" x={winPts.hole.x} y={winPts.hole.y} width={winPts.hole.w} height={winPts.hole.h} />
    {#each winPts.lines as l, i (i)}
      <line class="glass" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
    {/each}
  {/if}

  <!-- soil stack -->
  <circle class="stack-o" cx={stack.x} cy={stack.y} r="62" />
  <circle class="stack-i" cx={stack.x} cy={stack.y} r="26" />
  <text
    class="lbl"
    x={stack.x}
    y={stack.y + (plan.stack.wall === 'S' ? 150 : -95)}
    font-size={fs * 0.82}
    text-anchor="middle">SVP</text
  >

  <!-- activity zones sit under the fittings -->
  {#if plan.zones}
    {#each plan.items as it (it.id)}
      {@const z = zone(it)}
      {#if z}
        <rect class="zone" x={z.x} y={z.y} width={z.w} height={z.h} />
      {/if}
    {/each}
  {/if}

  <!-- fittings -->
  {#each plan.items as it (it.id)}
    {@const f = FIX[it.t]}
    <g
      class="item"
      role="button"
      tabindex="-1"
      aria-label={f.n}
      transform={itemTransform(it)}
      onpointerdown={(e) => down(e, it)}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      <rect class="fx" x="0" y="0" width={f.w} height={f.d} rx={f.k === 'bath' ? 70 : 10} />
      {#if f.k === 'bath'}
        <rect class="fx2" x="55" y="55" width={f.w - 110} height={f.d - 110} rx="50" />
        <circle class="fx2" cx={f.w - 190} cy={f.d / 2} r="42" />
        <circle class="fx3" cx={f.w - 190} cy={f.d / 2} r="14" />
        <rect class="fx2" x={f.w - 115} y={f.d / 2 - 45} width="55" height="90" rx="12" />
      {:else if f.k === 'shower'}
        <rect class="fx2" x="45" y="45" width={f.w - 90} height={f.d - 90} rx="6" />
        <circle class="fx2" cx={f.w / 2} cy={f.d / 2} r="55" />
        <circle class="fx3" cx={f.w / 2} cy={f.d / 2} r="18" />
        <line class="fxg" x1="30" y1="26" x2={f.w - 30} y2="26" />
      {:else if f.k === 'wc'}
        <rect class="fx2" x="0" y="0" width={f.w} height="190" rx="6" />
        <ellipse
          class="fx2"
          cx={f.w / 2}
          cy={190 + (f.d - 190) * 0.52}
          rx={f.w / 2 - 38}
          ry={(f.d - 190) * 0.45}
        />
      {:else if f.k === 'basin'}
        <ellipse class="fx2" cx={f.w / 2} cy={f.d * 0.55} rx={f.w / 2 - 55} ry={f.d * 0.33} />
        <rect class="fx2" x={f.w / 2 - 45} y="16" width="90" height="60" rx="10" />
      {:else if f.k === 'combo'}
        <line class="fxg" x1={f.w * 0.52} y1="0" x2={f.w * 0.52} y2={f.d} />
        <ellipse class="fx2" cx={f.w * 0.26} cy={f.d * 0.55} rx={f.w * 0.17} ry={f.d * 0.3} />
        <ellipse class="fx2" cx={f.w * 0.76} cy={f.d * 0.6} rx={f.w * 0.13} ry={f.d * 0.28} />
      {:else if f.k === 'rail'}
        {#each [1, 2, 3, 4, 5] as n (n)}
          <line class="fxg" x1={(f.w * n) / 6} y1="18" x2={(f.w * n) / 6} y2={f.d - 18} />
        {/each}
      {:else}
        <line class="fxg" x1="0" y1="0" x2={f.w} y2={f.d} />
        <line class="fxg" x1={f.w} y1="0" x2="0" y2={f.d} />
      {/if}
    </g>
  {/each}

  <!-- labels ride level, whatever the fitting's rotation -->
  {#each plan.items as it (it.id)}
    {@const b = foot(it)}
    {@const sz = labelSize(it)}
    <text
      class="lblf"
      x={b.x + b.w / 2}
      y={b.y + b.h / 2 + sz * 0.35}
      font-size={sz}
      text-anchor="middle">{FIX[it.t].s}</text
    >
    {#if selected === it.id}
      <rect class="ring" x={b.x - 24} y={b.y - 24} width={b.w + 48} height={b.h + 48} />
    {/if}
  {/each}

  <!-- dimensions -->
  <line class="dim" x1="0" y1={dimY} x2={plan.W} y2={dimY} />
  <line class="dim" x1="0" y1={dimY - 70} x2="0" y2={dimY + 70} />
  <line class="dim" x1={plan.W} y1={dimY - 70} x2={plan.W} y2={dimY + 70} />
  <text class="lbl" x={plan.W / 2} y={dimY - 60} font-size={fs} text-anchor="middle">{plan.W} mm</text>
  <line class="dim" x1={dimX} y1="0" x2={dimX} y2={plan.D} />
  <line class="dim" x1={dimX - 70} y1="0" x2={dimX + 70} y2="0" />
  <line class="dim" x1={dimX - 70} y1={plan.D} x2={dimX + 70} y2={plan.D} />
  <text
    class="lbl"
    x={dimX - 60}
    y={plan.D / 2}
    font-size={fs}
    text-anchor="middle"
    transform="rotate(-90 {dimX - 60} {plan.D / 2})">{plan.D} mm</text
  >
  <text class="lbl" x={plan.W} y={plan.D + M - 150} font-size={fs * 0.82} text-anchor="end"
    >{((plan.W * plan.D) / 1e6).toFixed(2)} m² · drawn to scale</text
  >
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
    touch-action: none;
    user-select: none;
  }
  .wall {
    fill: url(#bth-hatch);
    stroke: var(--text-primary);
    stroke-width: 1.4;
    vector-effect: non-scaling-stroke;
  }
  .paper { fill: var(--surface-card); }
  .notch {
    fill: url(#bth-hatch);
    stroke: var(--text-primary);
    stroke-width: 1.4;
    vector-effect: non-scaling-stroke;
  }
  .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .grid.major { stroke: var(--line); }
  .leaf {
    stroke: var(--text-primary);
    stroke-width: 2.2;
    vector-effect: non-scaling-stroke;
  }
  .swing {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1;
    stroke-dasharray: 14 10;
    vector-effect: non-scaling-stroke;
  }
  .glass {
    stroke: var(--text-primary);
    stroke-width: 1.3;
    vector-effect: non-scaling-stroke;
  }
  .stack-o {
    fill: var(--surface-card);
    stroke: var(--text-primary);
    stroke-width: 1.6;
    vector-effect: non-scaling-stroke;
  }
  .stack-i { fill: var(--accent); }
  .zone {
    fill: var(--accent-tint-08);
    stroke: var(--accent-tint-35);
    stroke-width: 1;
    stroke-dasharray: 5 4;
    vector-effect: non-scaling-stroke;
  }
  .item { cursor: grab; }
  .item:active { cursor: grabbing; }
  .fx {
    fill: var(--bg);
    stroke: var(--text-primary);
    stroke-width: 1.6;
    vector-effect: non-scaling-stroke;
  }
  .fx2 {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1.1;
    vector-effect: non-scaling-stroke;
    opacity: 0.7;
  }
  .fx3 { fill: var(--text-primary); opacity: 0.5; }
  .fxg {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    opacity: 0.45;
  }
  .lbl {
    font-family: var(--font-mono);
    fill: var(--text-muted);
  }
  .lblf {
    font-family: var(--font-mono);
    fill: var(--text-primary);
    opacity: 0.75;
    pointer-events: none;
  }
  .dim {
    stroke: var(--text-ghost);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .ring {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
</style>
