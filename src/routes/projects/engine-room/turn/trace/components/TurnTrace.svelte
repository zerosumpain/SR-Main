<script lang="ts">
  // TurnTrace — the flagship instrument. Six stages across, six layers down.
  //
  // Structure copied from data-spine/trace/components/RequestTrace.svelte. The grid IS the
  // argument: one expanded layer row names what happens at that layer at every stage, while
  // every collapsed row carries a synchronised marker — so it reads as "all six layers are
  // happening at once, and here is the one you asked about". The prose for the selected
  // intersection lives in the detail card below, where it is readable, rather than as
  // ellipsis-truncated 8px text inside the cells.
  //
  // Rendering rules (svelte5-pitfalls §1): structure is always drawn; motion is JS-driven so
  // play/pause/step can control it; every timer/rAF handle is a plain `let`, never $state.
  import { onMount } from 'svelte';
  import {
    LAYERS, STAGES, SCENARIOS, MATRIX,
    fmtDuration, fmtTokens, fmtCents,
    type Depth, type LayerId, type Scenario,
  } from '../../../lib/trace';

  let { depth = 'engineering' as Depth }: { depth?: Depth } = $props();

  // --- reactive state (only what the template reads) -----------------------
  let sIdx = $state(0);
  let layerIdx = $state(2);            // Context opens first — it is the section's thesis
  let active = $state(0);
  let step = $state<'work' | 'travel'>('work');
  let t = $state(0);
  let playing = $state(false);
  let started = $state(false);
  let done = $state(false);
  let elapsed = $state(0);
  let tokens = $state(0);
  let cents = $state(0);

  // --- non-reactive handles (never $state) ---------------------------------
  let raf = 0;
  let stepStart = 0;
  let stepDur = 0;

  const scenario = $derived<Scenario>(SCENARIOS[sIdx]);
  const layer = $derived<LayerId>(LAYERS[layerIdx].id);
  const activeStage = $derived(STAGES[active].id);
  const sStage = $derived(scenario.stages[active]);
  const activeCell = $derived(MATRIX[activeStage][layer]);
  const eli = $derived(depth === 'eli5');

  const totalMs = $derived(scenario.stages.reduce((a, x) => a + x.ms, 0));
  const totalTok = $derived(scenario.stages[scenario.stages.length - 1].tokens);
  const totalCents = $derived(scenario.stages[scenario.stages.length - 1].cents);

  // ---- playback -----------------------------------------------------------
  // Visual dwell is log-compressed from the real duration so a 40 ms stage and a
  // 155-second stage are both watchable.
  function visMs(i: number): number {
    if (step === 'travel') return 420;
    const total = SCENARIOS[sIdx].stages[i].ms;
    const norm = Math.log10(1 + total) / Math.log10(1 + 155_000);
    return Math.round(520 + 2100 * Math.min(1, norm));
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
      elapsed += st.ms;
      tokens = st.tokens;
      cents = st.cents;
      if (active >= STAGES.length - 1) { playing = false; done = true; t = 1; return; }
      step = 'travel';
    } else {
      active += 1;
      step = 'work';
    }
    if (playing) beginStep();
  }

  function play() {
    if (done) reset();
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
    elapsed = 0;
    tokens = 0;
    cents = 0;
  }

  function pickScenario(i: number) {
    reset();
    sIdx = i;
    layerIdx = LAYERS.findIndex((l) => l.id === SCENARIOS[i].watch);
  }

  /** Jump straight to a stage. The readouts MUST follow, or the clock claims zero
   *  while the marker sits on stage 5 — recompute from the cumulative figures. */
  function seek(i: number) {
    cancelAnimationFrame(raf);
    playing = false;
    started = true;
    active = Math.max(0, Math.min(STAGES.length - 1, i));
    step = 'work';
    t = 1;
    done = active >= STAGES.length - 1;
    const upto = SCENARIOS[sIdx].stages.slice(0, active + 1);
    elapsed = upto.reduce((a, s) => a + s.ms, 0);
    tokens = upto[upto.length - 1].tokens;
    cents = upto[upto.length - 1].cents;
  }

  onMount(() => () => cancelAnimationFrame(raf));

  // ---- geometry (viewBox 1000 × H) ----------------------------------------
  const W = 1000;
  const LX = 132;
  const RPAD = 16;
  const GAP = 9;
  const COLW = (W - LX - RPAD - GAP * (STAGES.length - 1)) / STAGES.length;
  const colX = (i: number) => LX + i * (COLW + GAP);
  const colCx = (i: number) => colX(i) + COLW / 2;

  const HEAD_Y = 8;
  const HEAD_H = 40;
  const GRID_Y = HEAD_Y + HEAD_H + 12;
  const ROW_OPEN = 62;
  const ROW_SHUT = 26;
  const ROW_GAP = 5;

  const rowY = (i: number) => {
    let y = GRID_Y;
    for (let k = 0; k < i; k++) y += (k === layerIdx ? ROW_OPEN : ROW_SHUT) + ROW_GAP;
    return y;
  };
  const rowH = (i: number) => (i === layerIdx ? ROW_OPEN : ROW_SHUT);
  const H = $derived(rowY(LAYERS.length - 1) + rowH(LAYERS.length - 1) + 30);

  // the marker's x position — the same instant, read on every row
  const packetX = $derived.by(() => {
    if (step === 'work') return colCx(active);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    return colCx(active) + (colCx(Math.min(active + 1, STAGES.length - 1)) - colCx(active)) * e;
  });

  const lName = (L: typeof LAYERS[number]) => (eli ? L.eli5Name : L.name);
  const lQuestion = (L: typeof LAYERS[number]) => (eli ? L.eli5Question : L.question);
  const sName = (S: typeof STAGES[number]) => (eli ? S.eli5Name : S.name);
  const cText = (c: { label: string; detail: string; eli5: string }) => (eli ? c.eli5 : c.detail);

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

  /** Break prose at a sentence boundary so no rendered paragraph runs past 45 words.
   *  The source strings are typed constants in ../../../lib/trace, outside this leaf, so
   *  nothing here rewords, rounds or drops any of it — long text is only broken in two. */
  function paras(text: string): string[] {
    if (text.trim().split(/\s+/).length <= 45) return [text];
    const sentences = text.match(/[^.!?]+[.!?]+["'”’)]*\s*/g);
    if (!sentences || sentences.length < 2) return [text];
    const mid = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, mid).join('').trim(), sentences.slice(mid).join('').trim()].filter(Boolean);
  }

  /** has the marker passed this stage? drives the "done" styling */
  const passed = (i: number) => started && (i < active || (i === active && (step === 'travel' || done)));
  /** does this cell carry a documented failure mode? */
  const hasHazard = (stageIx: number, lId: LayerId) => !!MATRIX[STAGES[stageIx].id][lId].hazard;
  const hazCount = (lId: LayerId) => STAGES.filter((s) => MATRIX[s.id][lId].hazard).length;

  const gridLabel = $derived(
    `Grid: six stages of one turn — ${STAGES.map(sName).join(', ')} — against six layers — ` +
    `${LAYERS.map(lName).join(', ')}. Scenario: ${scenario.label}. End to end ` +
    `${fmtDuration(totalMs)}, ${fmtTokens(totalTok)} tokens, ${fmtCents(totalCents)}. ` +
    `Open layer: ${lName(LAYERS[layerIdx])}. Marker on stage ${STAGES[active].no}, ${sName(STAGES[active])}.`
  );
</script>

<div class="rt">
  <!-- ============ SCENARIO PICKER ============ -->
  <div class="pick" role="group" aria-label="Scenario">
    <span class="pick-lab">Trace</span>
    <div class="pick-row">
      {#each SCENARIOS as s, i (s.id)}
        <button class="sc" class:on={i === sIdx} aria-pressed={i === sIdx} onclick={() => pickScenario(i)}>
          {s.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- ============ THE MESSAGE + READOUTS ============ -->
  <div class="head">
    <div class="qbox">
      <span class="q-eyebrow">THE TURN</span>
      <p class="q-text">{scenario.prompt}</p>
      {#each paras(scenario.note) as p, i (i)}<p class="q-say">{p}</p>{/each}
    </div>

    <div class="clock">
      <div class="ck"><b>{elapsed > 0 ? fmtDuration(elapsed) : '0 ms'}</b><span>ELAPSED</span></div>
      <div class="ck" class:hot={tokens > 0}><b>{tokens > 0 ? fmtTokens(tokens) : '0'}</b><span>TOKENS</span></div>
      <div class="ck" class:hot={cents > 0}><b>{fmtCents(cents)}</b><span>COST</span></div>
      <div class="transport">
        {#if playing}
          <button class="tp" onclick={pause} aria-label="Pause the trace" title="Pause">❚❚</button>
        {:else}
          <button class="tp primary" onclick={play}
            aria-label={done ? 'Run the trace again' : 'Play the trace'}
            title={done ? 'Run it again' : 'Run the trace'}>▶</button>
        {/if}
        <button class="tp" onclick={stepOn} aria-label="Advance one step" title="Advance one step">▸❙</button>
        <button class="tp" onclick={reset} aria-label="Reset the trace" title="Reset" disabled={!started}>⟲</button>
      </div>
    </div>
  </div>

  <!-- ============ LAYER PICKER ============ -->
  <!-- Real buttons, so choosing a layer is reachable from the keyboard without depending on
       focusable SVG rects. The rects below stay clickable for the mouse but are out of the
       tab order (tabindex -1), so there is exactly one keyboard path per action. -->
  <div class="pick lay" role="group" aria-label="Layer">
    <span class="pick-lab">Layer</span>
    <div class="pick-row">
      {#each LAYERS as L, i (L.id)}
        <button class="ly" class:on={i === layerIdx} class:haz={hazCount(L.id) > 0}
          aria-pressed={i === layerIdx}
          title={lQuestion(L)}
          onclick={() => (layerIdx = i)}>
          <span class="ly-no">L{L.no}</span>{lName(L)}{#if hazCount(L.id) > 0}<span class="ly-haz" aria-hidden="true">⚠</span>{/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- ============ THE GRID ============ -->
  <div class="stage-scroll">
    <svg viewBox="0 0 {W} {H}" role="img" aria-label={gridLabel}>

      <!-- ---- stage header band ---- -->
      {#each STAGES as st, i (st.id)}
        {@const ss = scenario.stages[i]}
        <g class="hd" class:now={started && i === active} class:past={passed(i)}>
          <rect x={colX(i)} y={HEAD_Y} width={COLW} height={HEAD_H} rx="6" class="hd-box" />
          <text x={colX(i) + 8} y={HEAD_Y + 15} class="hd-no">{st.no}</text>
          <text x={colX(i) + 21} y={HEAD_Y + 15} class="hd-name">{sName(st)}</text>
          <text x={colX(i) + 8} y={HEAD_Y + 31} class="hd-dur">{fmtDuration(ss.ms)}</text>
          <text x={colX(i) + COLW - 8} y={HEAD_Y + 31} text-anchor="end" class="hd-cost">{fmtCents(ss.cents)}</text>
          {#if started && i === active && step === 'work' && !done}
            <rect x={colX(i)} y={HEAD_Y + HEAD_H - 3} width={COLW * t} height="3" class="hd-prog" />
          {/if}
        </g>
      {/each}

      <!-- ---- layer rows ---- -->
      {#each LAYERS as L, li (L.id)}
        {@const y = rowY(li)}
        {@const h = rowH(li)}
        {@const open = li === layerIdx}
        <g class="row" class:open>
          <rect x="0" y={y} width={LX - 8} height={h} rx="5" class="lg" class:open />
          <text x="10" y={y + (open ? 15 : 17)} class="lg-no">L{L.no}</text>
          <text x="34" y={y + (open ? 15 : 17)} class="lg-name">{lName(L)}</text>
          {#if open}
            <text x="10" y={y + 28} class="lg-tag">{L.tag}</text>
            {#each wrap(lQuestion(L), 22, 3) as ln, k (k)}
              <text x="10" y={y + 40 + k * 10} class="lg-q">{ln}</text>
            {/each}
          {/if}

          <!-- cells -->
          {#each STAGES as st, i (st.id)}
            {@const c = MATRIX[st.id][L.id]}
            <rect x={colX(i)} y={y} width={COLW} height={h} rx="5"
              class="cell" class:on={started && i === active} class:past={passed(i)} class:open />
            {#if open}
              {#each wrap(c.label, 18, 2) as ln, k (k)}
                <text x={colX(i) + 8} y={y + 16 + k * 11} class="cell-h">{ln}</text>
              {/each}
              {#if c.hazard}
                <text x={colX(i) + COLW - 7} y={y + 16} text-anchor="end" class="cell-haz">⚠</text>
              {/if}
            {:else}
              <!-- collapsed: a single tick per stage, so the row still reads as a timeline -->
              <rect x={colCx(i) - 9} y={y + h / 2 - 2} width="18" height="4" rx="2" class="tick" class:past={passed(i)} />
              {#if hasHazard(i, L.id)}
                <circle cx={colCx(i) + 15} cy={y + h / 2} r="2.2" class="tick-haz" />
              {/if}
            {/if}
          {/each}

          <!-- the synchronised marker: the same instant, on every layer at once -->
          {#if started}
            {@const my = open ? y + h - 12 : y + h / 2}
            <circle cx={packetX} cy={my} r={open ? 7 : 4.5} class="pk" class:open />
            {#if open}
              <circle cx={packetX} cy={my} r="7" class="pk-ring" class:pulse={step === 'work' && playing} />
            {/if}
          {/if}
        </g>

        <!-- Mouse hit targets, drawn last so they win the hit test. Keyboard users get the
             same two actions from the layer buttons above and the stage buttons in the
             table below, so these are deliberately out of the tab order. -->
        {#if li === layerIdx}
          {#each STAGES as st, i (st.id)}
            <rect x={colX(i)} y={rowY(li)} width={COLW} height={rowH(li)} class="row-hit"
              role="button" tabindex="-1" aria-label="Show stage {st.no}, {sName(st)}"
              onclick={() => seek(i)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seek(i); } }} />
          {/each}
        {:else}
          <rect x="0" y={rowY(li)} width={W} height={rowH(li)} class="row-hit"
            role="button" tabindex="-1" aria-label="Open the {lName(L)} layer"
            onclick={() => (layerIdx = li)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); layerIdx = li; } }} />
        {/if}
      {/each}

      <!-- The Cell type calls `hazard` "where a known failure mode lives". The previous copy
           read "something actually broke in production", which overclaims: assemble×context
           carries a measurement, not an incident. Use the constant's own definition. -->
      <text x="0" y={H - 10} class="key">⚠ = A KNOWN FAILURE MODE</text>
    </svg>
  </div>

  <!-- ============ DETAIL CARD ============ -->
  <div class="detail">
    <div class="d-head">
      <span class="d-stage">STAGE {STAGES[active].no} · {sName(STAGES[active]).toUpperCase()}</span>
      <span class="d-x" aria-hidden="true">×</span>
      <span class="d-layer">L{LAYERS[layerIdx].no} · {lName(LAYERS[layerIdx]).toUpperCase()}</span>
      <span class="d-nav">
        <button onclick={() => seek(active - 1)} disabled={active === 0} aria-label="Previous stage" title="Previous stage">‹</button>
        <button onclick={() => seek(active + 1)} disabled={active === STAGES.length - 1} aria-label="Next stage" title="Next stage">›</button>
      </span>
    </div>
    <p class="d-label">{activeCell.label}</p>
    {#each paras(cText(activeCell)) as p, i (i)}<p class="d-body">{p}</p>{/each}
    <p class="d-say"><b>In this trace:</b> {sStage.say}</p>
    {#if activeCell.hazard}
      <div class="d-haz">
        <span class="dh-lab">⚠ Where this goes wrong</span>
        {#each paras(activeCell.hazard) as p, i (i)}<p>{p}</p>{/each}
      </div>
    {/if}
  </div>

  <!-- ============ THE WHOLE JOURNEY, AS A TABLE ============ -->
  <div class="e-all">
    <span class="e-lab">ALL SIX STAGES</span>
    <div class="tbl-scroll">
      <table class="e-tbl">
        <thead>
          <tr><th class="c-no">Stage</th><th class="c-t">Time</th><th class="c-t">Tokens</th><th class="c-t">Cost</th></tr>
        </thead>
        <tbody>
          {#each STAGES as st, i (st.id)}
            {@const ss = scenario.stages[i]}
            <tr class:on={i === active}>
              <th class="c-no">
                <button onclick={() => seek(i)} aria-current={i === active ? 'true' : undefined}>{st.no}. {sName(st)}</button>
              </th>
              <td class="c-t">{fmtDuration(ss.ms)}</td>
              <td class="c-t">{fmtTokens(ss.tokens)}</td>
              <td class="c-t">{fmtCents(ss.cents)}</td>
            </tr>
          {/each}
          <tr class="tot">
            <th class="c-no">All six</th>
            <td class="c-t"><b>{fmtDuration(totalMs)}</b></td>
            <td class="c-t"><b>{fmtTokens(totalTok)}</b></td>
            <td class="c-t"><b>{fmtCents(totalCents)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="e-note">Representative shapes from real runs, not one stopwatched request.</p>
  </div>
</div>

<style>
  .rt { margin: 10px 0 4px; }

  /* ---- pickers ---- */
  .pick { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .pick.lay { margin-top: 2px; }
  .pick-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(28,22,17,0.5); padding-top: 9px; }
  .pick-row { display: flex; gap: 7px; flex-wrap: wrap; flex: 1; min-width: 0; }

  .sc { text-align: left; cursor: pointer; background: rgba(255,255,255,0.55);
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round);
    padding: 7px 14px; min-width: 0; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600;
    color: var(--text-primary); transition: background 0.12s, border-color 0.12s; }
  .sc:hover { background: rgba(28,22,17,0.06); border-color: rgba(28,22,17,0.38); }
  .sc.on { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }

  .ly { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; min-width: 0;
    padding: 4px 11px 4px 5px; border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-pill);
    background: rgba(255,255,255,0.6); font-family: 'DM Sans', sans-serif; font-size: 12.5px;
    line-height: 1.25; color: var(--text-primary); transition: background 0.12s, border-color 0.12s; }
  .ly:hover { border-color: rgba(28,22,17,0.4); }
  .ly-no { flex-shrink: 0; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px;
    border-radius: var(--radius-pill); background: var(--accent-ink); color: var(--bg);
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; }
  .ly.haz { border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 9%, transparent); }
  .ly.haz .ly-no { background: var(--accent); }
  .ly-haz { flex-shrink: 0; font-size: 11px; color: var(--accent); }
  .ly.on { background: var(--accent-ink); border-color: var(--accent-ink); color: var(--bg); }
  .ly.on .ly-no { background: var(--bg); color: var(--accent-ink); }
  .ly.on.haz { background: var(--accent); border-color: var(--accent); }
  .ly.on.haz .ly-no { background: var(--bg); color: var(--accent); }
  .ly.on .ly-haz { color: var(--bg); }

  /* ---- head ---- */
  .head { display: flex; gap: 16px; align-items: stretch; flex-wrap: wrap; margin-bottom: 12px; }
  .qbox { flex: 1 1 380px; min-width: 0; border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-12);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 10px 14px; }
  .q-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-ink); }
  .q-text { margin: 5px 0 6px; font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; line-height: 1.25; color: var(--text-primary); }
  .q-say { margin: 0 0 5px; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.7); }
  .q-say:last-child { margin-bottom: 0; }

  .clock { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ck { display: flex; flex-direction: column; gap: 1px; min-width: 92px; padding: 8px 12px;
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); }
  .ck b { font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 600; color: var(--text-primary); line-height: 1.1; }
  .ck span { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .ck.hot b { color: var(--accent); }
  .transport { display: flex; gap: 5px; }
  .tp { font-size: 12px; color: var(--text-primary); background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.22);
    border-radius: var(--radius-round); padding: 9px 12px; cursor: pointer; line-height: 1; }
  .tp:hover:not(:disabled) { background: rgba(28,22,17,0.08); }
  .tp.primary { background: var(--accent-ink); border-color: var(--accent-ink); color: var(--bg); }
  .tp.primary:hover { background: var(--accent-ink-hover); }
  .tp:disabled { opacity: 0.4; cursor: default; }

  /* ---- the grid ---- */
  .stage-scroll { overflow-x: auto; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.4); padding: 8px 10px; }
  .stage-scroll svg { display: block; min-width: 820px; width: 100%; height: auto; }

  .hd-box { fill: rgba(255,255,255,0.72); stroke: rgba(28,22,17,0.16); stroke-width: 1; }
  .hd.now .hd-box { fill: var(--accent-ink-tint-12); stroke: var(--accent-ink); stroke-width: 1.5; }
  .hd.past .hd-box { fill: rgba(28,22,17,0.055); }
  .hd-no { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; fill: var(--accent-ink); }
  .hd-name { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; fill: #1c1611; }
  .hd-dur { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; fill: rgba(28,22,17,0.62); }
  .hd-cost { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; fill: var(--accent); }
  .hd-prog { fill: var(--accent-ink); }

  .lg { fill: rgba(28,22,17,0.05); stroke: rgba(28,22,17,0.1); }
  .lg.open { fill: rgba(28,22,17,0.09); stroke: rgba(28,22,17,0.2); }
  .lg-no { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; fill: var(--accent-ink); }
  .lg-name { font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 600; fill: #1c1611; }
  .lg-tag { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.06em; fill: rgba(28,22,17,0.5); }
  .lg-q { font-family: 'DM Sans', sans-serif; font-size: 8.5px; fill: rgba(28,22,17,0.6); }

  .cell { fill: rgba(255,255,255,0.55); stroke: rgba(28,22,17,0.1); }
  .cell.open { fill: #fdfbf6; stroke: rgba(28,22,17,0.16); }
  .cell.past { fill: rgba(28,22,17,0.04); }
  .cell.open.past { fill: #f6f2e9; }
  .cell.on { stroke: var(--accent-ink); stroke-width: 1.5; }
  .cell-h { font-family: 'DM Sans', sans-serif; font-size: 10.5px; font-weight: 600; fill: #1c1611; }
  .cell-haz { font-size: 10px; fill: var(--accent); }
  .tick { fill: rgba(28,22,17,0.16); }
  .tick.past { fill: var(--accent-ink); }
  .tick-haz { fill: var(--accent); }

  .pk { fill: var(--accent-ink); }
  .pk-ring { fill: none; stroke: var(--accent-ink); stroke-width: 1.5; opacity: 0.5; }
  .pk-ring.pulse { animation: ring 1.1s ease-out infinite; }
  @keyframes ring { 0% { r: 7; opacity: 0.55; } 100% { r: 16; opacity: 0; } }

  .row-hit { fill: transparent; cursor: pointer; }
  .key { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.08em; fill: rgba(28,22,17,0.42); }

  /* ---- detail card ---- */
  .detail { margin-top: 12px; border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.5); padding: 12px 15px; }
  .d-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 7px; }
  .d-stage, .d-layer { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.11em; }
  .d-stage { color: var(--accent-ink); }
  .d-layer { color: var(--accent); }
  .d-x { font-size: 10px; color: rgba(28,22,17,0.3); }
  .d-nav { margin-left: auto; display: flex; gap: 4px; }
  .d-nav button { font-size: 12px; line-height: 1; color: var(--text-primary); background: rgba(255,255,255,0.7);
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 3px 10px; cursor: pointer; }
  .d-nav button:disabled { opacity: 0.35; cursor: default; }
  .d-label { margin: 0 0 4px; font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .d-body { margin: 0 0 8px; font-size: 13.5px; line-height: 1.58; color: rgba(28,22,17,0.76); max-width: 88ch; }
  .d-say { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.68); max-width: 88ch;
    padding-top: 8px; border-top: 1px solid rgba(28,22,17,0.09); }
  .d-say b { color: var(--text-primary); }
  .d-haz { margin-top: 10px; border-left: 3px solid var(--accent); background: var(--accent-tint-08);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 9px 13px; }
  .dh-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.11em;
    text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
  .d-haz p { margin: 0 0 6px; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); max-width: 88ch; }
  .d-haz p:last-child { margin-bottom: 0; }

  /* ---- table ---- */
  .e-all { margin-top: 14px; }
  .e-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 6px; }
  .tbl-scroll { overflow-x: auto; }
  .e-tbl { width: 100%; min-width: 320px; border-collapse: collapse; }
  .e-tbl th, .e-tbl td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid rgba(28,22,17,0.09); }
  .e-tbl thead th { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(28,22,17,0.5); font-weight: 500; }
  .e-tbl .c-no { width: auto; }
  .e-tbl .c-no button { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: var(--accent-ink);
    background: none; border: none; padding: 0; cursor: pointer; text-align: left; border-bottom: 1px dashed currentColor; }
  .e-tbl .c-t { width: 84px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(28,22,17,0.62); white-space: nowrap; }
  .e-tbl tr.on { background: var(--accent-ink-tint-12); }
  .e-tbl tr.tot td, .e-tbl tr.tot th { border-top: 1.5px solid rgba(28,22,17,0.25); border-bottom: none; padding-top: 9px; }
  .e-tbl tr.tot .c-no { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.08em; color: rgba(28,22,17,0.55); font-weight: 500; }
  .e-note { margin: 10px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.55); max-width: 88ch; }

  @media (max-width: 760px) {
    .clock { width: 100%; }
    .ck { min-width: 78px; padding: 7px 10px; }
  }
</style>
