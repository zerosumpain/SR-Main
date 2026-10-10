<script lang="ts">
  // DreamEmblem — Daydream's hub art. A clock face for the schedule it keeps, a moon rising
  // over it for the idle hours it thinks in, and thought bubbles drifting up into notes.
  // The hand sweeps once per thinking cycle (scaled down to a few seconds), and each time it
  // passes the top a bubble rises. Pointing at the drawing slows everything to a crawl, so
  // a curious reader can look closely.
  import { shown, liveOnlyInView } from '../../../lib/motion';

  interface Props {
    cadence: number;
    activeHours: { start: number; end: number };
  }
  let { cadence, activeHours }: Props = $props();

  // The active-hours arc on a twenty-four hour dial, in degrees from twelve o'clock.
  const deg = (h: number) => (h / 24) * 360;
  const arc = (r: number, a0: number, a1: number) => {
    const p = (a: number) => [200 + r * Math.sin((a * Math.PI) / 180), 230 - r * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const wake = $derived(arc(132, deg(activeHours.start), deg(activeHours.end)));
  // One tick per thinking slot across the waking day.
  const slots = $derived(Math.ceil(((activeHours.end - activeHours.start) * 60) / cadence));
  let slow = $state(false);
</script>

<div class="de" class:slow role="img"
  aria-label="A clock with the waking hours from {activeHours.start}:00 to {activeHours.end}:00 marked; it thinks once every {cadence} minutes in that window, and each thought may become a note."
  onpointerenter={() => (slow = true)} onpointerleave={() => (slow = false)}>
  <svg viewBox="0 0 420 440" {@attach shown()} {@attach liveOnlyInView()}>
    <defs>
      <radialGradient id="de-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#d39a2c" stop-opacity="0.32" />
        <stop offset="100%" stop-color="#d39a2c" stop-opacity="0" />
      </radialGradient>
    </defs>
    <circle cx="200" cy="230" r="190" fill="url(#de-glow)" />

    <!-- the dial -->
    <circle class="face" cx="200" cy="230" r="150" />
    <circle class="rim" cx="200" cy="230" r="150" pathLength="1" data-draw />
    <path class="wake" d={wake} pathLength="1" data-draw style="--d:0.5s" />
    {#each Array(slots) as _, i}
      {@const a = deg(activeHours.start) + ((i * cadence) / 60 / 24) * 360}
      <line class="slot" x1="200" y1="88" x2="200" y2="100" transform="rotate({a} 200 230)" data-pop style="--d:{0.8 + i * 0.03}s" />
    {/each}
    {#each [0, 6, 12, 18] as h}
      <text class="hr" x={200 + 118 * Math.sin((deg(h) * Math.PI) / 180)} y={236 - 118 * Math.cos((deg(h) * Math.PI) / 180)} text-anchor="middle">{String(h).padStart(2, '0')}</text>
    {/each}
    <g class="hand"><line x1="200" y1="230" x2="200" y2="112" /><circle cx="200" cy="112" r="7" /></g>
    <circle class="pin" cx="200" cy="230" r="10" />

    <!-- the moon -->
    <g class="moon" data-pop style="--d:0.3s">
      <path d="M318 40 A46 46 0 1 0 366 112 A36 36 0 1 1 318 40Z" />
    </g>
    <circle class="star" cx="250" cy="34" r="3" /><circle class="star s2" cx="390" cy="160" r="2.5" /><circle class="star s3" cx="40" cy="70" r="2.5" />

    <!-- thought bubbles rising into a note -->
    <g class="bubbles">
      <circle class="bub b1" cx="96" cy="96" r="9" />
      <circle class="bub b2" cx="74" cy="62" r="14" />
      <g class="note">
        <rect x="8" y="-6" width="96" height="52" rx="2" />
        <rect class="nt" x="18" y="4" width="40" height="10" rx="5" />
        <line x1="18" y1="24" x2="92" y2="24" /><line x1="18" y1="36" x2="74" y2="36" />
      </g>
    </g>
  </svg>
</div>

<style>
  .de { width: 100%; max-width: 520px; margin: 0 auto; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .face { fill: var(--lift); }
  .rim { fill: none; stroke: var(--fg); stroke-width: 4; }
  .wake { fill: none; stroke: var(--tone); stroke-width: 14; stroke-linecap: butt; }
  .slot { stroke: var(--fg-3); stroke-width: 2.5; }
  .hr { font-family: var(--er-mono); font-size: 15px; fill: var(--fg-3); }
  .hand { transform-origin: 200px 230px; transform-box: view-box; animation: sweep 6s linear infinite; }
  .hand line { stroke: var(--tone-text); stroke-width: 7; stroke-linecap: round; }
  .hand circle { fill: var(--tone); }
  .pin { fill: var(--fg); }
  @keyframes sweep { to { transform: rotate(360deg); } }
  .moon path { fill: var(--er-amber); }
  .moon { animation: bob 7s ease-in-out infinite; transform-box: fill-box; }
  @keyframes bob { 50% { transform: translateY(-6px) rotate(-4deg); } }
  .star { fill: var(--tone); animation: twinkle 3s ease-in-out infinite; }
  .s2 { animation-delay: 1s; } .s3 { animation-delay: 2s; }
  @keyframes twinkle { 50% { opacity: 0.2; } }
  .bub { fill: var(--lift); stroke: var(--fg); stroke-width: 2.5; }
  .b1 { animation: float 6s ease-out infinite; }
  .b2 { animation: float 6s 0.25s ease-out infinite; }
  .note rect:first-child { fill: var(--lift); stroke: var(--fg); stroke-width: 2.5; }
  .note .nt { fill: var(--tone); }
  .note line { stroke: var(--rule-strong); stroke-width: 5; }
  .note { animation: rise 6s 0.5s ease-out infinite; }
  @keyframes float { 0% { transform: translate(40px, 60px); opacity: 0; } 20% { opacity: 1; } 70% { opacity: 1; } 100% { transform: translate(0, 0); opacity: 0; } }
  @keyframes rise { 0%, 30% { transform: translateY(30px); opacity: 0; } 50%, 85% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
  .slow .hand, .slow .moon, .slow .bub, .slow .note, .slow .star { animation-duration: 40s; }
</style>
