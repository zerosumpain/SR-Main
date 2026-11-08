<script lang="ts">
  // Doorway — the Native API in one picture. A request leaves a phone, reaches the one door
  // into the site, and either shows a key and walks through to the single area it may use,
  // or is turned away at the door. The reader switches between a paired phone and a stranger.
  // Labels are HTML under the drawing so they stay legible on a phone.
  let { mode }: { mode: 'paired' | 'stranger' } = $props();
  const AREAS = 6;
</script>

<div class="dw" data-mode={mode}>
  <svg viewBox="0 0 760 280" role="img"
       aria-label={mode === 'paired' ? 'A paired phone shows its key at the door and its request reaches one area of the site.' : 'A request with no valid key is stopped at the door and sent back.'}>
    <line class="path" x1="140" y1="150" x2="560" y2="150" />

    <!-- phone -->
    <rect class="dev" x="40" y="44" width="96" height="190" rx="18" />
    <rect class="scr" x="48" y="54" width="80" height="170" rx="12" />
    <rect class="isl" x="72" y="60" width="32" height="9" rx="4.5" />
    <circle class="badge" cx="88" cy="150" r="20" />
    {#if mode === 'paired'}
      <g class="key-ico" transform="translate(88 150)"><circle cx="-6" cy="0" r="6" /><path d="M0 0 H12 M8 0 V5 M12 0 V5" /></g>
    {:else}
      <path class="q" d="M82 144 A6 6 0 1 1 90 150 V154 M88 159 V160" />
    {/if}

    <!-- door -->
    <g class="door">
      <path class="arch" d="M318 250 V110 A42 42 0 0 1 402 110 V250" />
      <rect class="leaf" x="326" y="112" width="68" height="138" />
      <circle class="scan" cx="360" cy="150" r="30" />
    </g>

    <!-- site, as rooms -->
    <rect class="site" x="560" y="40" width="180" height="220" rx="4" />
    {#each Array(AREAS) as _, i}
      <rect class="room" class:target={i === 2} x={574 + (i % 2) * 80} y={54 + Math.floor(i / 2) * 68} width="72" height="58" rx="3" />
    {/each}

    <!-- the request -->
    <g class="req">
      <rect x="-20" y="-14" width="40" height="28" rx="3" />
      <path d="M-12 -4 H12 M-12 4 H4" />
    </g>
    <g class="verdict ok" transform="translate(360 150)"><circle r="18" /><path d="M-8 0 L-2 6 L9 -6" /></g>
    <g class="verdict no" transform="translate(360 150)"><circle r="18" /><path d="M-7 -7 L7 7 M7 -7 L-7 7" /></g>
  </svg>
  <div class="labels" aria-hidden="true">
    <span>{mode === 'paired' ? 'A paired phone' : 'Anything else'}</span>
    <span class="mid">The one door</span>
    <span class="end">The site, area by area</span>
  </div>
</div>

<style>
  .dw { width: 100%; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .path { stroke: var(--rule-strong); stroke-width: 3; stroke-dasharray: 2 10; stroke-linecap: round; }
  .dev { fill: #241709; }
  .scr { fill: var(--er-paper-hi); }
  .isl { fill: #000; }
  .badge { fill: var(--tone); }
  [data-mode='stranger'] .badge { fill: var(--fg-3); }
  .key-ico circle, .key-ico path { fill: none; stroke: #fff; stroke-width: 3; }
  .q { fill: none; stroke: #fff; stroke-width: 3.5; stroke-linecap: round; }
  .arch { fill: none; stroke: var(--fg); stroke-width: 6; }
  .leaf { fill: var(--wash); stroke: var(--rule-strong); stroke-width: 2; }
  .scan { fill: none; stroke: var(--tone); stroke-width: 3; opacity: 0.5; }
  .site { fill: var(--fg); }
  .room { fill: var(--rule-strong); opacity: 0.45; transition: fill 0.4s, opacity 0.4s; }
  [data-mode='paired'] .room.target { fill: var(--tone); opacity: 1; animation: room 3.2s infinite; }
  @keyframes room { 0%, 62% { opacity: 0.35; } 72%, 100% { opacity: 1; } }

  .req rect { fill: var(--er-amber); stroke: var(--fg); stroke-width: 2; }
  .req path { stroke: var(--fg); stroke-width: 3; }
  .req { transform: translate(160px, 150px); }
  [data-mode='paired'] .req { animation: through 3.2s var(--er-ease) infinite; }
  [data-mode='stranger'] .req { animation: bounce 3.2s var(--er-ease) infinite; }
  @keyframes through {
    0% { transform: translate(160px, 150px); opacity: 0; }
    8% { opacity: 1; }
    35%, 48% { transform: translate(300px, 150px); }
    70% { transform: translate(614px, 140px) scale(0.8); opacity: 1; }
    80%, 100% { transform: translate(614px, 140px) scale(0.6); opacity: 0; }
  }
  @keyframes bounce {
    0% { transform: translate(160px, 150px); opacity: 0; }
    8% { opacity: 1; }
    35%, 50% { transform: translate(300px, 150px); }
    75% { transform: translate(180px, 150px) rotate(-14deg); opacity: 1; }
    90%, 100% { transform: translate(160px, 150px); opacity: 0; }
  }
  .verdict { opacity: 0; }
  .verdict circle { stroke: var(--ground); stroke-width: 4; }
  .verdict path { fill: none; stroke: #fff; stroke-width: 4; stroke-linecap: round; }
  .verdict.ok circle { fill: var(--tone); }
  .verdict.no circle { fill: var(--fail); }
  [data-mode='paired'] .verdict.ok, [data-mode='stranger'] .verdict.no { animation: flash 3.2s infinite; }
  @keyframes flash { 0%, 34% { opacity: 0; } 40%, 52% { opacity: 1; } 60%, 100% { opacity: 0; } }

  .labels { display: grid; grid-template-columns: 1fr 1fr 1fr; margin-top: 10px; font-family: var(--er-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--fg-3); }
  .labels .mid { text-align: center; color: var(--tone-text); }
  .labels .end { text-align: right; }
  @media (prefers-reduced-motion: reduce) {
    .req { transform: translate(300px, 150px); }
    [data-mode='paired'] .verdict.ok, [data-mode='stranger'] .verdict.no { opacity: 1; }
  }
</style>
