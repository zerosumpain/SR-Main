<script lang="ts" module>
  export type Place = 'phone' | 'lock' | 'home' | 'watch' | 'siri' | 'background';
</script>

<script lang="ts">
  // DeviceStage — an iPhone and an Apple Watch, drawn, that change to show whichever place
  // the reader picks: inside the app, the Lock Screen with a journey in the Dynamic Island,
  // the Home Screen widgets, the watch face, Siri, or the phone asleep in a pocket while the
  // app keeps working. Every count drawn (tabs, widgets, complications, intents, watch pages,
  // background modes) comes from the app manifest through props.
  //
  // The scenes cross-fade with CSS; their small loops stop for reduced motion. Tapping the
  // Dynamic Island, the screen or the watch picks that place too.
  interface Props {
    place: Place;
    onpick: (p: Place) => void;
    tabs: number;
    homeWidgets: number;
    complications: number;
    intents: number;
    watchPages: number;
    backgroundModes: number;
  }
  let { place, onpick, tabs, homeWidgets, complications, intents, watchPages, backgroundModes }: Props = $props();

  // Screen geometry
  const SX = 86, SY = 36, SW = 248, SH = 528;
  const tabW = $derived(SW / Math.max(tabs, 1));
  const phoneOn = $derived(place !== 'watch');
</script>

<svg viewBox="0 0 640 600" class="stage" data-place={place} role="img"
     aria-label="An iPhone and an Apple Watch, showing {place === 'phone' ? 'the app' : place === 'lock' ? 'the Lock Screen' : place === 'home' ? 'the Home Screen' : place === 'watch' ? 'the watch' : place === 'siri' ? 'Siri' : 'the phone asleep while the app keeps working'}.">
  <defs>
    <clipPath id="ds-screen"><rect x={SX} y={SY} width={SW} height={SH} rx="38" /></clipPath>
    <linearGradient id="ds-wall" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#3a2410" /><stop offset="0.55" stop-color="#7a3a0e" /><stop offset="1" stop-color="#c4570a" />
    </linearGradient>
    <radialGradient id="ds-orb" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#e9b955" /><stop offset="0.5" stop-color="#e8863a" /><stop offset="1" stop-color="#e8863a" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- ── the phone ── -->
  <g class="phone" class:dim={!phoneOn}>
    <rect class="ds-frame" x="72" y="22" width="276" height="556" rx="52" />
    <rect class="btn-side" x="348" y="160" width="5" height="80" rx="2" />
    <rect class="btn-side" x="67" y="130" width="5" height="44" rx="2" />
    <rect class="btn-side" x="67" y="190" width="5" height="70" rx="2" />
    <g clip-path="url(#ds-screen)">
      <rect class="screen" x={SX} y={SY} width={SW} height={SH} />

      <!-- inside the app -->
      <g class="scene" class:on={place === 'phone' || place === 'watch'} role="button" tabindex="-1" onclick={() => onpick('phone')} onkeydown={() => {}}>
        <rect class="bar-h" x="104" y="96" width="120" height="18" rx="4" />
        <rect class="ds-card hero-card" x="104" y="130" width="212" height="120" rx="14" />
        <path class="spark" d="M120 222 L150 200 L176 212 L204 176 L232 190 L262 158 L296 170" pathLength="1" />
        <rect class="ds-card" x="104" y="264" width="102" height="96" rx="14" />
        <rect class="ds-card" x="214" y="264" width="102" height="96" rx="14" />
        <rect class="ds-card" x="104" y="372" width="212" height="70" rx="14" />
        <rect class="tabbar" x={SX} y="488" width={SW} height="76" />
        {#each Array(tabs) as _, i}
          <circle class="tab" cx={SX + tabW * (i + 0.5)} cy="516" r={Math.min(9, tabW / 3.2)} />
        {/each}
        <rect class="tab-ind" x={SX + tabW * 0.18} y="536" width={tabW * 0.64} height="4" rx="2" style="--n:{tabs};--w:{tabW}px" />
      </g>

      <!-- Lock Screen -->
      <g class="scene" class:on={place === 'lock'}>
        <rect x={SX} y={SY} width={SW} height={SH} fill="url(#ds-wall)" />
        <rect class="clock" x="140" y="138" width="60" height="64" rx="10" /><rect class="clock" x="220" y="138" width="60" height="64" rx="10" />
        <rect class="date" x="170" y="118" width="80" height="8" rx="4" />
        <g class="la">
          <rect class="la-card" x="100" y="400" width="220" height="104" rx="20" />
          <circle class="la-pin" cx="126" cy="430" r="9" />
          <rect class="la-t" x="144" y="424" width="96" height="12" rx="6" />
          <line class="la-route" x1="120" y1="474" x2="300" y2="474" />
          <line class="la-done" x1="120" y1="474" x2="300" y2="474" />
          <circle class="la-dot" cx="120" cy="474" r="8" />
        </g>
      </g>

      <!-- Home Screen -->
      <g class="scene" class:on={place === 'home'}>
        <rect x={SX} y={SY} width={SW} height={SH} fill="url(#ds-wall)" opacity="0.55" />
        {#each Array(Math.max(homeWidgets, 1)) as _, w}
          <g class="widget" style="--d:{w * 0.15}s" transform="translate(104 {98 + w * 150})">
            <rect class="wg" width="212" height="132" rx="22" />
            {#if w % 2 === 0}
              {#each [0.9, 0.62, 0.78, 0.4] as v, b}
                <rect class="wg-bar" x="20" y={22 + b * 26} width={170 * v} height="14" rx="7" style="--d:{0.2 + b * 0.1}s" />
              {/each}
            {:else}
              {#each [0, 1, 2] as r}
                <rect class="wg-box" class:tick={r === 0} x="20" y={22 + r * 34} width="22" height="22" rx="6" />
                <rect class="wg-line" x="54" y={28 + r * 34} width={r === 1 ? 110 : 136} height="10" rx="5" />
              {/each}
            {/if}
          </g>
        {/each}
        {#each Array(8) as _, i}
          <rect class="icon" x={108 + (i % 4) * 54} y={410 + Math.floor(i / 4) * 62} width="42" height="42" rx="11" />
        {/each}
      </g>

      <!-- Siri -->
      <g class="scene" class:on={place === 'siri'}>
        <rect x={SX} y={SY} width={SW} height={SH} class="dark" />
        {#each Array(intents) as _, i}
          <g class="bubble" style="--d:{0.3 + i * 0.25}s">
            <rect x="110" y={130 + i * 70} width="200" height="50" rx="25" />
            <rect class="b-line" x="134" y={150 + i * 70} width={120 + (i % 2) * 30} height="10" rx="5" />
          </g>
        {/each}
        <circle class="orb" cx="210" cy="470" r="70" fill="url(#ds-orb)" />
        {#each Array(9) as _, i}
          <rect class="wave" x={160 + i * 12} y="456" width="6" height="28" rx="3" style="--d:{i * 0.09}s" />
        {/each}
      </g>

      <!-- Background: the phone asleep, the app still working -->
      <g class="scene" class:on={place === 'background'}>
        <rect x={SX} y={SY} width={SW} height={SH} class="dark" />
        <circle class="ping" cx="210" cy="250" r="20" /><circle class="ping p2" cx="210" cy="250" r="20" /><circle class="ping p3" cx="210" cy="250" r="20" />
        <path class="pin-big" d="M210 280 C 190 250, 186 238, 186 228 A24 24 0 1 1 234 228 C 234 238, 230 250, 210 280Z" />
        <circle class="pin-hole" cx="210" cy="228" r="8" />
        {#each Array(backgroundModes) as _, i}
          <g class="mode" style="--d:{0.3 + i * 0.2}s" transform="translate({210 + (i - (backgroundModes - 1) / 2) * 62} 420)">
            <circle r="22" />
            <path class="mode-arc" d="M-10 0 A10 10 0 1 1 0 10" />
          </g>
        {/each}
      </g>
    </g>
    <!-- Dynamic Island: compact everywhere, expanded on the Lock Screen -->
    <g class="island-hit" role="button" tabindex="-1" onclick={() => onpick('lock')} onkeydown={() => {}}>
      <rect class="island" x="168" y="50" width="84" height="26" rx="13" />
      <g class="island-x">
        <rect class="island" x="112" y="48" width="196" height="40" rx="20" />
        <circle class="ix-dot" cx="134" cy="68" r="8" />
        <rect class="ix-bar" x="152" y="64" width="112" height="8" rx="4" />
        <rect class="ix-fill" x="152" y="64" width="112" height="8" rx="4" />
      </g>
    </g>
  </g>

  <!-- ── the watch ── -->
  <g class="watch" class:on={place === 'watch'} role="button" tabindex="-1" onclick={() => onpick('watch')} onkeydown={() => {}}>
    <rect class="strap" x="474" y="180" width="92" height="300" rx="16" />
    <rect class="ds-frame" x="448" y="248" width="144" height="164" rx="40" />
    <rect class="crown" x="592" y="300" width="9" height="30" rx="3" />
    <rect class="wt-screen" x="460" y="260" width="120" height="140" rx="30" />
    <g class="wt-face">
      {#each Array(complications) as _, i}
        <circle class="wt-track" cx={490 + i * 60 / Math.max(complications - 1, 1)} cy="300" r="15" />
        <circle class="wt-ring" cx={490 + i * 60 / Math.max(complications - 1, 1)} cy="300" r="15" pathLength="1" style="--d:{0.3 + i * 0.2}s" />
      {/each}
      <rect class="wt-time" x="484" y="336" width="72" height="22" rx="6" />
      {#each Array(watchPages) as _, i}
        <circle class="wt-page" class:first={i === 0} cx={520 + (i - (watchPages - 1) / 2) * 12} cy="380" r="3.5" />
      {/each}
    </g>
  </g>
</svg>

<style>
  .stage { display: block; width: 100%; height: auto; overflow: visible; animation: float 7s ease-in-out infinite; }
  @keyframes float { 50% { transform: translateY(-6px); } }

  .ds-frame { fill: #241709; stroke: #5a3d22; stroke-width: 2; }
  .btn-side { fill: #3a2614; }
  .screen { fill: #f3ebdd; }
  .dark { fill: #120b05; }
  .phone { transition: opacity 0.5s, transform 0.6s var(--er-ease); transform-origin: 210px 300px; transform-box: view-box; }
  .phone.dim { opacity: 0.32; transform: scale(0.94) translateX(-10px); }

  .scene { opacity: 0; transition: opacity 0.5s; pointer-events: none; }
  .scene.on { opacity: 1; pointer-events: auto; }

  /* app */
  .bar-h { fill: #1a1008; }
  .ds-card { fill: rgba(26, 16, 8, 0.08); }
  .hero-card { fill: rgba(150, 97, 58, 0.18); }
  .spark { fill: none; stroke: var(--er-bronze); stroke-width: 4; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
  .scene.on .spark { animation: draw 1.6s 0.2s var(--er-ease) forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .tabbar { fill: #ece2d0; }
  .tab { fill: rgba(26, 16, 8, 0.28); }
  .tab-ind { fill: var(--er-orange); animation: walk calc(var(--n) * 1.1s) steps(var(--n)) infinite; }
  @keyframes walk { to { transform: translateX(calc(var(--n) * var(--w))); } }

  /* lock */
  .clock { fill: rgba(243, 235, 221, 0.9); }
  .date { fill: rgba(243, 235, 221, 0.6); }
  .la-card { fill: rgba(26, 16, 8, 0.72); }
  .la-pin { fill: var(--er-amber-ink); }
  .la-t { fill: rgba(243, 235, 221, 0.85); }
  .la-route { stroke: rgba(243, 235, 221, 0.25); stroke-width: 6; stroke-linecap: round; }
  .la-done { stroke: var(--er-amber-ink); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 180; stroke-dashoffset: 180; }
  .la-dot { fill: #f3ebdd; }
  .scene.on .la-done { animation: route 5s linear infinite; }
  .scene.on .la-dot { animation: dot 5s linear infinite; }
  @keyframes route { to { stroke-dashoffset: 0; } }
  @keyframes dot { to { transform: translateX(180px); } }

  .island { fill: #000; }
  .island-hit { cursor: pointer; }
  .island-x { opacity: 0; transition: opacity 0.45s; }
  [data-place='lock'] .island-x { opacity: 1; }
  .ix-dot { fill: var(--er-amber-ink); }
  .ix-bar { fill: rgba(243, 235, 221, 0.2); }
  .ix-fill { fill: var(--er-amber-ink); transform-box: fill-box; transform-origin: left; transform: scaleX(0.3); }
  [data-place='lock'] .ix-fill { animation: fill 5s linear infinite; }
  @keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

  /* home */
  .widget { opacity: 0; transition: opacity 0.5s var(--d); }
  .scene.on .widget { opacity: 1; }
  .wg { fill: rgba(243, 235, 221, 0.92); }
  .wg-bar { fill: var(--er-orange); transform-box: fill-box; transform-origin: left; }
  .wg-bar:nth-of-type(2) { fill: var(--er-amber); }
  .scene.on .wg-bar { animation: grow 0.9s var(--d) var(--er-ease) both; }
  @keyframes grow { from { transform: scaleX(0); } }
  .wg-box { fill: none; stroke: #1a1008; stroke-width: 2.5; }
  .wg-box.tick { fill: var(--er-bronze); stroke: var(--er-bronze); }
  .wg-line { fill: rgba(26, 16, 8, 0.25); }
  .icon { fill: rgba(243, 235, 221, 0.5); }

  /* siri */
  .bubble rect:first-child { fill: rgba(243, 235, 221, 0.12); stroke: rgba(243, 235, 221, 0.3); }
  .b-line { fill: rgba(243, 235, 221, 0.7); }
  .bubble { opacity: 0; transition: opacity 0.4s var(--d); }
  .scene.on .bubble { opacity: 1; }
  .orb { animation: breathe 2.4s ease-in-out infinite; transform-origin: 210px 470px; transform-box: view-box; }
  @keyframes breathe { 50% { transform: scale(1.15); } }
  .wave { fill: #f3ebdd; transform-box: fill-box; transform-origin: center; animation: wave 0.9s var(--d) ease-in-out infinite alternate; }
  @keyframes wave { from { transform: scaleY(0.25); } }

  /* background */
  .ping { fill: none; stroke: var(--er-amber-ink); stroke-width: 2; transform-origin: 210px 250px; transform-box: view-box; animation: ping 2.4s ease-out infinite; }
  .ping.p2 { animation-delay: 0.8s; } .ping.p3 { animation-delay: 1.6s; }
  @keyframes ping { from { transform: scale(1); opacity: 0.9; } to { transform: scale(5); opacity: 0; } }
  .pin-big { fill: var(--er-orange-ink); }
  .pin-hole { fill: #120b05; }
  .mode circle { fill: none; stroke: rgba(243, 235, 221, 0.35); stroke-width: 2; }
  .mode-arc { fill: none; stroke: #f3ebdd; stroke-width: 3; stroke-linecap: round; }
  .scene.on .mode-arc { animation: spin 1.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* watch */
  .watch { cursor: pointer; transition: transform 0.6s var(--er-ease), opacity 0.5s; transform-origin: 520px 330px; transform-box: view-box; opacity: 0.85; }
  .watch.on { transform: scale(1.32) translateX(-60px); opacity: 1; }
  .strap { fill: #5a3d22; }
  .crown { fill: #5a3d22; }
  .wt-screen { fill: #000; }
  .wt-track { fill: none; stroke: rgba(243, 235, 221, 0.18); stroke-width: 5; }
  .wt-ring { fill: none; stroke: var(--er-amber-ink); stroke-width: 5; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 0.3;
    transform-box: fill-box; transform-origin: center; transform: rotate(-90deg); }
  .wt-ring:nth-of-type(4) { stroke: var(--er-orange-ink); }
  .watch.on .wt-ring { animation: ring 1.4s var(--d) var(--er-ease) both; }
  @keyframes ring { from { stroke-dashoffset: 1; } }
  .wt-time { fill: rgba(243, 235, 221, 0.85); }
  .wt-page { fill: rgba(243, 235, 221, 0.35); }
  .wt-page.first { fill: #f3ebdd; }

  @media (prefers-reduced-motion: reduce) {
    .spark { stroke-dashoffset: 0; }
    .la-done { stroke-dashoffset: 60; }
  }
</style>
