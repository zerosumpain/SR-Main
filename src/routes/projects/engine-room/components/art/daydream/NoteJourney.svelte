<script lang="ts">
  // NoteJourney — one note, carried along the four stages every note shares. The stations
  // are the feature's own stage list; the note slides to whichever is picked, and each station
  // says whose move it is. "Play" walks it from start to finish once, at the reader's request,
  // never on its own.
  import { onDestroy } from 'svelte';
  import { still } from '../../../lib/motion';

  interface Stage { id: string; label: string; text: string; who: 'me' | 'it'; turn: string }
  let { stages }: { stages: Stage[] } = $props();

  let at = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let playing = $state(false);
  const cur = $derived(stages[at]);
  const pos = $derived(stages.length > 1 ? at / (stages.length - 1) : 0);

  function play() {
    stop();
    at = 0;
    playing = true;
    timer = setInterval(() => {
      if (at >= stages.length - 1) { stop(); return; }
      at += 1;
    }, still() ? 400 : 1700);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; playing = false; }
  onDestroy(stop);
</script>

<div class="nj">
  <div class="track" style="--p:{pos}; --n:{stages.length}">
    <div class="rail"><span class="fill"></span></div>
    <div class="note" aria-hidden="true">
      <svg viewBox="0 0 64 48"><rect x="2" y="2" width="60" height="44" rx="2" /><rect class="t" x="9" y="9" width="24" height="7" rx="3.5" /><path d="M9 25 H55 M9 34 H44" /></svg>
    </div>
    <ol class="stations">
      {#each stages as s, i (s.id)}
        <li>
          <button class:on={i === at} class:past={i < at} aria-pressed={i === at} onclick={() => { stop(); at = i; }}>
            <span class="dot" data-who={s.who}>{i + 1}</span>
            <b>{s.label}</b>
            <span class="who" data-who={s.who}>{s.who === 'me' ? 'my move' : 'its move'}</span>
          </button>
        </li>
      {/each}
    </ol>
  </div>

  <div class="panel" aria-live="polite">
    <div class="p-head">
      <span class="p-k">Stage {at + 1} of {stages.length}</span>
      <b class="p-t">{cur.label}</b>
      <span class="p-turn" data-who={cur.who}>{cur.turn}</span>
    </div>
    <p class="p-x">{cur.text}</p>
    <button class="play" onclick={play} disabled={playing}>{playing ? 'Travelling…' : at === stages.length - 1 ? 'Play it again' : 'Play the whole journey'}</button>
  </div>
</div>

<style>
  .track { position: relative; padding-top: 74px; }
  .rail { position: absolute; left: calc(50% / var(--n)); right: calc(50% / var(--n)); top: 110px; height: 4px; background: var(--rule); }
  .fill { position: absolute; inset: 0 auto 0 0; width: calc(100% * var(--p)); background: var(--tone); transition: width 0.9s var(--er-ease); }
  .note { position: absolute; top: 0; left: calc(50% / var(--n) + (100% - 100% / var(--n)) * var(--p)); width: 72px; margin-left: -36px;
    transition: left 0.9s var(--er-ease); animation: hover 2.4s ease-in-out infinite; }
  .note svg { display: block; width: 100%; }
  .note rect:first-child { fill: var(--lift); stroke: var(--fg); stroke-width: 2.5; }
  .note .t { fill: var(--tone); }
  .note path { stroke: var(--rule-strong); stroke-width: 4; }
  @keyframes hover { 50% { transform: translateY(-5px); } }

  .stations { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); position: relative; }
  .stations button { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; background: none; border: none; cursor: pointer; padding: 8px 4px; color: inherit; font: inherit; }
  .dot { width: 48px; height: 48px; border-radius: var(--radius-pill); display: grid; place-items: center; background: var(--ground); border: 3px solid var(--rule-strong);
    font-family: var(--er-display); font-size: 20px; color: var(--fg-2); transition: background 0.4s, border-color 0.4s, color 0.4s, transform 0.4s var(--er-ease); }
  .past .dot { border-color: var(--tone); color: var(--tone-text); }
  .on .dot { background: var(--tone); border-color: var(--tone); color: var(--er-ink); transform: scale(1.15); }
  .on .dot[data-who='me'] { background: var(--you); border-color: var(--you); color: var(--ground); }
  .stations b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(15px, 1.6vw, 22px); color: var(--fg); text-align: center; }
  .who { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); }
  .who[data-who='me'] { color: var(--you); }

  .panel { margin-top: 26px; display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) auto; gap: 18px 32px; align-items: center; padding: 22px 24px; border: 2px solid var(--fg); background: var(--lift); }
  .p-head { display: flex; flex-direction: column; gap: 4px; }
  .p-k { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-3); }
  .p-t { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(26px, 2.6vw, 36px); line-height: 1; color: var(--fg); }
  .p-turn { font-size: var(--fs-label); color: var(--tone-text); }
  .p-turn[data-who='me'] { color: var(--you); }
  .p-x { margin: 0; font-size: var(--fs-body); line-height: 1.6; color: var(--fg-2); }
  .play { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; padding: 11px 16px; border-radius: var(--radius-pill);
    border: 1px solid var(--fg); background: var(--fg); color: var(--ground); cursor: pointer; white-space: nowrap; }
  .play:disabled { opacity: 0.5; cursor: default; }
  @media (max-width: 760px) {
    .panel { grid-template-columns: minmax(0, 1fr); }
    .dot { width: 38px; height: 38px; font-size: 16px; }
    .rail { top: 105px; }
    .note { width: 56px; margin-left: -28px; }
    .who { text-align: center; }
  }
</style>
