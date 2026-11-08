<script lang="ts">
  // ThoughtClock — the think loop's schedule as a twenty-four hour dial. The amber arc is the
  // waking window; each tick inside it is one thinking slot. The numbered markers are the real
  // next questions, computed by the same clock the loop uses (facts.daydream.upcoming), and
  // the hand sweeps round to the first of them when the dial comes into view.
  //
  // Pick a marker, on the dial or in the list, to read that slot's question. A slot that falls
  // outside waking hours is drawn hollow: the clock still reaches it, but it passes unasked.
  import { untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { inView } from '../../../lib/motion';
  import { still } from '../../../lib/motion';

  interface Slot { at: string; channel: string; outcome: string }
  interface Props {
    upcoming: Slot[];
    channelLabel: Map<string, string>;
    outcomeLabel: Map<string, string>;
    cadence: number;
    activeHours: { start: number; end: number };
  }
  let { upcoming, channelLabel, outcomeLabel, cadence, activeHours }: Props = $props();

  const CX = 260, CY = 260, R = 200;
  const hourOf = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).formatToParts(new Date(iso));
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0), m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h + m / 60;
  };
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const deg = (h: number) => (h / 24) * 360;
  const pt = (r: number, a: number) => ({ x: CX + r * Math.sin((a * Math.PI) / 180), y: CY - r * Math.cos((a * Math.PI) / 180) });
  const awake = (h: number) => h >= activeHours.start && h < activeHours.end;

  const arcPath = $derived.by(() => {
    const a0 = deg(activeHours.start), a1 = deg(activeHours.end);
    const p0 = pt(R, a0), p1 = pt(R, a1);
    return `M${p0.x} ${p0.y} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
  });
  const ticks = $derived(Array.from({ length: Math.round((24 * 60) / cadence) }, (_, i) => (i * cadence) / 60));
  const marks = $derived(upcoming.map((u, i) => ({ ...u, i, h: hourOf(u.at), awake: awake(hourOf(u.at)) })));

  let pick = $state(0);
  const cur = $derived(marks[pick]);

  // The hand: a tween in degrees, sent to the picked slot. It starts at midnight and sweeps
  // round the first time the dial is seen.
  const hand = new Tween(0, { duration: 1600, easing: cubicOut });
  let seen = $state(false);
  // Clocks only go forward: a later pick that is earlier in the day goes round again.
  $effect(() => {
    if (!seen || !cur) return;
    const now = untrack(() => hand.target);
    let t = deg(cur.h);
    while (t < now - 0.01) t += 360;
    hand.set(t, { duration: still() ? 0 : 1600 });
  });
  function watch(el: Element) {
    if (still()) { seen = true; hand.set(cur ? deg(cur.h) : 0, { duration: 0 }); return; }
    return inView(el, () => { seen = true; }, { amount: 0.4 });
  }
</script>

<div class="tc">
  <svg viewBox="0 0 520 520" {@attach watch} role="img"
    aria-label="A twenty-four hour clock. It thinks from {activeHours.start}:00 to {activeHours.end}:00, once every {cadence} minutes. The next question is {cur ? `${channelLabel.get(cur.channel)} towards ${outcomeLabel.get(cur.outcome)} at ${time(cur.at)}` : 'unknown'}.">
    <circle class="face" cx={CX} cy={CY} r={R + 34} />
    <path class="wake" d={arcPath} />
    {#each ticks as h}
      {@const a = pt(R - 26, deg(h))}{@const b = pt(R - 12, deg(h))}
      <line class="tick" class:on={awake(h)} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
    {/each}
    {#each [0, 3, 6, 9, 12, 15, 18, 21] as h}
      {@const p = pt(R - 52, deg(h))}
      <text class="hr" x={p.x} y={p.y + 6} text-anchor="middle">{String(h).padStart(2, '0')}</text>
    {/each}
    <text class="label" x={CX} y={CY + 64} text-anchor="middle">UK time</text>

    <g class="hand" style="transform: rotate({hand.current}deg)">
      <line x1={CX} y1={CY + 18} x2={CX} y2={CY - R + 40} />
    </g>
    <circle class="pin" cx={CX} cy={CY} r="13" />

    {#each marks as m (m.at)}
      {@const p = pt(R + 2, deg(m.h))}
      <g class="mark" class:on={m.i === pick} class:asleep={!m.awake} role="button" tabindex="0"
        aria-label="{time(m.at)}: {channelLabel.get(m.channel)} towards {outcomeLabel.get(m.outcome)}{m.awake ? '' : ', outside waking hours'}"
        onclick={() => (pick = m.i)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick = m.i; } }}>
        <circle cx={p.x} cy={p.y} r="17" />
        <text x={p.x} y={p.y + 5} text-anchor="middle">{m.i + 1}</text>
      </g>
    {/each}
  </svg>

  <div class="side">
    {#if cur}
      <div class="now" aria-live="polite">
        <span class="n-k">{pick === 0 ? 'Next question' : `Question ${pick + 1} from now`} · {time(cur.at)}</span>
        <b class="n-ch">{channelLabel.get(cur.channel)}</b>
        <span class="n-arrow" aria-hidden="true">↓</span>
        <b class="n-out">{outcomeLabel.get(cur.outcome)}</b>
        <span class="n-s">{cur.awake ? 'It starts from this part of my life, looking for this kind of thing.' : 'Outside waking hours, so this slot passes unasked.'}</span>
      </div>
    {/if}
    <ol class="list">
      {#each marks as m (m.at)}
        <li><button class:on={m.i === pick} class:asleep={!m.awake} onclick={() => (pick = m.i)}>
          <span class="l-n">{m.i + 1}</span><time>{time(m.at)}</time><span class="l-q">{channelLabel.get(m.channel)} → {outcomeLabel.get(m.outcome)}</span>
        </button></li>
      {/each}
    </ol>
  </div>
</div>

<style>
  .tc { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr); gap: clamp(24px, 4vw, 64px); align-items: center; }
  svg { display: block; width: 100%; max-width: 560px; height: auto; margin: 0 auto; overflow: visible; }
  .face { fill: var(--lift); stroke: var(--fg); stroke-width: 3; }
  .wake { fill: none; stroke: var(--tone); stroke-width: 40; opacity: 0.28; }
  .tick { stroke: var(--rule-strong); stroke-width: 2; }
  .tick.on { stroke: var(--tone-text); stroke-width: 3; }
  .hr { font-family: var(--er-mono); font-size: 18px; fill: var(--fg-3); }
  .label { font-family: var(--er-mono); font-size: 15px; fill: var(--fg-3); letter-spacing: 0.1em; text-transform: uppercase; }
  .hand { transform-origin: 260px 260px; transform-box: view-box; }
  .hand line { stroke: var(--fg); stroke-width: 8; stroke-linecap: round; }
  .pin { fill: var(--tone); stroke: var(--fg); stroke-width: 4; }
  .mark { cursor: pointer; outline: none; }
  .mark circle { fill: var(--fg); stroke: var(--lift); stroke-width: 3; transition: fill 0.25s, transform 0.3s var(--er-ease); transform-box: fill-box; transform-origin: center; }
  .mark text { font-family: var(--er-mono); font-size: 16px; font-weight: 600; fill: var(--ground); pointer-events: none; }
  .mark.asleep circle { fill: var(--lift); stroke: var(--fg-3); stroke-dasharray: 4 3; }
  .mark.asleep text { fill: var(--fg-3); }
  .mark.on circle { fill: var(--tone); stroke: var(--fg); transform: scale(1.25); }
  .mark.on text { fill: var(--er-ink); }
  .mark:focus-visible circle { stroke: var(--you); stroke-width: 5; }

  .now { display: flex; flex-direction: column; gap: 4px; padding: 0 0 22px; margin-bottom: 18px; border-bottom: 2px solid var(--fg); }
  .n-k { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--tone-text); margin-bottom: 6px; }
  .n-ch, .n-out { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(30px, 3.4vw, 50px); line-height: 0.95; color: var(--fg); }
  .n-out { color: var(--tone-text); }
  .n-arrow { font-size: 22px; color: var(--fg-3); line-height: 1; }
  .n-s { margin-top: 10px; font-size: var(--fs-body-sm); color: var(--fg-2); }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .list button { width: 100%; display: grid; grid-template-columns: 26px 6ch minmax(0, 1fr); gap: 10px; align-items: baseline; text-align: left;
    background: none; border: none; border-left: 3px solid transparent; padding: 7px 8px; cursor: pointer; color: var(--fg-2); font: inherit; font-size: var(--fs-label); transition: background 0.2s; }
  .list button:hover { background: var(--wash); }
  .list button.on { border-left-color: var(--tone); background: var(--wash); color: var(--fg); }
  .list button.asleep { color: var(--fg-3); }
  .l-n { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--tone-text); }
  .list time { font-family: var(--er-mono); font-size: var(--fs-label-xs); }
  .l-q { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 860px) { .tc { grid-template-columns: minmax(0, 1fr); } }
</style>
