<script lang="ts">
  // BuildEmblem — the Build hub's drawing. A crane over a blueprint lowers a block of code onto
  // a half-built page while a gear turns at its base: the site building its own next piece.
  // The blueprint lines draw themselves when seen; the hook bobs and the gear turns while on
  // screen, and both hold still for reduced motion.
  import { shown, liveOnlyInView } from '../../../lib/motion';

  const gear = (() => {
    const n = 10, ro = 34, ri = 26, p = (2 * Math.PI) / n;
    let d = '';
    for (let k = 0; k < n; k++) {
      const a = k * p, pt = (r: number, x: number) => `${(r * Math.cos(x)).toFixed(1)},${(r * Math.sin(x)).toFixed(1)}`;
      d += `${k ? 'L' : 'M'}${pt(ri, a - 0.3 * p)}L${pt(ro, a - 0.16 * p)}L${pt(ro, a + 0.16 * p)}L${pt(ri, a + 0.3 * p)}`;
    }
    return d + 'Z';
  })();
</script>

<svg viewBox="0 0 480 420" role="img" aria-label="A crane lowers a block of code onto a half-built page, beside a turning gear." {@attach shown()} {@attach liveOnlyInView()}>
  <!-- blueprint -->
  <g class="grid">
    {#each Array(9) as _, i}<line x1={40 + i * 50} y1="40" x2={40 + i * 50} y2="400" />{/each}
    {#each Array(8) as _, i}<line x1="40" y1={50 + i * 50} x2="440" y2={50 + i * 50} />{/each}
  </g>
  <!-- the page being built -->
  <g class="page">
    <rect class="frame" x="200" y="200" width="220" height="180" rx="2" pathLength="1" data-draw />
    <rect class="row a" x="218" y="300" width="184" height="26" rx="2" data-pop style="--d:0.5s" />
    <rect class="row b" x="218" y="336" width="120" height="26" rx="2" data-pop style="--d:0.7s" />
    <rect class="row c" x="346" y="336" width="56" height="26" rx="2" data-pop style="--d:0.8s" />
    <path class="gap" d="M218 220 H402 V286 H218 Z" />
  </g>
  <!-- crane -->
  <g class="crane">
    <path class="mast" d="M90 400 V70 M90 70 H400 M90 110 L130 70 M90 160 L170 70" pathLength="1" data-draw style="--d:0.2s" />
    <path class="mast thin" d="M70 70 H90 M60 90 H90" pathLength="1" data-draw style="--d:0.3s" />
    <rect class="weight" x="46" y="70" width="34" height="34" rx="2" />
    <g class="hook">
      <line class="cable" x1="310" y1="70" x2="310" y2="200" />
      <g transform="translate(310 200)">
        <rect class="block" x="-92" y="0" width="184" height="64" rx="2" />
        <path class="code" d="M-52 22 L-66 32 L-52 42 M52 22 L66 32 L52 42 M10 16 L-10 48" />
      </g>
    </g>
  </g>
  <g transform="translate(120 360)"><g class="spin"><path class="gear" d={gear} /></g><circle class="axle" r="10" /></g>
</svg>

<style>
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .grid line { stroke: var(--er-petrol); stroke-width: 1; opacity: 0.18; }
  .frame { fill: none; stroke: var(--fg); stroke-width: 3; }
  .row { fill: var(--rule-strong); }
  .row.a { fill: var(--tone); }
  .gap { fill: none; stroke: var(--tone); stroke-width: 2; stroke-dasharray: 6 6; }
  .mast { fill: none; stroke: var(--fg); stroke-width: 6; stroke-linecap: square; }
  .mast.thin { stroke-width: 3; }
  .weight { fill: var(--er-brown); }
  .cable { stroke: var(--fg); stroke-width: 2.5; }
  .block { fill: var(--tone); stroke: var(--fg); stroke-width: 3; }
  .code { fill: none; stroke: var(--er-paper-hi); stroke-width: 6; stroke-linecap: square; }
  .hook { animation: lower 4.5s var(--er-ease) infinite; }
  @keyframes lower { 0%, 15% { transform: translateY(-50px); } 60%, 80% { transform: translateY(18px); } 100% { transform: translateY(-50px); } }
  .gear { fill: var(--er-amber); }
  .spin { animation: turn 6s linear infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  .axle { fill: var(--ground); stroke: var(--fg); stroke-width: 3; }
</style>
