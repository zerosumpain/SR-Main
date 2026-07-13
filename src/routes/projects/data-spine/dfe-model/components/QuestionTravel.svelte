<script lang="ts">
  // QuestionTravel — the hero "whole idea in one picture". Ask one real question;
  // watch it travel from the question node INTO the thin DfE trust bar (which holds
  // 0 records), fan OUT to the connectors weighted by real MIS market share (all
  // staying locked), and only the aggregate totals sum back UP the same channels to
  // the answer. A "…pool it instead?" toggle morphs to the central-store
  // counterfactual so the blast-radius cost is visceral.
  //
  // Rendering rules that keep it clean (learned from the first version's spaghetti):
  //  • Structural lines (query drop, connector fan, answer return) are drawn faint
  //    and ALWAYS — they are the skeleton, not the animation.
  //  • Moving dots render ONLY during phase==='run' and unmount at 'answered', so
  //    fill="freeze" never litters the idle canvas.
  //  • Query dots travel DOWN the fan; total dots travel UP the SAME fan — one set
  //    of channels, two directions. No cross-canvas return sweep.
  //  • All timer/rAF handles are plain `let` (never $state) — see svelte5-pitfalls.
  import { onMount } from 'svelte';
  import { FABRIC_NODES, WORKED_QUESTION, WORKED_ANSWER, WORKED_ANSWER_LABEL,
    POOL_RECORDS, BLAST_FEDERATED, BLAST_CENTRAL } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  const ESTATES = FABRIC_NODES.filter((n) => n.band === 'edge-mis');
  const TOTAL_SHARE = ESTATES.reduce((s, n) => s + (n.share ?? 0), 0);

  // --- reactive UI state (only what the template reads) ---
  let runKey = $state(0);          // bumping re-keys the SVG so <animateMotion> replays
  let phase = $state<'idle' | 'run' | 'answered'>('idle');
  let tilesLit = $state(false);
  let shownAnswer = $state(0);
  let pooled = $state(false);
  let poolFill = $state(0);        // 0..1 how full the central store is
  let shownMoved = $state(0);

  // --- non-reactive handles (never $state) ---
  let timers: ReturnType<typeof setTimeout>[] = [];
  let countHandle: ReturnType<typeof setInterval> | undefined;
  let poolHandle: ReturnType<typeof setInterval> | undefined;

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function tween(from: number, to: number, ms: number, set: (v: number) => void): ReturnType<typeof setInterval> {
    const steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    const h = setInterval(() => {
      i++;
      const t = i / steps;
      const eased = 1 - Math.pow(1 - t, 3);
      set(Math.round(from + (to - from) * eased));
      if (i >= steps) { set(to); clearInterval(h); }
    }, 40);
    return h;
  }

  function ask() {
    if (pooled) return;
    clearTimers();
    clearInterval(countHandle);
    clearInterval(poolHandle); // an interrupted pool-reverse must not leave records "moved"
    phase = 'run';
    tilesLit = false;
    shownAnswer = 0;
    shownMoved = 0; // federated truth: nothing moved
    poolFill = 0;
    runKey += 1; // restart the travel animation
    timers.push(setTimeout(() => { tilesLit = true; }, 1600));
    timers.push(setTimeout(() => { countHandle = tween(0, WORKED_ANSWER, 1100, (v) => (shownAnswer = v)); }, 2900));
    timers.push(setTimeout(() => { phase = 'answered'; }, 4200));
  }

  function togglePool() {
    clearTimers();
    clearInterval(countHandle);
    clearInterval(poolHandle);
    pooled = !pooled;
    runKey += 1;
    if (pooled) {
      // federated → pooled: streams rise, the store fills, counters slam up
      phase = 'answered';
      tilesLit = false;
      poolHandle = tween(0, 100, 1400, (v) => (poolFill = v / 100));
      countHandle = tween(0, POOL_RECORDS, 1600, (v) => (shownMoved = v));
    } else {
      // back to federated
      poolHandle = tween(Math.round(poolFill * 100), 0, 700, (v) => (poolFill = v / 100));
      countHandle = tween(shownMoved, 0, 700, (v) => (shownMoved = v));
    }
  }

  onMount(() => () => { clearTimers(); clearInterval(countHandle); clearInterval(poolHandle); });

  // --- geometry (viewBox 1000 × 440) ---------------------------------------
  const W = 1000, H = 440;
  const ROW_X = 64, ROW_W = 872, GAP = 10;
  const Q = { x: 356, y: 16, w: 288, h: 72 };            // question origin (top-centre)
  const A = { x: 668, y: 16, w: 268, h: 72 };            // answer (top-right)
  const BAR = { x: ROW_X, y: 152, w: ROW_W, h: 58 };
  const TILE_Y = 322, TILE_H = 104;
  const FAN0 = { x: BAR.x + BAR.w / 2, y: BAR.y + BAR.h }; // fan origin (bar bottom-centre)

  // tiles: min-width base + share-weighted remainder, so widths sum to exactly ROW_W
  interface Tile { id: string; label: string; short: string; x: number; w: number; cx: number; share: number; count: number }
  const MIN = 66;
  const usable = ROW_W - GAP * (ESTATES.length - 1);
  const extra = usable - ESTATES.length * MIN;
  let acc = ROW_X;
  const TILES: Tile[] = ESTATES.map((n) => {
    const share = n.share ?? 0;
    const w = MIN + (share / TOTAL_SHARE) * extra;
    const t: Tile = { id: n.id, label: n.label, short: n.label.split(/[ /]/)[0], x: acc, w, cx: acc + w / 2, share,
      count: Math.round(share / TOTAL_SHARE * WORKED_ANSWER) };
    acc += w + GAP;
    return t;
  });

  // structural paths
  const queryDrop = `M ${Q.x + Q.w / 2} ${Q.y + Q.h} L ${Q.x + Q.w / 2} ${BAR.y}`;
  const fanPath = (t: Tile) => `M ${FAN0.x} ${FAN0.y} C ${FAN0.x} ${FAN0.y + 56}, ${t.cx} ${TILE_Y - 56}, ${t.cx} ${TILE_Y}`;
  const answerRise = `M ${BAR.x + BAR.w * 0.66} ${BAR.y} C ${BAR.x + BAR.w * 0.7} ${BAR.y - 32}, ${A.x + A.w / 2} ${A.y + A.h + 28}, ${A.x + A.w / 2} ${A.y + A.h}`;

  // pooled: raw records stream up from every tile into one central store
  const STORE = { x: 388, y: 12, w: 224, h: 96 };
  const poolRise = (t: Tile) => `M ${t.cx} ${TILE_Y} C ${t.cx} ${TILE_Y - 80}, ${STORE.x + STORE.w / 2} ${STORE.y + STORE.h + 60}, ${STORE.x + STORE.w / 2} ${STORE.y + STORE.h}`;

  // the five trust primitives, laid out as chips inside the bar
  const PRIMS = ['DIRECTORY', 'CONSENT', 'RULES', 'IDENTITY', 'LEDGER'];
  const CHIP_W = 96, CHIP_GAP = 8;
  const CHIP_BLOCK = PRIMS.length * CHIP_W + (PRIMS.length - 1) * CHIP_GAP;
  const chipX = (i: number) => BAR.x + BAR.w / 2 - CHIP_BLOCK / 2 + i * (CHIP_W + CHIP_GAP);
</script>

<div class="qt">
  <div class="qt-head">
    <div class="qcard">
      <span class="q-eyebrow">Ask one question</span>
      <p class="q-text">{WORKED_QUESTION}</p>
      <div class="q-actions">
        <button class="ask" onclick={ask} disabled={pooled}>▶ Ask it</button>
        <button class="pool-toggle" class:on={pooled} onclick={togglePool}>
          {pooled ? '↩ back to federated' : '…what if we pooled it instead?'}
        </button>
      </div>
    </div>
    <div class="counters">
      <div class="ct" class:hot={pooled && shownMoved > 0}>
        <b>{shownMoved.toLocaleString('en-GB')}</b>
        <span>pupil records moved</span>
      </div>
      <div class="ct" class:hot={pooled}>
        <b class="blast">{pooled ? BLAST_CENTRAL : BLAST_FEDERATED}</b>
        <span>blast radius if breached</span>
      </div>
    </div>
  </div>

  <div class="stage-scroll">
    <svg viewBox="0 0 {W} {H}" role="img" class:pooled class:answered={phase === 'answered'}
      aria-label="One question travels from the question node into the DfE trust layer, fans out to the connectors weighted by market share, and only aggregate totals return to the answer — versus the central-store counterfactual.">

      <!-- ============ STRUCTURE (always drawn, faint) ============ -->
      <!-- connector fan -->
      {#each TILES as t (t.id)}
        <path d={fanPath(t)} class="skel" />
      {/each}
      {#if !pooled}
        <path d={queryDrop} class="skel" />
        <path d={answerRise} class="skel a" class:live={phase === 'answered'} />
      {/if}

      <!-- ============ THE TRUST BAR ============ -->
      <g class="trust" class:dim={pooled}>
        <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx="12" class="bar" />
        <rect x={BAR.x + 4} y={BAR.y + 4} width={BAR.w - 8} height={BAR.h - 8} rx="9" class="bar-inner" />
        <!-- left tag -->
        <text x={BAR.x + 22} y={BAR.y + 26} class="bar-tag">DfE TRUST LAYER</text>
        <text x={BAR.x + 22} y={BAR.y + 42} class="bar-tag sub">the thin centre</text>
        <!-- primitive chips -->
        {#each PRIMS as p, i}
          <rect x={chipX(i)} y={BAR.y + 15} width={CHIP_W} height={BAR.h - 30} rx="6" class="prim" />
          <text x={chipX(i) + CHIP_W / 2} y={BAR.y + BAR.h / 2 + 3.5} text-anchor="middle" class="prim-lab">{p}</text>
        {/each}
        <!-- right badge: 0 records -->
        <g transform="translate({BAR.x + BAR.w - 118}, {BAR.y + BAR.h / 2 - 15})">
          <rect x="0" y="0" width="98" height="30" rx="15" class="zero-badge" />
          <text x="49" y="13" text-anchor="middle" class="zero-n">0</text>
          <text x="49" y="24" text-anchor="middle" class="zero-lab">RECORDS HELD</text>
        </g>
      </g>

      <!-- ============ QUESTION NODE ============ -->
      {#if !pooled}
        <g class="qnode" class:run={phase !== 'idle'}>
          <rect x={Q.x} y={Q.y} width={Q.w} height={Q.h} rx="12" class="qn-box" />
          <text x={Q.x + Q.w / 2} y={Q.y + 26} text-anchor="middle" class="qn-eyebrow">ONE QUESTION</text>
          <text x={Q.x + Q.w / 2} y={Q.y + 47} text-anchor="middle" class="qn-line">Year-11 · EHCP</text>
          <text x={Q.x + Q.w / 2} y={Q.y + 62} text-anchor="middle" class="qn-line">persistently absent?</text>
        </g>

        <!-- ============ ANSWER NODE ============ -->
        <g class="anode" class:show={phase === 'answered' || shownAnswer > 0}>
          <rect x={A.x} y={A.y} width={A.w} height={A.h} rx="12" class="an-box" />
          <text x={A.x + A.w / 2} y={A.y + 24} text-anchor="middle" class="an-eyebrow">THE ANSWER · NO PII</text>
          <text x={A.x + A.w / 2} y={A.y + 52} text-anchor="middle" class="an-n">{(phase === 'idle' ? 0 : shownAnswer).toLocaleString('en-GB')}</text>
          <text x={A.x + A.w / 2} y={A.y + 66} text-anchor="middle" class="an-lab">{WORKED_ANSWER_LABEL} · aggregate total</text>
        </g>
        <!-- idle placeholder for the answer, keeps the top balanced -->
        {#if phase === 'idle' && shownAnswer === 0}
          <g class="anode ghost">
            <rect x={A.x} y={A.y} width={A.w} height={A.h} rx="12" class="an-box ghost" />
            <text x={A.x + A.w / 2} y={A.y + 24} text-anchor="middle" class="an-eyebrow">THE ANSWER · NO PII</text>
            <text x={A.x + A.w / 2} y={A.y + 50} text-anchor="middle" class="an-ghost">— press <tspan class="em">Ask it</tspan></text>
          </g>
        {/if}
      {/if}

      <!-- ============ CONNECTOR TILES ============ -->
      <text x={ROW_X} y={TILE_Y - 12} class="row-lab">~24,000 SCHOOLS &amp; COLLEGES · WEIGHTED BY MIS MARKET SHARE · RECORDS STAY PUT</text>
      {#each TILES as t (t.id)}
        {@const narrow = t.w < 104}
        <g class="tile" class:lit={tilesLit && !pooled} class:hot={pooled}>
          <rect x={t.x} y={TILE_Y} width={t.w} height={TILE_H} rx="9" class="tbox" />
          <text x={t.cx} y={TILE_Y + 26} text-anchor="middle" class="t-lab" class:narrow>{narrow ? t.short : t.label}</text>
          <text x={t.cx} y={TILE_Y + 43} text-anchor="middle" class="t-share">{t.share}% share</text>
          <!-- padlock: stays shut when federated, springs open when pooled -->
          <g class="lock" class:open={pooled} transform="translate({t.cx - 8}, {TILE_Y + 56})">
            <rect x="0" y="8" width="16" height="12" rx="2.5" class="lock-body" />
            <path class="lock-shackle" d={pooled
              ? 'M 3 8 V 5 A 4.5 4.5 0 0 1 11.5 4'
              : 'M 3 8 V 5 A 4.5 4.5 0 0 1 12 5 V 8'} />
          </g>
          {#if tilesLit && !pooled}
            <text x={t.cx} y={TILE_Y + TILE_H - 9} text-anchor="middle" class="t-count">+{t.count.toLocaleString('en-GB')}</text>
          {/if}
        </g>
      {/each}

      <!-- ============ MOVING DOTS (run phase only → never freeze) ============ -->
      {#key runKey}
        {#if phase === 'run' && !pooled}
          <g class="flow">
            <!-- query drops from the question node into the bar -->
            <circle r="6.5" class="dot q"><animateMotion dur="0.8s" begin="0s" fill="freeze" path={queryDrop} /></circle>
            {#each TILES as t, i (t.id)}
              <!-- query fans down to each connector -->
              <circle r="5.5" class="dot q"><animateMotion dur="0.75s" begin="{(0.75 + i * 0.06).toFixed(2)}s" fill="freeze" path={fanPath(t)} /></circle>
              <!-- the aggregate total returns UP the same channel -->
              <circle r="5.5" class="dot a"><animateMotion dur="0.85s" begin="{(2.3 + i * 0.06).toFixed(2)}s" fill="freeze" path="{fanPath(t)}" keyPoints="1;0" keyTimes="0;1" calcMode="linear" /></circle>
            {/each}
            <!-- one consolidated total rises to the answer -->
            <circle r="6.5" class="dot a"><animateMotion dur="0.9s" begin="3.2s" fill="freeze" path={answerRise} keyPoints="0;1" keyTimes="0;1" calcMode="linear" /></circle>
          </g>
        {:else if pooled}
          <!-- POOLED counterfactual: raw records stream up into one central store -->
          <g class="pool">
            <rect x={STORE.x} y={STORE.y} width={STORE.w} height={STORE.h} rx="11" class="store" />
            <rect x={STORE.x + 4} y={STORE.y + STORE.h - 4 - (STORE.h - 8) * poolFill} width={STORE.w - 8} height={(STORE.h - 8) * poolFill} rx="7" class="store-fill" />
            <text x={STORE.x + STORE.w / 2} y={STORE.y + 22} text-anchor="middle" class="store-lab">ONE NATIONAL STORE</text>
            <text x={STORE.x + STORE.w / 2} y={STORE.y + 58} text-anchor="middle" class="store-n">{(POOL_RECORDS / 1e6).toFixed(1)}M</text>
            <text x={STORE.x + STORE.w / 2} y={STORE.y + 78} text-anchor="middle" class="store-sub">every pupil record, copied in</text>
            {#each TILES as t, i (t.id)}
              <path d={poolRise(t)} class="skel r" />
              <circle r="5" class="dot r"><animateMotion dur="1s" begin="{(i * 0.08).toFixed(2)}s" repeatCount="indefinite" path={poolRise(t)} /></circle>
            {/each}
          </g>
        {/if}
      {/key}
    </svg>
  </div>

  <p class="caption" class:warn={pooled}>
    {#if pooled}
      <b>The counterfactual.</b> Pool it into one national store and the same question means copying
      <b>{BLAST_CENTRAL}</b> of pupil records into a single place — the honeypot England built once, as ContactPoint, and switched off.
      Everything that could ever leak now sits in one breach.
    {:else if eli}
      Press <b>Ask it</b>. The question travels down into the small trust layer (which keeps <b>no</b> records), out to every
      school's own system, and only the <b>totals</b> come back. The padlocks never open. Nothing moved.
    {:else}
      Press <b>Ask it</b>: the question travels <b>into</b> the thin trust layer, fans <b>out</b> to every connector
      weighted by real market share, runs <b>in situ</b> behind shut padlocks, and only no-PII totals sum back to
      <b>{WORKED_ANSWER.toLocaleString('en-GB')}</b>. The question moved. The records didn't. <b>Centralise the trust, not the data.</b>
    {/if}
  </p>
</div>

<style>
  .qt { border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-round); background: var(--surface-elevated, #e8dece); overflow: hidden; }
  .qt-head { display: flex; gap: 16px; align-items: stretch; flex-wrap: wrap; padding: 18px 20px 8px; }
  .qcard { flex: 1 1 420px; min-width: 280px; background: #ffffff; border: 1.5px solid rgba(26,16,8,0.5); border-left: 4px solid var(--accent-ink, #0e5b66); border-radius: var(--radius-round); padding: 14px 18px; }
  .q-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent-ink, #0e5b66); }
  .q-text { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(17px, 2vw, 22px); line-height: 1.25; color: var(--ink); margin: 6px 0 12px; }
  .q-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .ask { font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; color: #fff; background: var(--accent-ink, #0e5b66); border: 1.5px solid var(--accent-ink, #0e5b66); border-radius: var(--radius-round); padding: 9px 18px; cursor: pointer; }
  .ask:hover:not(:disabled) { background: #094850; }
  .ask:disabled { opacity: 0.4; cursor: default; }
  .pool-toggle { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: #8a2d3a; background: transparent; border: 1.5px solid rgba(138,45,58,0.5); border-radius: var(--radius-round); padding: 9px 16px; cursor: pointer; }
  .pool-toggle:hover { border-color: #8a2d3a; }
  .pool-toggle.on { background: #8a2d3a; color: #fff; border-color: #8a2d3a; }

  .counters { display: flex; gap: 10px; flex: 0 0 auto; }
  .ct { background: #ffffff; border: 1.5px solid rgba(26,16,8,0.5); border-radius: var(--radius-round); padding: 10px 16px; text-align: center; min-width: 116px; align-self: center; }
  .ct b { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(20px, 2.4vw, 30px); line-height: 1.05; color: var(--ink); }
  .ct b.blast { font-size: clamp(15px, 1.7vw, 20px); }
  .ct span { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,16,8,0.62); }
  .ct.hot { border-color: #8a2d3a; }
  .ct.hot b { color: #8a2d3a; }

  .stage-scroll { overflow-x: auto; padding: 6px 10px 2px; }
  svg { display: block; min-width: 820px; width: 100%; height: auto; }

  /* skeleton lines — the always-on structure */
  .skel { fill: none; stroke: rgba(26,16,8,0.16); stroke-width: 1.6; }
  .skel.a { stroke: rgba(47,125,79,0.22); }
  .skel.a.live { stroke: rgba(47,125,79,0.5); stroke-dasharray: 4 4; }
  .skel.r { stroke: rgba(138,45,58,0.35); }

  /* trust bar */
  .trust { transition: opacity 0.4s; }
  .trust.dim { opacity: 0.32; }
  .bar { fill: var(--accent-ink, #0e5b66); stroke: #05343b; stroke-width: 1.5; }
  .bar-inner { fill: none; stroke: rgba(255,255,255,0.14); stroke-width: 1; }
  .bar-tag { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; fill: #eaf4f2; font-weight: 600; }
  .bar-tag.sub { font-size: 8px; letter-spacing: 0.14em; fill: #8fc3bd; font-weight: 400; }
  .prim { fill: rgba(255,255,255,0.07); stroke: rgba(255,255,255,0.2); stroke-width: 1; }
  .prim-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em; fill: #d7ece9; font-weight: 600; }
  .zero-badge { fill: #eef6f0; stroke: #2f7d4f; stroke-width: 1.4; }
  .zero-n { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; fill: #216b3f; }
  .zero-lab { font-family: 'JetBrains Mono', monospace; font-size: 6.5px; letter-spacing: 0.1em; fill: #2f7d4f; }

  /* question + answer nodes */
  .qn-box { fill: #ffffff; stroke: var(--accent-ink, #0e5b66); stroke-width: 2; }
  .qnode.run .qn-box { fill: #eaf3f4; }
  .qn-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.2em; fill: var(--accent-ink, #0e5b66); }
  .qn-line { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; fill: var(--ink); }

  .anode { opacity: 0; transition: opacity 0.5s; }
  .anode.show { opacity: 1; }
  .anode.ghost { opacity: 1; }
  .an-box { fill: #eef6f0; stroke: #2f7d4f; stroke-width: 2; }
  .an-box.ghost { fill: #ffffff; stroke: rgba(47,125,79,0.4); stroke-dasharray: 5 4; }
  .an-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.16em; fill: #2f7d4f; }
  .an-n { font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; fill: #1a4d2e; }
  .an-lab { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.08em; fill: #216b3f; }
  .an-ghost { font-family: 'DM Sans', sans-serif; font-size: 14px; fill: rgba(26,16,8,0.5); }
  .an-ghost .em { fill: var(--accent-ink, #0e5b66); font-weight: 600; }

  /* connector tiles */
  .tbox { fill: #ffffff; stroke: rgba(26,16,8,0.5); stroke-width: 1.5; transition: stroke 0.35s, fill 0.35s; }
  .tile.lit .tbox { stroke: #2f7d4f; stroke-width: 2.2; fill: #eef6f0; }
  .tile.hot .tbox { stroke: #8a2d3a; stroke-width: 2; fill: #f7e6e6; }
  .t-lab { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; fill: var(--ink); }
  .t-lab.narrow { font-size: 11px; }
  .t-share { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.04em; fill: rgba(26,16,8,0.6); }
  .t-count { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; fill: #216b3f; }
  .lock-body { fill: rgba(26,16,8,0.72); transition: fill 0.3s; }
  .lock-shackle { fill: none; stroke: rgba(26,16,8,0.72); stroke-width: 1.7; transition: stroke 0.3s; }
  .lock.open .lock-body { fill: #8a2d3a; }
  .lock.open .lock-shackle { stroke: #8a2d3a; }
  .row-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; fill: rgba(26,16,8,0.6); }

  /* moving dots */
  .dot { stroke: #ede4d4; stroke-width: 1.4; }
  .dot.q { fill: var(--accent-ink, #0e5b66); }
  .dot.a { fill: #2f7d4f; }
  .dot.r { fill: #8a2d3a; }

  /* pooled store */
  .store { fill: #8a2d3a; stroke: #5f1f28; stroke-width: 2; }
  .store-fill { fill: #6d232d; }
  .store-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; fill: #f6dede; font-weight: 600; }
  .store-n { font-family: 'Fraunces', serif; font-weight: 600; font-size: 26px; fill: #ffffff; }
  .store-sub { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.06em; fill: #edc9c9; }

  .caption { font-size: 14px; line-height: 1.55; color: rgba(26,16,8,0.82); margin: 4px 0 0; padding: 12px 20px 18px; }
  .caption b { color: var(--ink); }
  .caption.warn { color: #6d232d; background: rgba(138,45,58,0.06); }
  .caption.warn b { color: #8a2d3a; }

  @media (max-width: 700px) {
    .qt-head { padding: 12px 12px 4px; }
    .counters { width: 100%; }
    .ct { flex: 1; min-width: 0; }
  }
</style>
