<script lang="ts">
  // AssemblyLine — a delivery's stages as stations on a conveyor, with a parcel that rides
  // to whichever station is picked. Play walks it from brief to deployed. Stations that wait
  // on me are petrol, the study's one colour for "my move".
  //
  // Built in HTML and CSS rather than one SVG so the station names stay real text at any
  // width: across on a wide screen, down the side on a phone. The parcel's position is a CSS
  // variable, so the browser does the travelling.
  import { still } from '../../../lib/motion';

  interface Station { id: string; label: string; text: string; mine?: boolean }
  let { stations, selected = $bindable(stations[0]?.id) }: { stations: Station[]; selected?: string } = $props();

  const n = $derived(stations.length);
  const idx = $derived(Math.max(0, stations.findIndex((s) => s.id === selected)));
  const cur = $derived(stations[idx]);
  let playing = $state(false);

  $effect(() => {
    if (!playing) return;
    const h = setInterval(() => {
      if (idx >= n - 1) { playing = false; return; }
      selected = stations[idx + 1].id;
    }, 1600);
    return () => clearInterval(h);
  });
  function play() {
    if (playing) { playing = false; return; }
    if (idx >= n - 1) selected = stations[0].id;
    playing = !still();
  }
</script>

<div class="line" style="--n:{n};--i:{idx}">
  <div class="top">
    <span class="count"><b>{idx + 1}</b> / {n}</span>
    <button class="play" onclick={play} aria-pressed={playing}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">{#if playing}<path d="M3 2h3v12H3zM10 2h3v12h-3z" />{:else}<path d="M3 1l11 7-11 7z" />{/if}</svg>
      {playing ? 'Pause' : 'Run a delivery'}
    </button>
  </div>

  <div class="belt-wrap">
    <div class="belt" aria-hidden="true"><span class="fill"></span></div>
    <span class="parcel" aria-hidden="true">
      <svg viewBox="0 0 40 34"><rect x="2" y="2" width="36" height="30" rx="2" /><path d="M2 13h36M20 2v30" /></svg>
    </span>
    <ol class="stations">
      {#each stations as s, i (s.id)}
        <li class:done={i < idx} class:on={i === idx} class:mine={s.mine}>
          <button onclick={() => { playing = false; selected = s.id; }} aria-pressed={i === idx}>
            <span class="node"><span class="dot"></span></span>
            <span class="name">{s.label}</span>
          </button>
        </li>
      {/each}
    </ol>
  </div>

  <div class="card" class:mine={cur?.mine} aria-live="polite">
    <span class="c-k">Station {idx + 1}{cur?.mine ? ' · waits on me' : ''}</span>
    <b class="c-t">{cur?.label}</b>
    <p>{cur?.text}</p>
  </div>
</div>

<style>
  .line { min-width: 0; }
  .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
  .count { font-family: var(--er-mono); font-size: var(--fs-label); color: var(--fg-3); }
  .count b { font-family: var(--er-display); font-weight: 400; font-size: 32px; color: var(--tone-text); margin-right: 4px; }
  .play { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 10px 16px; border-radius: var(--radius-pill);
    border: 1px solid var(--tone); background: var(--tone); color: #fff; font-family: var(--er-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase; }
  .play svg { fill: currentColor; }
  .play[aria-pressed='true'] { background: transparent; color: var(--tone-text); }

  .belt-wrap { position: relative; padding-top: 70px; }
  .belt { position: absolute; top: 44px; left: calc(50% / var(--n)); right: calc(50% / var(--n)); height: 8px; border-radius: var(--radius-pill);
    background: repeating-linear-gradient(90deg, var(--rule-strong) 0 10px, transparent 10px 18px); }
  .fill { position: absolute; inset: 0 auto 0 0; width: calc(100% * var(--i) / (var(--n) - 1)); background: var(--tone); border-radius: var(--radius-pill);
    transition: width 1s var(--er-ease); }
  .parcel { position: absolute; top: 2px; left: calc((100% / var(--n)) * (var(--i) + 0.5)); width: 44px; transform: translateX(-50%);
    transition: left 1s var(--er-ease); animation: bob 1.2s ease-in-out infinite; }
  @keyframes bob { 50% { transform: translateX(-50%) translateY(-4px); } }
  .parcel svg { display: block; width: 100%; }
  .parcel rect { fill: var(--er-amber); stroke: var(--fg); stroke-width: 2; }
  .parcel path { fill: none; stroke: var(--fg); stroke-width: 2; }

  .stations { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); }
  .stations button { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 0 2px; background: none; border: none;
    cursor: pointer; color: inherit; font: inherit; }
  .node { position: relative; margin-top: -40px; width: 28px; height: 28px; border-radius: var(--radius-pill); background: var(--ground);
    border: 3px solid var(--rule-strong); display: grid; place-items: center; transition: border-color 0.4s, background 0.4s, transform 0.4s var(--er-ease); }
  .dot { width: 8px; height: 8px; border-radius: var(--radius-pill); background: transparent; transition: background 0.4s; }
  .done .node { border-color: var(--tone); background: var(--tone); }
  .on .node { border-color: var(--tone); transform: scale(1.25); }
  .on .dot { background: var(--tone); }
  .mine .node { border-color: var(--you); }
  .mine.done .node { background: var(--you); }
  .mine.on .dot { background: var(--you); }
  .name { font-size: var(--fs-label); line-height: 1.25; text-align: center; color: var(--fg-2); }
  .on .name { color: var(--fg); font-weight: 600; }
  .mine .name { color: var(--you); }

  .card { margin-top: 26px; padding: 20px 22px; border-left: 4px solid var(--tone); background: var(--wash); min-height: 7.5em; }
  .card.mine { border-left-color: var(--you); }
  .c-k { display: block; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-3); }
  .c-t { display: block; font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(24px, 2.4vw, 34px); margin: 6px 0 8px; color: var(--fg); }
  .card p { margin: 0; font-size: var(--fs-body); line-height: 1.6; color: var(--fg-2); max-width: 72ch; }

  @media (max-width: 760px) {
    .belt-wrap { padding: 0 0 0 100px; }
    .belt { top: 14px; bottom: 14px; left: 20px; right: auto; width: 8px; height: auto;
      background: repeating-linear-gradient(180deg, var(--rule-strong) 0 10px, transparent 10px 18px); }
    .fill { inset: 0 0 auto 0; width: auto; height: calc(100% * var(--i) / (var(--n) - 1)); transition: height 1s var(--er-ease); }
    .parcel { top: calc((100% / var(--n)) * (var(--i) + 0.5)); left: 46px; width: 36px; transform: translateY(-50%); transition: top 1s var(--er-ease); animation: none; }
    .stations { grid-template-columns: minmax(0, 1fr); }
    .stations button { flex-direction: row; gap: 14px; padding: 7px 0; }
    .node { margin: 0 0 0 -90px; flex-shrink: 0; }
    .name { text-align: left; font-size: var(--fs-body-sm); margin-left: 48px; }
  }
  @media (prefers-reduced-motion: reduce) { .parcel { animation: none; } }
</style>
