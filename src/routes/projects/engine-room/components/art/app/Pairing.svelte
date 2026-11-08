<script lang="ts" module>
  export type PairStep = 'code' | 'scan' | 'key' | 'hash';
</script>

<script lang="ts">
  // Pairing — four drawings for the four steps of pairing a phone: a short-lived code on the
  // site, the phone reading it, a key of the phone's own, and the fingerprint that is all the
  // site keeps. The reader steps through; nothing plays by itself. The lifetimes come from
  // native-auth through facts, and are printed by the page beside this.
  let { step }: { step: PairStep } = $props();
</script>

<svg viewBox="0 0 600 300" class="pr" data-step={step} role="img" aria-label="Pairing, step: {step}">
  <!-- the site's screen, with the code -->
  <g class="laptop" class:on={step === 'code' || step === 'scan'}>
    <rect class="lid" x="40" y="40" width="250" height="160" rx="8" />
    <rect class="lcd" x="52" y="52" width="226" height="136" rx="3" />
    <path class="base" d="M20 206 H310 L296 222 H34Z" />
    {#each Array(6) as _, i}
      <rect class="cell" x={70 + i * 33} y="98" width="26" height="36" rx="3" style="--d:{i * 0.08}s" />
      <rect class="cell-ln" x={77 + i * 33} y="114" width="12" height="5" rx="2.5" />
    {/each}
    <circle class="timer-bg" cx="246" cy="74" r="13" />
    <circle class="timer" cx="246" cy="74" r="13" pathLength="1" />
  </g>

  <!-- the phone -->
  <g class="phone" class:near={step === 'scan'}>
    <rect class="ph" x="400" y="40" width="112" height="224" rx="20" />
    <rect class="ph-s" x="409" y="50" width="94" height="204" rx="13" />
    <g class="cam" class:on={step === 'scan'}>
      <path d="M422 90 v-14 h14 M490 90 v-14 h-14 M422 170 v14 h14 M490 170 v14 h-14" />
      <line class="laser" x1="424" y1="130" x2="488" y2="130" />
    </g>
    <g class="pkey" class:on={step === 'key' || step === 'hash'}>
      <circle cx="440" cy="150" r="16" /><path d="M456 150 H486 M478 150 V162 M486 150 V158" />
    </g>
  </g>

  <!-- the key's lifetime -->
  <g class="life" class:on={step === 'key'}>
    <circle class="life-bg" cx="200" cy="140" r="70" />
    <circle class="life-arc" cx="200" cy="140" r="70" pathLength="1" />
    {#each Array(12) as _, i}<line class="life-tick" x1="200" y1="62" x2="200" y2="72" transform="rotate({i * 30} 200 140)" />{/each}
  </g>

  <!-- only a fingerprint stored -->
  <g class="vault" class:on={step === 'hash'}>
    <path class="flow" d="M396 150 H260" />
    <g class="fp">
      {#each Array(5) as _, i}<path d="M{170 - i * 7} {150 + i * 2} a{14 + i * 7} {16 + i * 8} 0 0 1 {28 + i * 14} 0" style="--d:{0.2 + i * 0.08}s" />{/each}
    </g>
    <ellipse class="db-top" cx="184" cy="214" rx="64" ry="14" />
    <path class="db" d="M120 214 V256 A64 14 0 0 0 248 256 V214" />
    <g class="nokey"><circle cx="320" cy="96" r="22" /><path d="M306 82 L334 110" /></g>
  </g>
</svg>

<style>
  .pr { display: block; width: 100%; height: auto; overflow: visible; }
  .laptop, .life, .vault { opacity: 0; transition: opacity 0.5s; }
  .laptop.on, .life.on, .vault.on { opacity: 1; }
  .lid { fill: var(--fg); }
  .lcd { fill: var(--lift); }
  .base { fill: var(--fg-3); }
  .cell { fill: var(--ground); stroke: var(--tone); stroke-width: 2; }
  .cell-ln { fill: var(--fg); }
  [data-step='code'] .cell { animation: in 0.4s var(--d) var(--er-ease) both; }
  @keyframes in { from { opacity: 0; transform: translateY(8px); } }
  .timer-bg { fill: none; stroke: var(--rule); stroke-width: 4; }
  .timer { fill: none; stroke: var(--tone); stroke-width: 4; stroke-dasharray: 1; transform: rotate(-90deg); transform-origin: 246px 74px; transform-box: view-box; }
  [data-step='code'] .timer { animation: drain 6s linear infinite; }
  @keyframes drain { to { stroke-dashoffset: 1; } }

  .phone { transition: transform 0.7s var(--er-ease); }
  .phone.near { transform: translateX(-60px) rotate(-6deg); transform-origin: 456px 150px; transform-box: view-box; }
  .ph { fill: #241709; }
  .ph-s { fill: var(--er-paper-hi); }
  .cam { opacity: 0; transition: opacity 0.4s; }
  .cam.on { opacity: 1; }
  .cam path { fill: none; stroke: var(--tone); stroke-width: 4; }
  .laser { stroke: var(--tone); stroke-width: 2; }
  .cam.on .laser { animation: laser 1.6s ease-in-out infinite alternate; }
  @keyframes laser { from { transform: translateY(-36px); } to { transform: translateY(36px); } }
  .pkey { opacity: 0; transition: opacity 0.5s; }
  .pkey.on { opacity: 1; }
  .pkey circle, .pkey path { fill: none; stroke: var(--tone); stroke-width: 6; stroke-linecap: round; }

  .life-bg { fill: none; stroke: var(--rule); stroke-width: 12; }
  .life-arc { fill: none; stroke: var(--tone); stroke-width: 12; stroke-dasharray: 1; stroke-dashoffset: 1; transform: rotate(-90deg); transform-origin: 200px 140px; transform-box: view-box; }
  .life.on .life-arc { animation: fillring 1.8s var(--er-ease) forwards; }
  @keyframes fillring { to { stroke-dashoffset: 0; } }
  .life-tick { stroke: var(--fg-3); stroke-width: 2; }

  .flow { stroke: var(--tone); stroke-width: 3; stroke-dasharray: 4 10; }
  .vault.on .flow { animation: flow 1s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: 28; } }
  .fp path { fill: none; stroke: var(--fg); stroke-width: 3; stroke-linecap: round; }
  .vault.on .fp path { animation: in 0.5s var(--d) var(--er-ease) both; }
  .db, .db-top { fill: var(--wash); stroke: var(--fg); stroke-width: 3; }
  .nokey circle { fill: none; stroke: var(--fail); stroke-width: 4; }
  .nokey path { stroke: var(--fail); stroke-width: 4; }
  @media (prefers-reduced-motion: reduce) { .life-arc { stroke-dashoffset: 0; } }
</style>
