<script lang="ts">
  // RequestTrace — the main instrument. Six stages across, six layers down.
  //
  // The grid IS the argument: one expanded layer row shows what actually crosses each
  // boundary at that layer, while every collapsed row carries a synchronised marker —
  // so it reads as "all six layers are happening at once, and here is the one you asked
  // about". Clicking a collapsed row expands it.
  //
  // Rendering rules (inherited from QuestionTravel's rewrite):
  //  • Structure is always drawn; motion is JS-driven so play/pause/step can control it.
  //  • Every timer/rAF handle is a plain `let`, never $state (see svelte5-pitfalls §1).
  //  • Opaque fills only — the faint-diagram bug on this project was translucent boxes.
  import { onMount } from 'svelte';
  import {
    LAYERS, STAGES, SCENARIOS, MATRIX, DAY, STAGE_ELI5,
    fmtDuration, say, methodById,
    type Depth, type LayerId, type StageId, type Scenario,
  } from '../lib/trace';
  import ConfidenceBadge from '../../components/ConfidenceBadge.svelte';
  import PlayerMap from './PlayerMap.svelte';

  let { depth = 'official' as Depth }: { depth?: Depth } = $props();

  // --- reactive state (only what the template reads) -----------------------
  let sIdx = $state(0);
  let layerIdx = $state(0);
  let active = $state(0);                          // stage index the packet is at/entering
  let step = $state<'work' | 'travel'>('work');
  let t = $state(0);                               // 0..1 within the current step
  let playing = $state(false);
  let started = $state(false);
  let done = $state(false);
  let elapsedMachine = $state(0);                  // seconds accumulated, for the live clock
  let elapsedHuman = $state(0);

  // --- non-reactive handles (never $state) ---------------------------------
  let raf = 0;
  let stepStart = 0;
  let stepDur = 0;

  const scenario = $derived<Scenario>(SCENARIOS[sIdx]);
  const layer = $derived<LayerId>(LAYERS[layerIdx].id);
  const activeStage = $derived<StageId>(STAGES[active].id);
  const sStage = $derived(scenario.stages[active]);
  const activeCell = $derived(MATRIX[activeStage][layer]);

  // ---- playback -----------------------------------------------------------
  // Visual dwell is log-compressed from the real duration so 62 days and 0.3 s are
  // both watchable, and the human stages are visibly, deliberately slower.
  function visMs(i: number): number {
    if (step === 'travel') return 480;
    const st = SCENARIOS[sIdx].stages[i];
    const total = st.machine + st.human;
    const norm = Math.log10(1 + total) / Math.log10(1 + 62 * DAY);
    return Math.round(560 + 2300 * Math.min(1, norm));
  }

  function beginStep() {
    stepDur = visMs(active);
    stepStart = performance.now();
    t = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function frame(now: number) {
    const p = Math.min(1, (now - stepStart) / stepDur);
    t = p;
    if (p >= 1) { advance(); return; }
    raf = requestAnimationFrame(frame);
  }

  function advance() {
    if (step === 'work') {
      const st = SCENARIOS[sIdx].stages[active];
      elapsedMachine += st.machine;
      elapsedHuman += st.human;
      if (active >= STAGES.length - 1) { playing = false; done = true; t = 1; return; }
      step = 'travel';
    } else {
      active += 1;
      step = 'work';
    }
    if (playing) beginStep();
  }

  function play() {
    if (done) { reset(); }
    started = true;
    playing = true;
    beginStep();
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
  }

  /** one manual step — completes whatever the current step is, without playing on */
  function stepOn() {
    started = true;
    playing = false;
    cancelAnimationFrame(raf);
    if (done) { reset(); started = true; t = 1; return; }
    t = 1;
    advance();
    t = 1;
  }

  function reset() {
    cancelAnimationFrame(raf);
    playing = false;
    done = false;
    started = false;
    active = 0;
    step = 'work';
    t = 0;
    elapsedMachine = 0;
    elapsedHuman = 0;
  }

  function pickScenario(i: number) {
    reset();
    sIdx = i;
  }

  /** Jump straight to a stage. The clock MUST follow, or the readout claims 0 s while
   *  the marker sits on stage 5 — recompute elapsed as the cumulative sum to here. */
  function seek(i: number) {
    cancelAnimationFrame(raf);
    playing = false;
    started = true;
    active = Math.max(0, Math.min(STAGES.length - 1, i));
    step = 'work';
    t = 1;
    done = active >= STAGES.length - 1;
    const upto = SCENARIOS[sIdx].stages.slice(0, active + 1);
    elapsedMachine = upto.reduce((a, s) => a + s.machine, 0);
    elapsedHuman = upto.reduce((a, s) => a + s.human, 0);
  }

  onMount(() => () => cancelAnimationFrame(raf));

  // ---- geometry (viewBox 1000 × H) ----------------------------------------
  const W = 1000;
  const LX = 132;              // layer-name gutter
  const RPAD = 16;
  const GAP = 9;
  const COLW = (W - LX - RPAD - GAP * (STAGES.length - 1)) / STAGES.length;
  const colX = (i: number) => LX + i * (COLW + GAP);
  const colCx = (i: number) => colX(i) + COLW / 2;

  const HEAD_Y = 8;            // stage header band
  const HEAD_H = 52;
  const GRID_Y = HEAD_Y + HEAD_H + 12;
  const ROW_OPEN = 104;
  const ROW_SHUT = 26;
  const ROW_GAP = 5;

  const rowY = (i: number) => {
    let y = GRID_Y;
    for (let k = 0; k < i; k++) y += (k === layerIdx ? ROW_OPEN : ROW_SHUT) + ROW_GAP;
    return y;
  };
  const rowH = (i: number) => (i === layerIdx ? ROW_OPEN : ROW_SHUT);
  const H = $derived(rowY(LAYERS.length - 1) + rowH(LAYERS.length - 1) + 34);

  // the packet's x position — the same instant, read on every row
  const packetX = $derived.by(() => {
    if (step === 'work') return colCx(active);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOutQuad
    return colCx(active) + (colCx(Math.min(active + 1, STAGES.length - 1)) - colCx(active)) * e;
  });

  // At ELI5 the layers are CALLED their plain-English names — "Storage" tells a
  // non-specialist nothing, "What gets kept" tells them exactly the right thing.
  const eli = $derived(depth === 'eli5');
  const lName = (L: typeof LAYERS[number]) => (eli ? L.eli5Short : L.name);
  const lTag = (L: typeof LAYERS[number]) => (eli ? L.eli5Tag : L.tag);
  const lQuestion = (L: typeof LAYERS[number]) => (eli ? L.eli5Question : L.question);

  const PLACE: Record<string, { label: string; cls: string }> = {
    requester: { label: 'REQUESTER', cls: 'p-req' },
    spine: { label: 'TRUST LAYER', cls: 'p-spine' },
    edge: { label: 'THE EDGE', cls: 'p-edge' },
    dfe: { label: 'DfE', cls: 'p-dfe' },
  };

  /** naive word wrap for SVG text, which has none. */
  function wrap(text: string, maxChars: number, maxLines: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (!cur.length) { cur = w; continue; }
      if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
    }
    if (lines.length < maxLines && cur.length) lines.push(cur);
    if (lines.length === maxLines) {
      const joined = lines.join(' ');
      if (joined.length < text.length) lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:]?$/, '') + '…';
    }
    return lines;
  }

  /** has the packet passed this stage? drives the "done" styling */
  const passed = (i: number) => started && (i < active || (i === active && (step === 'travel' || done)));
</script>

<div class="rt">
  <!-- ============ SCENARIO PICKER ============ -->
  <div class="pick" role="group" aria-label="Scenario">
    <span class="pick-lab">Trace</span>
    <div class="pick-row">
      {#each SCENARIOS as s, i}
        <button class="sc" class:on={i === sIdx} onclick={() => pickScenario(i)}>
          <b>{s.name}</b>
          <span>{s.kicker}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- ============ THE QUESTION + TRANSPORT ============ -->
  <div class="head">
    <div class="qbox">
      <span class="q-eyebrow">THE REQUEST · {scenario.requester}</span>
      <p class="q-text">{scenario.question}</p>
      <p class="q-say">{say(scenario, depth)}</p>
      <div class="chips">
        {#each scenario.methods as m}
          <span class="mchip" title={methodById(m).what}>{methodById(m).short}</span>
        {/each}
        <ConfidenceBadge level={scenario.confidence} small note="Timings on this page are illustrative — see the note under the clock." />
      </div>
    </div>

    <div class="clock">
      <div class="ck machine">
        <b>{elapsedMachine > 0 ? fmtDuration(elapsedMachine) : '0 s'}</b>
        <span>MACHINE TIME</span>
      </div>
      <div class="ck human" class:hot={elapsedHuman > 0}>
        <b>{elapsedHuman > 0 ? fmtDuration(elapsedHuman) : 'none'}</b>
        <span>HUMAN TIME</span>
      </div>
      <div class="transport">
        {#if playing}
          <button class="tp" onclick={pause} title="Pause">❚❚</button>
        {:else}
          <button class="tp primary" onclick={play} title={done ? 'Run it again' : 'Run the trace'}>▶</button>
        {/if}
        <button class="tp" onclick={stepOn} title="Advance one step">▸❙</button>
        <button class="tp" onclick={reset} title="Reset" disabled={!started}>⟲</button>
      </div>
    </div>
  </div>

  <!-- ============ THE SIMPLE PICTURE ============ -->
  <PlayerMap {scenario} {active} />

  <!-- ============ THE GRID ============ -->
  <div class="stage-scroll">
    <svg viewBox="0 0 {W} {H}" role="img"
      aria-label="A six-stage request traced across six layers of the stack: commission, ledger update, school consent, MIS calculation, DfE aggregation and the answer — each shown at the practical, analytical, compute, storage, network and physical layer.">

      <!-- ---- stage header band ---- -->
      {#each STAGES as st, i}
        {@const ss = scenario.stages[i]}
        <g class="hd" class:now={started && i === active} class:past={passed(i)}>
          <rect x={colX(i)} y={HEAD_Y} width={COLW} height={HEAD_H} rx="6" class="hd-box" class:human={ss.human > 0} />
          <text x={colX(i) + 8} y={HEAD_Y + 15} class="hd-no">{st.no}</text>
          <text x={colX(i) + 21} y={HEAD_Y + 15} class="hd-name">{st.name}</text>
          <text x={colX(i) + 8} y={HEAD_Y + 30} class="hd-place">{PLACE[st.place].label}</text>
          <text x={colX(i) + 8} y={HEAD_Y + 45} class="hd-dur">
            <!-- nbsp: SVG text collapses the leading space, butting "+" against "ms" -->
            {fmtDuration(ss.machine)}{#if ss.human > 0}<tspan class="hd-hum">&#160;+ {fmtDuration(ss.human)}</tspan>{/if}
          </text>
          <!-- flags sit on the PLACE line: the name line is long enough to collide with -->
          {#if ss.human > 0}
            <text x={colX(i) + COLW - 8} y={HEAD_Y + 30} text-anchor="end" class="hd-flag">⏳ HUMAN</text>
          {:else if ss.mode === 'override'}
            <text x={colX(i) + COLW - 8} y={HEAD_Y + 30} text-anchor="end" class="hd-flag over">⚠ OVERRIDE</text>
          {/if}
          <!-- work progress underline -->
          {#if started && i === active && step === 'work' && !done}
            <rect x={colX(i)} y={HEAD_Y + HEAD_H - 3} width={COLW * t} height="3" class="hd-prog" class:human={ss.human > 0} />
          {/if}
        </g>
      {/each}

      <!-- ---- layer rows ---- -->
      {#each LAYERS as L, li}
        {@const y = rowY(li)}
        {@const h = rowH(li)}
        {@const open = li === layerIdx}
        <g class="row" class:open>
          <!-- layer name gutter (clickable) -->
          <rect x="0" y={y} width={LX - 8} height={h} rx="5" class="lg" class:open />
          <text x="10" y={y + (open ? 20 : 17)} class="lg-no">L{L.no}</text>
          <text x="34" y={y + (open ? 20 : 17)} class="lg-name">{lName(L)}</text>
          {#if open}
            <text x="10" y={y + 36} class="lg-tag">{lTag(L)}</text>
            {#each wrap(lQuestion(L), 20, 4) as ln, k}
              <text x="10" y={y + 54 + k * 12} class="lg-q">{ln}</text>
            {/each}
          {/if}

          <!-- cells -->
          {#each STAGES as st, i}
            {@const c = MATRIX[st.id][L.id]}
            <rect x={colX(i)} y={y} width={COLW} height={h} rx="5"
              class="cell" class:on={started && i === active} class:past={passed(i)} class:open />
            {#if open}
              {#each wrap(c.moves, 21, 4) as ln, k}
                <text x={colX(i) + 8} y={y + 20 + k * 13} class="cell-t">{ln}</text>
              {/each}
            {:else}
              <!-- collapsed: a single tick per stage, so the row still reads as a timeline -->
              <rect x={colCx(i) - 9} y={y + h / 2 - 2} width="18" height="4" rx="2" class="tick" class:past={passed(i)} />
            {/if}
          {/each}

          <!-- the synchronised marker: the same instant, on every layer at once.
               On the open row it rides a clear band at the bottom so it never sits
               on top of the cell text. -->
          {#if started}
            {@const my = open ? y + h - 15 : y + h / 2}
            <circle cx={packetX} cy={my} r={open ? 8 : 4.5} class="pk" class:open
              class:human={sStage.human > 0} class:over={sStage.mode === 'override'} />
            {#if open}
              <circle cx={packetX} cy={my} r="8" class="pk-ring"
                class:pulse={step === 'work' && playing} />
            {/if}
          {/if}
        </g>
        <!-- whole-row click target, drawn last so it wins the hit test -->
        <rect x="0" y={y} width={W} height={h} class="row-hit" role="button" tabindex="0"
          aria-label="Show the {L.name} layer" onclick={() => (layerIdx = li)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); layerIdx = li; } }} />
      {/each}

      <!-- ---- footer key ---- -->
      <text x="0" y={H - 12} class="key">CLICK ANY LAYER TO OPEN IT · THE MARKER SHOWS THE SAME INSTANT ON ALL SIX</text>
      <g transform="translate({W - 350}, {H - 21})">
        <circle cx="6" cy="6" r="5" class="pk" /><text x="17" y="9.5" class="key">machine</text>
        <circle cx="86" cy="6" r="5" class="pk human" /><text x="97" y="9.5" class="key">human / governance</text>
        <circle cx="228" cy="6" r="5" class="pk over" /><text x="239" y="9.5" class="key">statutory override</text>
      </g>
    </svg>
  </div>

  <!-- ============ ELI5: THE WHOLE JOURNEY IN SIX ROWS ============ -->
  {#if eli}
    <div class="e-all">
      <span class="e-lab">THE WHOLE THING, IN SIX STEPS</span>
      <table class="e-tbl wide">
        <thead>
          <tr><th class="c-no">Step</th><th>What happens</th><th>What moves</th><th class="c-t">How long</th></tr>
        </thead>
        <tbody>
          {#each STAGES as st, i}
            {@const ss = scenario.stages[i]}
            <tr class:on={i === active}>
              <th class="c-no"><button onclick={() => seek(i)}>{st.no}. {st.name}</button></th>
              <td>{STAGE_ELI5[st.id].what}</td>
              <td class="mv">{STAGE_ELI5[st.id].moves}</td>
              <td class="c-t">
                {fmtDuration(ss.machine)} <span class="unit">computer</span>{#if ss.human > 0}<br /><span class="hum">+ {fmtDuration(ss.human)} <span class="unit">people</span></span>{/if}
              </td>
            </tr>
          {/each}
          <tr class="tot">
            <th class="c-no">All six</th>
            <td colspan="2">{scenario.eli5Why}</td>
            <td class="c-t"><b>{fmtDuration(scenario.stages.reduce((a, x) => a + x.machine + x.human, 0))}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  {/if}

  <!-- ============ DETAIL CARD ============ -->
  <div class="detail">
    <div class="d-head">
      <span class="d-stage">STAGE {STAGES[active].no} · {STAGES[active].name}</span>
      <span class="d-x">×</span>
      <span class="d-layer">L{LAYERS[layerIdx].no} · {lName(LAYERS[layerIdx]).toUpperCase()}</span>
      <span class="d-actor">{STAGES[active].actor}</span>
    </div>

    <p class="d-say">{say(STAGES[active], depth)}</p>

    {#if eli}
      <!-- ELI5: a two-column table beats four columns of prose -->
      <table class="e-tbl">
        <tbody>
          <tr><th>What happens</th><td>{STAGE_ELI5[activeStage].what}</td></tr>
          <tr><th>What moves</th><td class="mv">{STAGE_ELI5[activeStage].moves}</td></tr>
          <tr><th>Who is involved</th><td>{STAGE_ELI5[activeStage].who}</td></tr>
          <tr><th>In this scenario</th><td>{sStage.note}</td></tr>
          <tr><th>How long</th><td>
            <b>{fmtDuration(sStage.machine)}</b> of computer time{#if sStage.human > 0}, plus <b class="hum">{fmtDuration(sStage.human)}</b> waiting for people — {(sStage.humanWorkEli5 ?? sStage.humanWork ?? '').toLowerCase()}{/if}.
          </td></tr>
          <tr class="bad"><th>What goes wrong</th><td>{activeCell.fails}</td></tr>
        </tbody>
      </table>
    {:else}
    <div class="d-grid">
      <div class="dc">
        <span class="dc-lab">What happens here</span>
        <p>{activeCell.what}</p>
      </div>
      <div class="dc">
        <span class="dc-lab">In this scenario</span>
        <p>{sStage.note}</p>
        <div class="dur">
          <span class="dpill machine">{fmtDuration(sStage.machine)} machine</span>
          {#if sStage.human > 0}
            <span class="dpill human">{fmtDuration(sStage.human)} human</span>
          {/if}
        </div>
        {#if sStage.humanWork}
          <p class="hw">⏳ <b>The human work:</b> {sStage.humanWork}</p>
        {/if}
      </div>
      <div class="dc">
        <span class="dc-lab">What crosses the boundary</span>
        <p class="moves">{activeCell.moves}</p>
        <span class="dc-lab tight">Who is acting</span>
        <p class="who">{activeCell.who}</p>
      </div>
      <div class="dc fail">
        <span class="dc-lab">How this fails in practice</span>
        <p>{activeCell.fails}</p>
      </div>
    </div>
    {/if}

    <div class="d-nav">
      <button class="dn" onclick={() => seek(active - 1)} disabled={active === 0}>← previous stage</button>
      <div class="dots">
        {#each STAGES as st, i}
          <button class="dot" class:on={i === active} title={st.name}
            aria-label={st.name} onclick={() => seek(i)}></button>
        {/each}
      </div>
      <button class="dn" onclick={() => seek(active + 1)} disabled={active === STAGES.length - 1}>next stage →</button>
    </div>
  </div>

  <!-- ============ THE POINT ============ -->
  <p class="point"><b>The point of this trace.</b> {scenario.point}</p>
</div>

<style>
  .rt { border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-sharp); background: var(--surface-elevated, #e8dece); overflow: hidden; }

  /* scenario picker */
  .pick { display: flex; align-items: center; gap: 12px; padding: 14px 18px 6px; flex-wrap: wrap; }
  .pick-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.2em; text-transform: uppercase; color: rgba(26,16,8,0.6); }
  .pick-row { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
  .sc { text-align: left; background: #ffffff; border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-sharp); padding: 7px 11px; cursor: pointer; min-width: 150px; flex: 1 1 150px; }
  .sc b { display: block; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); line-height: 1.2; }
  .sc span { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; color: rgba(26,16,8,0.6); margin-top: 3px; }
  .sc:hover { border-color: var(--accent-ink, #0e5b66); }
  .sc.on { background: var(--accent-ink, #0e5b66); border-color: var(--accent-ink, #0e5b66); }
  .sc.on b { color: #fff; }
  .sc.on span { color: #a9d3d0; }

  /* question + clock */
  .head { display: flex; gap: 14px; align-items: stretch; flex-wrap: wrap; padding: 8px 18px 10px; }
  .qbox { flex: 1 1 440px; min-width: 280px; background: #ffffff; border: 1.5px solid rgba(26,16,8,0.45); border-left: 4px solid var(--accent-ink, #0e5b66); border-radius: var(--radius-sharp); padding: 12px 16px; }
  .q-eyebrow { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-ink, #0e5b66); }
  .q-text { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(16px, 1.9vw, 21px); line-height: 1.25; color: var(--ink); margin: 5px 0 8px; }
  .q-say { font-size: var(--fs-label); line-height: 1.5; color: rgba(26,16,8,0.8); margin: 0 0 9px; }
  .chips { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
  .mchip { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.06em; color: var(--accent-ink, #0e5b66);
    background: rgba(14,91,102,0.09); border: 1px solid rgba(14,91,102,0.32); border-radius: var(--radius-sharp); padding: 2px 5px; cursor: help; }

  .clock { display: flex; flex-direction: column; gap: 7px; flex: 0 0 auto; justify-content: center; }
  .ck { background: #ffffff; border: 1.5px solid rgba(26,16,8,0.45); border-radius: var(--radius-sharp); padding: 7px 14px; text-align: center; min-width: 132px; }
  .ck b { display: block; font-family: var(--fs-serif); font-weight: 600; font-size: 21px; line-height: 1.05; color: var(--ink); }
  .ck span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; color: rgba(26,16,8,0.6); }
  .ck.machine b { color: var(--accent-ink, #0e5b66); }
  .ck.human b { color: rgba(26,16,8,0.4); }
  .ck.human.hot { border-color: #a8701a; background: #fdf4e6; }
  .ck.human.hot b { color: #8c5a10; }

  .transport { display: flex; gap: 5px; justify-content: center; }
  .tp { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--ink); background: #ffffff;
    border: 1.5px solid rgba(26,16,8,0.45); border-radius: var(--radius-sharp); padding: 6px 11px; cursor: pointer; line-height: 1; }
  .tp:hover:not(:disabled) { border-color: var(--accent-ink, #0e5b66); }
  .tp:disabled { opacity: 0.35; cursor: default; }
  .tp.primary { background: var(--accent-ink, #0e5b66); border-color: var(--accent-ink, #0e5b66); color: #fff; }
  .tp.primary:hover { background: #094850; }

  /* the grid */
  .stage-scroll { overflow-x: auto; padding: 2px 18px 4px; }
  svg { display: block; min-width: 880px; width: 100%; height: auto; }

  .hd-box { fill: #ffffff; stroke: rgba(26,16,8,0.42); stroke-width: 1.4; transition: fill 0.25s, stroke 0.25s; }
  .hd-box.human { fill: #fdf4e6; stroke: rgba(168,112,26,0.55); }
  .hd.past .hd-box { fill: #eef6f0; stroke: rgba(47,125,79,0.6); }
  .hd.now .hd-box { stroke: var(--accent-ink, #0e5b66); stroke-width: 2.4; }
  .hd-no { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); fill: var(--accent-ink, #0e5b66); }
  .hd-name { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; fill: var(--ink); }
  .hd-place { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; fill: rgba(26,16,8,0.62); }
  .hd-dur { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; fill: var(--accent-ink, #0e5b66); }
  .hd-hum { fill: #8c5a10; }
  .hd-flag { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.06em; fill: #8c5a10; }
  .hd-flag.over { fill: #8a2d3a; }
  .hd-prog { fill: var(--accent-ink, #0e5b66); }
  .hd-prog.human { fill: #a8701a; }

  .lg { fill: #ffffff; stroke: rgba(26,16,8,0.3); stroke-width: 1.2; transition: fill 0.25s; }
  .lg.open { fill: var(--accent-ink, #0e5b66); stroke: #05343b; }
  .lg-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; fill: rgba(26,16,8,0.55); }
  .lg-name { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; fill: var(--ink); }
  .row.open .lg-no { fill: #8fc3bd; }
  .row.open .lg-name { fill: #ffffff; }
  .lg-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; fill: #8fc3bd; }
  .lg-q { font-family: var(--font-body); font-size: var(--fs-label-xs); fill: #d7ece9; }

  .cell { fill: #ffffff; stroke: rgba(26,16,8,0.22); stroke-width: 1.1; transition: fill 0.25s, stroke 0.25s; }
  .cell.open { stroke: rgba(26,16,8,0.4); }
  .cell.past { fill: #f2f8f3; }
  .cell.on { stroke: var(--accent-ink, #0e5b66); stroke-width: 2; fill: #eef5f6; }
  .cell-t { font-family: var(--font-body); font-size: var(--fs-label-xs); fill: rgba(26,16,8,0.86); }
  .tick { fill: rgba(26,16,8,0.2); }
  .tick.past { fill: rgba(47,125,79,0.62); }

  .pk { fill: var(--accent-ink, #0e5b66); stroke: #ede4d4; stroke-width: 1.6; }
  .pk.human { fill: #a8701a; }
  .pk.over { fill: #8a2d3a; }
  .pk-ring { fill: none; stroke: var(--accent-ink, #0e5b66); stroke-width: 1.6; opacity: 0.5; }
  .pk-ring.pulse { animation: rt-pulse 1.1s ease-out infinite; }
  @keyframes rt-pulse { from { r: 8; opacity: 0.55; } to { r: 21; opacity: 0; } }

  .row-hit { fill: transparent; cursor: pointer; }
  .row-hit:focus-visible { outline: 2px solid var(--accent-ink, #0e5b66); }

  .key { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; fill: rgba(26,16,8,0.55); }

  /* detail card */
  .detail { background: #ffffff; border-top: 1.5px solid rgba(26,16,8,0.4); padding: 14px 18px 12px; }
  .d-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 7px; }
  .d-stage { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.12em; color: var(--accent-ink, #0e5b66); }
  .d-x { color: rgba(26,16,8,0.4); font-size: var(--fs-label-xs); }
  .d-layer { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.12em; color: var(--ink); }
  .d-actor { font-family: var(--font-body); font-size: var(--fs-label-xs); color: rgba(26,16,8,0.6); margin-left: auto; }
  .d-say { font-family: var(--fs-serif); font-size: var(--fs-body-sm); line-height: 1.45; color: var(--ink); margin: 0 0 12px; max-width: 88ch; }

  .d-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
  .dc { border-left: 2px solid rgba(26,16,8,0.18); padding-left: 10px; }
  .dc.fail { border-left-color: rgba(138,45,58,0.45); }
  .dc-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: rgba(26,16,8,0.55); margin-bottom: 4px; }
  .dc-lab.tight { margin-top: 8px; }
  .dc p { font-size: var(--fs-label); line-height: 1.5; color: rgba(26,16,8,0.84); margin: 0; }
  .dc.fail p { color: #6d232d; }
  .dc p.moves { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink, #0e5b66); }
  .dc p.who { font-size: var(--fs-label-xs); color: rgba(26,16,8,0.7); }
  .dur { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 7px; }
  .dpill { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.05em; border-radius: var(--radius-sharp); padding: 2px 6px; }
  .dpill.machine { color: var(--accent-ink, #0e5b66); background: rgba(14,91,102,0.1); border: 1px solid rgba(14,91,102,0.3); }
  .dpill.human { color: #8c5a10; background: #fdf4e6; border: 1px solid rgba(168,112,26,0.5); }
  .hw { font-size: var(--fs-label-xs); line-height: 1.45; color: #8c5a10; margin: 7px 0 0; }
  .hw b { color: #6f460b; }

  .d-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(26,16,8,0.14); }
  .dn { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--accent-ink, #0e5b66); background: transparent; border: 1px solid rgba(14,91,102,0.35); border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer; }
  .dn:hover:not(:disabled) { background: rgba(14,91,102,0.07); }
  .dn:disabled { opacity: 0.3; cursor: default; }
  .dots { display: flex; gap: 5px; }
  .dot { width: 9px; height: 9px; border-radius: var(--radius-pill, 100px); border: 1px solid rgba(26,16,8,0.4); background: transparent; padding: 0; cursor: pointer; }
  .dot.on { background: var(--accent-ink, #0e5b66); border-color: var(--accent-ink, #0e5b66); }

  /* ELI5 tables — the plainest depth gets a table, not four columns of prose */
  .e-all { background: #ffffff; border-top: 1.5px solid rgba(26,16,8,0.4); padding: 14px 18px 16px; }
  .e-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em;
    text-transform: uppercase; color: rgba(26,16,8,0.58); margin-bottom: 9px; }
  .e-tbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .e-tbl th, .e-tbl td { text-align: left; vertical-align: top; padding: 8px 10px; font-size: var(--fs-label); line-height: 1.5;
    border-bottom: 1px solid rgba(26,16,8,0.12); }
  .e-tbl th { font-family: var(--font-body); font-weight: 600; color: var(--ink); width: 150px; }
  .e-tbl td { color: rgba(26,16,8,0.84); }
  .e-tbl td.mv { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink, #0e5b66); }
  .e-tbl tr.bad th { color: #8a2d3a; }
  .e-tbl tr.bad td { color: #6d232d; }
  .e-tbl b.hum, .e-tbl .hum { color: #8c5a10; }
  .e-tbl.wide { table-layout: fixed; }
  .e-tbl.wide thead th { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(26,16,8,0.55); border-bottom: 1.5px solid rgba(26,16,8,0.3); width: auto; }
  .e-tbl.wide th.c-no { width: 168px; }
  .e-tbl.wide td.c-t, .e-tbl.wide th.c-t { width: 148px; font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .e-tbl.wide td.c-t .unit { font-family: var(--font-body); font-size: var(--fs-label-xs); color: rgba(26,16,8,0.5); }
  .e-tbl.wide td.c-t .hum .unit { color: rgba(140,90,16,0.75); }
  .e-tbl.wide th.c-no button { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--accent-ink, #0e5b66);
    background: transparent; border: none; padding: 0; text-align: left; cursor: pointer; }
  .e-tbl.wide th.c-no button:hover { text-decoration: underline; }
  .e-tbl.wide tr.on { background: rgba(14,91,102,0.06); }
  .e-tbl.wide tr.on th.c-no button { color: var(--ink); }
  .e-tbl.wide tr.tot { background: rgba(26,16,8,0.04); }
  .e-tbl.wide tr.tot th { color: rgba(26,16,8,0.6); font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.1em; text-transform: uppercase; }

  .point { font-size: var(--fs-nav); line-height: 1.55; color: rgba(26,16,8,0.84); margin: 0; padding: 12px 18px 16px; background: rgba(14,91,102,0.05); border-top: 1px solid rgba(26,16,8,0.14); }
  .point b { color: var(--accent-ink, #0e5b66); }

  @media (max-width: 700px) {
    .head { padding: 8px 12px 10px; }
    .clock { width: 100%; flex-direction: row; flex-wrap: wrap; }
    .ck { flex: 1; min-width: 0; }
    .transport { width: 100%; }
    .stage-scroll { padding: 2px 12px 4px; }
    .detail, .point { padding-left: 12px; padding-right: 12px; }
  }
</style>
