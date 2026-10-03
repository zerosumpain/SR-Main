<script lang="ts">
  // AppEmblem — the App hub's hero drawing. A phone and a watch on one side, the site on the
  // other, and between them a single doorway every request must pass. Requests travel out
  // along the top wire and pass the door; notifications come back along the bottom one, sent
  // by the site itself. The pieces drawn are the app's own targets from the manifest.
  import { onMount } from 'svelte';
  import { inView } from '../../../lib/motion';
  import { shown, still } from '../../../lib/motion';

  interface Props { phones: number; watches: number }
  let { phones, watches }: Props = $props();

  const OUT = 'M196 170 C 250 150, 270 150, 300 170 S 360 190, 404 172';
  const BACK = 'M404 300 C 350 330, 300 340, 250 324 S 210 300, 196 300';

  let svg: SVGSVGElement | undefined = $state();
  let moving = $state(false);
  onMount(() => {
    if (still() || !svg) return;
    moving = true;
    return inView(svg, () => { svg?.unpauseAnimations(); return () => svg?.pauseAnimations(); }, { amount: 0 });
  });
</script>

<svg bind:this={svg} viewBox="0 0 540 440" role="img" {@attach shown()}
     aria-label="A phone and a watch reach the site through one guarded doorway, and the site sends notifications back.">
  <defs>
    <radialGradient id="ae-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--tone)" stop-opacity="0.22" />
      <stop offset="100%" stop-color="var(--tone)" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle cx="300" cy="236" r="190" fill="url(#ae-glow)" />

  <!-- wires -->
  <path class="wire" d={OUT} pathLength="1" data-draw />
  <path class="wire back" d={BACK} pathLength="1" data-draw style="--d:0.5s" />

  <!-- phone -->
  <g class="dev" data-pop style="--d:0.1s">
    <rect class="body" x="66" y="80" width="130" height="250" rx="24" />
    <rect class="screen" x="76" y="92" width="110" height="226" rx="16" />
    <rect class="island" x="111" y="100" width="40" height="11" rx="5.5" />
    <rect class="card" x="86" y="128" width="90" height="40" rx="7" />
    <rect class="tile" x="86" y="178" width="42" height="42" rx="8" /><rect class="tile" x="134" y="178" width="42" height="42" rx="8" />
    <rect class="tile" x="86" y="228" width="42" height="42" rx="8" /><rect class="tile hot" x="134" y="228" width="42" height="42" rx="8" />
  </g>
  <!-- watch -->
  <g transform="translate(-16 6)"><g class="dev" data-pop style="--d:0.25s">
    <rect class="strap" x="22" y="300" width="44" height="112" rx="8" />
    <rect class="body" x="8" y="324" width="72" height="66" rx="18" />
    <circle class="wring" cx="44" cy="357" r="20" pathLength="1" data-draw style="--d:1s" />
  </g></g>

  <!-- the doorway -->
  <g class="door" data-pop style="--d:0.4s">
    <path class="arch" d="M266 330 V196 A34 34 0 0 1 334 196 V330" />
    <rect class="lock" x="286" y="232" width="28" height="24" rx="3" />
    <path class="shackle" d="M292 232 V222 A8 8 0 0 1 308 222 V232" />
    <circle class="keyhole" cx="300" cy="243" r="3.5" />
  </g>

  <!-- the site -->
  <g class="site" data-pop style="--d:0.55s">
    {#each [0, 1, 2] as i}
      <rect class="rack" x="404" y={150 + i * 56} width="118" height="46" rx="3" />
      <circle class="led" cx="422" cy={173 + i * 56} r="5" style="--i:{i}" />
      <line class="slot" x1="440" y1={173 + i * 56} x2="504" y2={173 + i * 56} />
    {/each}
  </g>

  {#if moving}
    {#each [0, 1, 2] as i}
      <circle class="pkt" r="7"><animateMotion dur="3s" begin="{i}s" repeatCount="indefinite" path={OUT} /></circle>
    {/each}
    {#each [0, 1] as i}
      <rect class="pkt-back" x="-9" y="-6" width="18" height="12" rx="2"><animateMotion dur="4s" begin="{i * 2}s" repeatCount="indefinite" path={BACK} rotate="auto" /></rect>
    {/each}
  {/if}

  <text class="lab" x="131" y="62" text-anchor="middle">{phones} phone app</text>
  <text class="lab" x="96" y="434">{watches} watch app</text>
  <text class="lab hl" x="300" y="364" text-anchor="middle">one doorway</text>
  <text class="lab" x="463" y="132" text-anchor="middle">the site</text>
  <text class="sm" x="300" y="138" text-anchor="middle">requests →</text>
  <text class="sm" x="300" y="392" text-anchor="middle">← notifications</text>
</svg>

<style>
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .wire { fill: none; stroke: var(--fg-3); stroke-width: 3; }
  .wire.back { stroke: var(--tone); stroke-dasharray: none; }
  .body { fill: var(--fg); }
  .screen { fill: var(--lift); }
  .island { fill: var(--fg); }
  .card { fill: var(--tone); }
  .tile { fill: var(--rule-strong); }
  .tile.hot { fill: var(--tone); animation: blink 2.4s ease-in-out infinite; }
  @keyframes blink { 50% { opacity: 0.35; } }
  .strap { fill: var(--fg-3); }
  .wring { fill: none; stroke: var(--er-amber); stroke-width: 6; }
  .arch { fill: var(--lift); stroke: var(--fg); stroke-width: 5; }
  .lock { fill: var(--tone); }
  .shackle { fill: none; stroke: var(--tone); stroke-width: 4; }
  .keyhole { fill: var(--ground); }
  .rack { fill: var(--fg); }
  .led { fill: var(--er-amber); animation: led 1.6s calc(var(--i) * 0.4s) ease-in-out infinite; }
  @keyframes led { 50% { opacity: 0.25; } }
  .slot { stroke: var(--ground); stroke-width: 4; stroke-linecap: round; opacity: 0.45; }
  .pkt { fill: var(--fg); }
  .pkt-back { fill: var(--tone); }
  .lab { font-family: var(--er-display); font-size: 21px; fill: var(--fg); text-transform: uppercase; }
  .lab.hl { fill: var(--tone-text); }
  .sm { font-family: var(--er-mono); font-size: 16px; fill: var(--fg-3); }
</style>
