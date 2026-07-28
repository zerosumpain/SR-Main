<script lang="ts">
  // TimeLedger — "how much time actually passes".
  //
  // The whole point is a comparison that a stacked bar cannot make honestly: machine
  // time and human time differ by six orders of magnitude. So each scenario gets TWO
  // bars on one shared log axis. The machine bar is a stub next to the human bar, and
  // that visual is the argument.
  //
  // Then: where the human time actually goes (named, per stage), and the reuse
  // dividend — the second time the same class of question is asked.
  import { onMount } from 'svelte';
  import {
    SCENARIOS, DAY, WEEK, fmtDuration, totalMachine, totalHuman, TIMING_NOTE,
    stageById, type Depth,
  } from '../lib/trace';
  import ConfidenceBadge from '../../components/ConfidenceBadge.svelte';

  let { depth = 'official' as Depth }: { depth?: Depth } = $props();

  let sel = $state(1);                 // default to the slow path — it is the point
  let shown = $state(false);
  onMount(() => { shown = true; });

  const scenario = $derived(SCENARIOS[sel]);
  const mTotal = $derived(totalMachine(scenario));
  const hTotal = $derived(totalHuman(scenario));
  const humanStages = $derived(scenario.stages.filter((s) => s.human > 0));

  /** Machine time against human time. A percentage here reads as "8.4e-5%", which is
   *  true and useless; a ratio is the thing a reader can actually hold. */
  const machineShare = $derived.by(() => {
    if (!hTotal) return { v: 'all of it', l: 'IS THE MACHINE', t: 'No governance time: this class of request is already authorised.' };
    const r = hTotal / mTotal;
    const v = r >= 1e6 ? `1 : ${(r / 1e6).toFixed(1)}M` : r >= 1e3 ? `1 : ${(r / 1e3).toFixed(1)}k` : `1 : ${Math.round(r)}`;
    return { v, l: 'MACHINE : HUMAN', t: `${fmtDuration(mTotal)} of computing for every ${fmtDuration(hTotal)} of waiting.` };
  });

  // ---- geometry -----------------------------------------------------------
  const W = 1000;
  const LABW = 208;                   // scenario-name gutter
  const RPAD = 96;                    // room for the value label at the end of a bar
  const AX = LABW;
  const AXW = W - LABW - RPAD;
  const ROW_H = 46;
  const AXIS_H = 26;
  const H = AXIS_H + SCENARIOS.length * ROW_H + 16;

  // log axis: 0.1 s → 100 days
  const LO = -1, HI = Math.log10(100 * DAY);
  const x = (sec: number) => AX + (Math.max(LO, Math.log10(Math.max(sec, 0.1))) - LO) / (HI - LO) * AXW;

  const TICKS: { sec: number; label: string }[] = [
    { sec: 1, label: '1 sec' },
    { sec: 60, label: '1 min' },
    { sec: 3600, label: '1 hour' },
    { sec: DAY, label: '1 day' },
    { sec: WEEK, label: '1 week' },
    { sec: 30 * DAY, label: '1 month' },
    { sec: 90 * DAY, label: '3 months' },
  ];

  const rowY = (i: number) => AXIS_H + i * ROW_H;

  /** SVG has no text wrapping — keep long scenario names inside the gutter. */
  function wrapName(text: string, maxChars = 25): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (!cur.length) { cur = w; continue; }
      if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { lines.push(cur); cur = w; if (lines.length === 2) break; }
    }
    if (lines.length < 2 && cur.length) lines.push(cur);
    return lines;
  }
</script>

<div class="tl">
  <!-- ============ THE COMPARISON ============ -->
  <div class="scroll">
    <svg viewBox="0 0 {W} {H}" role="img"
      aria-label="Machine time versus human time for five request types, on a shared logarithmic axis from one second to three months.">

      <!-- axis -->
      {#each TICKS as tk}
        <line x1={x(tk.sec)} y1={AXIS_H - 8} x2={x(tk.sec)} y2={H - 10} class="grid" />
        <text x={x(tk.sec)} y={AXIS_H - 12} text-anchor="middle" class="tick">{tk.label}</text>
      {/each}
      <line x1={AX} y1={AXIS_H - 8} x2={AX} y2={H - 10} class="grid axis0" />

      {#each SCENARIOS as s, i}
        {@const m = totalMachine(s)}
        {@const h = totalHuman(s)}
        {@const y = rowY(i)}
        {@const nm = wrapName(s.name)}
        <g class="srow" class:on={i === sel}>
          <rect x="0" y={y} width={W} height={ROW_H - 4} rx="5" class="srow-bg" />
          {#each nm as ln, k}
            <text x="8" y={y + 15 + k * 12} class="s-name">{ln}</text>
          {/each}
          <text x="8" y={y + 15 + nm.length * 12 + 1} class="s-kick">{h > 0 ? 'NEW CLASS OF REQUEST' : 'PRE-AGREED PATH'}</text>

          <!-- machine bar -->
          <rect x={AX} y={y + 6} width={Math.max(2, x(m) - AX)} height="11" rx="2.5"
            class="bar machine" class:grown={shown} />
          <text x={x(m) + 7} y={y + 15} class="bar-val machine">{fmtDuration(m)}</text>

          <!-- human bar -->
          {#if h > 0}
            <rect x={AX} y={y + 22} width={Math.max(2, x(h) - AX)} height="11" rx="2.5"
              class="bar human" class:grown={shown} />
            <text x={x(h) + 7} y={y + 31} class="bar-val human">{fmtDuration(h)}</text>
          {:else}
            <text x={AX + 4} y={y + 31} class="bar-val none">no humans in the loop</text>
          {/if}
        </g>
        <rect x="0" y={y} width={W} height={ROW_H - 4} class="srow-hit" role="button" tabindex="0"
          aria-label="Break down {s.name}" onclick={() => (sel = i)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = i; } }} />
      {/each}
    </svg>
  </div>

  <div class="legend">
    <span class="lg machine">■ machine time</span>
    <span class="lg human">■ human &amp; governance time</span>
    <span class="lg hint">logarithmic axis — each gridline is a different order of magnitude</span>
  </div>

  <!-- ============ THE SELECTED SCENARIO ============ -->
  <div class="focus">
    <div class="f-head">
      <div>
        <span class="f-kick">{scenario.kicker}</span>
        <h4>{scenario.name}</h4>
      </div>
      <div class="f-stats">
        <div class="fs">
          <b>{fmtDuration(mTotal + hTotal)}</b>
          <span>END TO END</span>
        </div>
        <div class="fs machine">
          <b>{fmtDuration(mTotal)}</b>
          <span>OF IT IS COMPUTERS</span>
        </div>
        <div class="fs share" title={machineShare.t}>
          <b>{machineShare.v}</b>
          <span>{machineShare.l}</span>
        </div>
      </div>
    </div>

    {#if hTotal > 0}
      <p class="f-lede">
        {#if depth === 'eli5'}
          Almost none of the waiting is computers. Nearly all of it is grown-ups agreeing that the question
          is allowed to be asked at all — and no amount of new technology makes that part faster.
        {:else if depth === 'technical'}
          The critical path is governance, not compute. Of the {fmtDuration(mTotal + hTotal)} elapsed,
          {fmtDuration(mTotal)} is execution; the remainder is assessment, agreement, notification, an
          objection window, and — in the MIS stage — supplier release cadence. None of these are
          engineering problems, and only the last is even partly procurable.
        {:else}
          Where the time goes, honestly. Of the {fmtDuration(mTotal + hTotal)} end to end, the technology
          accounts for {fmtDuration(mTotal)}. Everything else is the work of deciding that the question may
          be asked — which is the work a spine can make <em>reusable</em>, but cannot make disappear.
        {/if}
      </p>

      <span class="brk-lab">WHERE THE HUMAN TIME ACTUALLY GOES</span>
      {#key sel}
        <div class="brk">
          {#each humanStages as hs}
            <div class="brk-row" style="--w:{(hs.human / hTotal) * 100}%">
              <span class="brk-stage">{stageById(hs.stage).name}</span>
              <div class="brk-track"><div class="brk-fill"></div></div>
              <span class="brk-time">{fmtDuration(hs.human)}</span>
              <span class="brk-work">{hs.humanWork}</span>
            </div>
          {/each}
        </div>
      {/key}
    {:else}
      <p class="f-lede fast">
        {#if depth === 'eli5'}
          Nobody had to agree anything today, because it was all agreed before. That is the whole trick:
          do the arguing once, then the asking is instant, every time.
        {:else}
          No human is in the loop, because the argument was had in advance and written down as a standing
          authorisation. This is what every request looks like <em>after</em> its class has been through the
          slow path once — and it is the entire return on that investment.
        {/if}
      </p>
    {/if}

    <!-- the reuse dividend -->
    <div class="reuse">
      <span class="ru-lab">THE SECOND TIME THIS CLASS OF QUESTION IS ASKED</span>
      <div class="ru-bars">
        <div class="ru">
          <span class="ru-t">First time</span>
          <div class="ru-track"><div class="ru-fill first"></div></div>
          <b>{fmtDuration(mTotal + hTotal)}</b>
        </div>
        <div class="ru">
          <span class="ru-t">Every time after</span>
          <div class="ru-track"><div class="ru-fill again"
            style="--w:{Math.max(1.5, ((scenario.repeat.machine + scenario.repeat.human) / Math.max(1, mTotal + hTotal)) * 100)}%"></div></div>
          <b>{fmtDuration(scenario.repeat.machine + scenario.repeat.human)}</b>
        </div>
      </div>
      <p class="ru-note">{scenario.repeat.note}</p>
    </div>
  </div>

  <p class="note">
    <ConfidenceBadge level="hypothesis" small label="Illustrative" />
    {TIMING_NOTE}
  </p>
</div>

<style>
  .tl { border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-round); background: var(--surface-elevated, #e8dece); overflow: hidden; }

  .scroll { overflow-x: auto; padding: 16px 18px 4px; }
  svg { display: block; min-width: 780px; width: 100%; height: auto; }

  .grid { stroke: rgba(26,16,8,0.16); stroke-width: 1; stroke-dasharray: 3 4; }
  .grid.axis0 { stroke: rgba(26,16,8,0.35); stroke-dasharray: none; }
  .tick { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.08em; fill: rgba(26,16,8,0.6); }

  .srow-bg { fill: transparent; transition: fill 0.2s; }
  .srow.on .srow-bg { fill: #ffffff; }
  .srow-hit { fill: transparent; cursor: pointer; }
  .srow-hit:focus-visible { outline: 2px solid var(--accent-ink, #0e5b66); }
  .s-name { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; fill: var(--ink); }
  .srow.on .s-name { fill: var(--accent-ink, #0e5b66); }
  .s-kick { font-family: 'JetBrains Mono', monospace; font-size: 7px; letter-spacing: 0.1em; fill: rgba(26,16,8,0.55); }

  .bar { transform-box: fill-box; transform-origin: left center; transform: scaleX(0); }
  .bar.grown { transform: scaleX(1); transition: transform 0.9s cubic-bezier(0.22,1,0.36,1); }
  .bar.machine { fill: var(--accent-ink, #0e5b66); }
  .bar.human { fill: #a8701a; }
  .bar-val { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; }
  .bar-val.machine { fill: var(--accent-ink, #0e5b66); }
  .bar-val.human { fill: #8c5a10; }
  .bar-val.none { font-family: 'DM Sans', sans-serif; font-size: 10px; font-style: italic; fill: rgba(47,125,79,0.9); }

  .legend { display: flex; gap: 14px; flex-wrap: wrap; padding: 0 18px 12px; }
  .lg { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.08em; }
  .lg.machine { color: var(--accent-ink, #0e5b66); }
  .lg.human { color: #8c5a10; }
  .lg.hint { color: rgba(26,16,8,0.55); }

  /* focus panel */
  .focus { background: #ffffff; border-top: 1.5px solid rgba(26,16,8,0.4); padding: 16px 18px; }
  .f-head { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .f-kick { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.16em; color: var(--accent-ink, #0e5b66); }
  .f-head h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(19px, 2.4vw, 26px); line-height: 1.15; margin: 3px 0 0; color: var(--ink); }
  .f-stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .fs { border: 1.5px solid rgba(26,16,8,0.35); border-radius: var(--radius-round); padding: 7px 13px; text-align: center; min-width: 104px; }
  .fs b { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; line-height: 1.05; color: var(--ink); }
  .fs span { font-family: 'JetBrains Mono', monospace; font-size: 7px; letter-spacing: 0.1em; color: rgba(26,16,8,0.6); }
  .fs.machine { border-color: rgba(14,91,102,0.5); }
  .fs.machine b { color: var(--accent-ink, #0e5b66); }
  .fs.share { border-color: rgba(168,112,26,0.55); background: #fdf4e6; }
  .fs.share b { color: #8c5a10; }

  .f-lede { font-size: 14px; line-height: 1.55; color: rgba(26,16,8,0.84); margin: 14px 0 16px; max-width: 82ch; }
  .f-lede em { color: var(--accent-ink, #0e5b66); font-style: italic; }
  .f-lede.fast { color: #216b3f; }

  .brk-lab, .ru-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(26,16,8,0.55); margin-bottom: 8px; }
  .brk { display: flex; flex-direction: column; gap: 7px; }
  .brk-row { display: grid; grid-template-columns: 118px 1fr 68px; grid-template-areas: 'stage track time' 'work work work'; gap: 3px 10px; align-items: center; }
  .brk-stage { grid-area: stage; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; color: var(--ink); }
  .brk-track { grid-area: track; height: 12px; background: rgba(26,16,8,0.07); border-radius: 2px; overflow: hidden; }
  .brk-fill { height: 100%; width: var(--w); background: #a8701a; border-radius: 2px; transform-origin: left center; animation: tl-grow 0.75s cubic-bezier(0.22,1,0.36,1) both; }
  .brk-time { grid-area: time; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: #8c5a10; text-align: right; }
  .brk-work { grid-area: work; font-size: 11.5px; line-height: 1.4; color: rgba(26,16,8,0.66); padding-left: 128px; }
  @keyframes tl-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

  .reuse { margin-top: 20px; padding-top: 14px; border-top: 1px solid rgba(26,16,8,0.14); }
  .ru-bars { display: flex; flex-direction: column; gap: 8px; }
  .ru { display: grid; grid-template-columns: 118px 1fr 92px; gap: 10px; align-items: center; }
  .ru-t { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; color: var(--ink); }
  .ru-track { height: 14px; background: rgba(26,16,8,0.07); border-radius: 2px; overflow: hidden; }
  .ru-fill { height: 100%; border-radius: 2px; transform-origin: left center; animation: tl-grow 0.75s cubic-bezier(0.22,1,0.36,1) both; }
  .ru-fill.first { width: 100%; background: #a8701a; }
  .ru-fill.again { width: var(--w); background: var(--accent-ink, #0e5b66); }
  .ru b { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: var(--ink); text-align: right; }
  .ru-note { font-size: 13px; line-height: 1.55; color: rgba(26,16,8,0.8); margin: 10px 0 0; max-width: 82ch; }

  .note { font-size: 11.5px; line-height: 1.55; color: rgba(26,16,8,0.66); margin: 0; padding: 12px 18px 14px; border-top: 1px solid rgba(26,16,8,0.16); }

  @media (max-width: 700px) {
    .scroll { padding: 12px 12px 4px; }
    .legend, .focus, .note { padding-left: 12px; padding-right: 12px; }
    .brk-row { grid-template-columns: 1fr 60px; grid-template-areas: 'stage time' 'track track' 'work work'; }
    .brk-work { padding-left: 0; }
    .ru { grid-template-columns: 1fr 80px; grid-template-areas: 'name time' 'track track'; }
    .ru-t { grid-area: name; }
    .ru-track { grid-area: track; }
    .ru b { grid-area: time; }
  }
</style>
