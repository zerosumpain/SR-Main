<script lang="ts">
  // NightShift — the nightly run as a moon crossing the sky. Each phase is a station on the
  // arc, in the order the run takes them; the retired phase is still drawn, hollow and
  // dashed, because every night's record keeps its place. Pick a phase and the moon moves
  // there; Play walks the whole night.
  //
  // Phase names are buttons in HTML under the arc, so they read on a phone. The arc itself
  // carries no words.
  import { Tween } from 'svelte/motion';
  import { cubicInOut } from 'svelte/easing';
  import { still } from '../../../lib/motion';

  interface Phase { id: string; label: string; text: string; skipped?: boolean }
  let { phases, selected = $bindable(phases[0]?.id) }: { phases: Phase[]; selected?: string } = $props();

  const W = 900, H = 300, CX = W / 2, CY = 280, R = 380;
  const n = $derived(phases.length);
  // Stations from dusk (left) to dawn (right), leaving a margin at each horizon.
  const angle = (i: number) => Math.PI - (0.12 + (i / Math.max(1, n - 1)) * 0.76) * Math.PI;
  const pos = (a: number) => ({ x: CX + R * Math.cos(a), y: CY - R * 0.62 * Math.sin(a) });
  const idx = $derived(Math.max(0, phases.findIndex((p) => p.id === selected)));
  const current = $derived(phases[idx]);

  const t = new Tween(0, { duration: 900, easing: cubicInOut });
  $effect(() => { t.set(idx, { duration: still() ? 0 : 900 }); });
  const moon = $derived(pos(angle(t.current)));

  let playing = $state(false);
  $effect(() => {
    if (!playing) return;
    const h = setInterval(() => {
      const next = idx + 1;
      if (next >= n) { playing = false; return; }
      selected = phases[next].id;
    }, 1700);
    return () => clearInterval(h);
  });
  function play() {
    if (playing) { playing = false; return; }
    if (idx >= n - 1) selected = phases[0].id;
    playing = !still();
  }
  const arc = $derived.by(() => {
    const pts = Array.from({ length: 61 }, (_, k) => pos(Math.PI - (0.04 + (k / 60) * 0.92) * Math.PI));
    return 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  });
  const stars = Array.from({ length: 26 }, (_, i) => ({ x: (i * 137.5) % W, y: 14 + ((i * 53) % 150), r: 1 + (i % 3) * 0.6, d: (i % 7) * 0.4 }));
</script>

<div class="night">
  <div class="sky-wrap">
    <svg viewBox="0 0 {W} {H}" aria-hidden="true">
      {#each stars as s}<circle class="star" cx={s.x} cy={s.y} r={s.r} style="animation-delay:{s.d}s" />{/each}
      <path class="arc" d={arc} />
      {#each phases as p, i (p.id)}
        {@const q = pos(angle(i))}
        <circle class="stn" class:past={i < idx} class:skip={p.skipped} cx={q.x} cy={q.y} r="9" />
      {/each}
      <g transform="translate({moon.x} {moon.y})">
        <circle class="halo" r="34" />
        <circle class="moon" r="22" />
        <circle class="bite" cx="9" cy="-7" r="19" />
      </g>
      <line class="horizon" x1="0" y1={H - 2} x2={W} y2={H - 2} />
    </svg>
  </div>

  <div class="ctl">
    <button class="play" onclick={play} aria-pressed={playing}>{playing ? 'Pause' : 'Play the night'}</button>
  </div>
  <ol class="phases" style="--n:{n}">
    {#each phases as p, i (p.id)}
      <li><button class:on={i === idx} class:skip={p.skipped} aria-pressed={i === idx} onclick={() => { playing = false; selected = p.id; }}>
        <span class="p-n">{i + 1}</span>{p.label}</button></li>
    {/each}
  </ol>
  <p class="text" aria-live="polite"><b>{current?.label}{current?.skipped ? ' · retired' : ''}</b> {current?.text}</p>
</div>

<style>
  .night { min-width: 0; }
  .sky-wrap { border: 1px solid var(--rule); background: linear-gradient(180deg, #120b05 0%, var(--er-ink-2) 100%); }
  svg { display: block; width: 100%; height: auto; }
  .star { fill: var(--er-cream); opacity: 0.5; animation: twinkle 3s ease-in-out infinite alternate; }
  @keyframes twinkle { to { opacity: 0.12; } }
  .arc { fill: none; stroke: var(--rule-strong); stroke-width: 2; stroke-dasharray: 2 8; }
  .stn { fill: var(--er-ink); stroke: var(--tone-text); stroke-width: 3; transition: fill 0.4s; }
  .stn.past { fill: var(--tone-text); }
  .stn.skip { stroke-dasharray: 3 3; stroke: var(--fg-3); fill: var(--er-ink); }
  .halo { fill: var(--er-amber-ink); opacity: 0.12; }
  .moon { fill: var(--er-amber-ink); }
  .bite { fill: #1d130a; }
  .horizon { stroke: var(--rule-strong); stroke-width: 2; }
  .ctl { display: flex; justify-content: flex-end; margin: 12px 0 8px; }
  .play { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer;
    padding: 8px 14px; border-radius: var(--radius-pill); border: 1px solid var(--tone-text); background: transparent; color: var(--tone-text); }
  .play[aria-pressed='true'] { background: var(--tone-text); color: var(--er-ink); }
  .phases { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 4px; }
  .phases button { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; cursor: pointer;
    background: transparent; border: 1px solid var(--rule); border-radius: var(--radius-sharp); color: var(--fg-2);
    font-family: var(--er-mono); font-size: var(--fs-label-xs); text-transform: capitalize; transition: border-color 0.2s, color 0.2s, background 0.2s; }
  .phases button:hover { color: var(--fg); border-color: var(--rule-strong); }
  .phases button.on { border-color: var(--tone-text); color: var(--fg); background: var(--wash); }
  .phases button.skip { text-decoration: line-through; opacity: 0.6; }
  .p-n { color: var(--tone-text); }
  .text { margin: 16px 0 0; font-size: var(--fs-body); line-height: 1.6; color: var(--fg-2); min-height: 3.2em; max-width: 70ch; }
  .text b { color: var(--tone-text); text-transform: capitalize; margin-right: 6px; }
  @media (max-width: 720px) { .phases { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
