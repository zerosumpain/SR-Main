<svelte:options css="injected" />

<script lang="ts">
  // The place's sky beside the title (HeroPlace): the next daydream as a
  // cloud, filling as the wait runs out, raining once onto the title when a
  // think fires, lying low as mist out of hours and struck faint when off.
  // A picture only; HeroPlace's daydream label carries the words. It is
  // weather, so it wears the light: ink at night, a slate underside in the
  // low light, warmed at either end of the day, and white on the daytime sky
  // (place-city.ts sets --city-cloud*).
  import type { CloudMode } from '$lib/landing/place';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let { weather }: { weather: { mode: CloudMode; fill: number } } = $props();

  // The cloud's outline: nine puffs in a 180×110 box.
  const PUFFS = [[28, 74, 20], [58, 77, 23], [90, 78, 25], [122, 77, 23], [152, 74, 19], [52, 52, 25], [90, 46, 30], [126, 54, 24], [96, 24, 24]];
</script>

<div class="pl-cloud" data-part="daydream" data-mode={weather.mode} aria-hidden="true">
  <svg viewBox="0 0 180 110" focusable="false">
    <defs>
      <clipPath id="pl-cloud-in">{#each PUFFS as [x, y, r] (`${x},${y}`)}<circle cx={x} cy={y} {r} />{/each}</clipPath>
      <mask id="pl-cloud-rim" maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="110">
        <rect width="180" height="110" fill="#fff" />
        {#each PUFFS as [x, y, r] (`${x},${y}`)}<circle cx={x} cy={y} r={r - 1.3} fill="#000" />{/each}
      </mask>
    </defs>
    {#if weather.mode === 'mist'}
      <!-- Out of hours the cloud lies low as a bank of mist. -->
      <path class="cl-fog" d="M44,58 H150 M18,72 H122 M66,86 H166 M36,100 H118" />
    {:else}
      <g clip-path="url(#pl-cloud-in)">
        <rect class="cl-body" width="180" height="110" />
        {#if weather.fill > 0}
          <rect class="cl-fill" y={103 - weather.fill * 99} width="180" height={weather.fill * 99 + 8} />
          <path class="cl-line" d="M0,{103 - weather.fill * 99} H180" />
        {/if}
      </g>
      <g class="cl-rim" mask="url(#pl-cloud-rim)">
        {#each PUFFS as [x, y, r] (`${x},${y}`)}<circle cx={x} cy={y} {r} />{/each}
      </g>
    {/if}
  </svg>
  <!-- On a phone the cloud is the rambler's step down from the title: a shelf
       across its shoulders, there and nowhere else (no box, no floor). -->
  <span class="pl-shelf" use:scenery></span>
  {#if weather.mode === 'rain'}
    <!-- One thought, rained onto the title: a few beats, then the drops hang still. -->
    <span class="pl-rain">
      {#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}<i style:--i={i} style:--j={(i * 37) % 23}></i>{/each}
    </span>
  {/if}
</div>

<style>
  /* The cloud beside the title: the next daydream. */
  .pl-cloud {
    position: absolute;
    z-index: 1;
    left: var(--cloud-l);
    top: var(--cloud-t);
    width: var(--cloud-w);
  }
  .pl-cloud svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .cl-body {
    fill: var(--city-cloud, #0f1213);
    opacity: 0.9;
  }
  .cl-fill {
    fill: var(--city-cloud-fill, #4f7d82);
  }
  .cl-line {
    stroke: var(--city-cloud-line, #bfe3e7);
    stroke-width: 1.4;
  }
  .cl-rim circle {
    fill: none;
    stroke: var(--city-cloud-rim, #7fb8c0);
    stroke-width: 1.3;
  }
  .cl-fog {
    fill: none;
    stroke: var(--city-cloud-rim, #7fb8c0);
    stroke-opacity: 0.6;
    stroke-width: 3;
    stroke-linecap: round;
  }
  .pl-cloud[data-mode='late'] .cl-fill {
    fill: color-mix(in srgb, var(--city-cloud-fill, #4f7d82) 62%, var(--city-cloud, #0f1213));
  }
  .pl-cloud[data-mode='off'] .cl-body {
    opacity: 0.3;
  }
  .pl-cloud[data-mode='off'] .cl-rim circle {
    stroke-dasharray: 3 4;
    stroke-opacity: 0.7;
  }
  .pl-shelf {
    display: none;
    position: absolute;
    left: 20%;
    width: 60%;
    top: 24%;
    height: 1px;
  }
  .pl-rain {
    position: absolute;
    left: 22%;
    top: 88%;
    width: 60%;
    height: 80px;
    pointer-events: none;
  }
  .pl-rain i {
    position: absolute;
    left: calc(var(--i) * 12.5%);
    top: calc(var(--j) * 1px);
    width: 1.5px;
    height: 10px;
    border-radius: 2px;
    background: var(--city-cloud-line, #bfe3e7);
    transform: rotate(14deg);
    opacity: 0.55;
    animation: pl-fall calc(var(--beat) * 1.4) linear calc(var(--i) * var(--beat) * 0.17) 5;
  }
  @keyframes pl-fall {
    0% {
      transform: translate(0, -6px) rotate(14deg);
      opacity: 0;
    }
    20% {
      opacity: 0.9;
    }
    100% {
      transform: translate(-16px, 64px) rotate(14deg);
      opacity: 0;
    }
  }
  [data-part] {
    transition: opacity 0.25s ease;
  }
  /* Dimmed while another label is explained (HeroPlace sets data-focus). */
  :global(.pl[data-focus]:not([data-focus='daydream'])) .pl-cloud {
    opacity: 0.3;
  }
  /* "Hold still" (or scrolling away, or a hidden tab) pauses the rain where
     the drops hang; it carries on from there, so one think rains once. */
  :global(.pl[data-still]) .pl-rain i {
    animation-play-state: paused;
  }

  /* A phone: the cloud comes down off the title into the picture's own sky,
     top left, where it is a step down for the rambler. */
  @media (max-width: 759px) {
    .pl-cloud {
      top: auto;
      bottom: calc(var(--below) + var(--world) - 64px);
    }
    .pl-shelf {
      display: block;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-rain i {
      animation: none !important;
    }
    [data-part] {
      transition: none;
    }
  }
  @media print {
    .pl-cloud {
      display: none;
    }
  }
</style>
