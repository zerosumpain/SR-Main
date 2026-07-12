<script lang="ts">
  // QuestionTravel — the hero "whole idea in one picture". Ask one real question;
  // watch it travel INTO the thin DfE trust bar (which holds 0 records), fan OUT
  // to the connectors weighted by real MIS market share (all staying locked), and
  // only aggregate totals sum back to the answer. A "…pool it instead?" toggle
  // morphs to the central-store counterfactual so the blast-radius cost is visceral.
  // All timer/rAF handles are plain `let` (never $state) — see svelte5-pitfalls.
  import { onMount } from 'svelte';
  import { FABRIC_NODES, WORKED_QUESTION, WORKED_QUESTION_SHORT, WORKED_ANSWER, WORKED_ANSWER_LABEL,
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
    timers.push(setTimeout(() => { tilesLit = true; }, 1500));
    timers.push(setTimeout(() => { countHandle = tween(0, WORKED_ANSWER, 1100, (v) => (shownAnswer = v)); }, 2500));
    timers.push(setTimeout(() => { phase = 'answered'; }, 3700));
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

  // --- geometry ---
  const W = 1000, TILE_Y = 384, TILE_H = 96, ROW_X = 120, ROW_W = 760, GAP = 8;
  const BAR = { x: 190, y: 168, w: 620, h: 46 };
  const QSRC = { x: 500, y: 92 };
  // tiles: width ∝ share
  interface Tile { id: string; label: string; short: string; x: number; w: number; cx: number; share: number; count: number }
  const usable = ROW_W - GAP * (ESTATES.length - 1);
  let acc = ROW_X;
  const TILES: Tile[] = ESTATES.map((n) => {
    const w = Math.max(58, (n.share ?? 0) / TOTAL_SHARE * usable);
    const t: Tile = { id: n.id, label: n.label, short: n.label.split(' ')[0], x: acc, w, cx: acc + w / 2, share: n.share ?? 0,
      count: Math.round((n.share ?? 0) / TOTAL_SHARE * WORKED_ANSWER) };
    acc += w + GAP;
    return t;
  });
  const queryDown = `M ${QSRC.x} ${QSRC.y} V ${BAR.y}`;
  const fanPath = (t: Tile) => `M ${BAR.x + BAR.w / 2} ${BAR.y + BAR.h} C ${BAR.x + BAR.w / 2} ${BAR.y + 110}, ${t.cx} ${TILE_Y - 70}, ${t.cx} ${TILE_Y}`;
  const returnPath = (t: Tile) => `M ${t.cx} ${TILE_Y} C ${t.cx} ${TILE_Y - 90}, 700 ${BAR.y + 120}, 720 118`;
  const STORE = { x: 445, y: 250, w: 110, h: 120 };
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
    <svg viewBox="0 0 {W} 500" role="img" class:pooled aria-label="One question travels into the DfE trust layer, fans out to the connectors weighted by market share, and only aggregate totals return — versus the central-store counterfactual.">
      <!-- the thin trust bar -->
      <g class="trust">
        <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx="10" class="bar" />
        <text x={BAR.x + BAR.w / 2} y={BAR.y + 19} text-anchor="middle" class="bar-lab">DfE TRUST LAYER · DIRECTORY · CONSENT · RULES · IDENTITY · LEDGER</text>
        <text x={BAR.x + BAR.w / 2} y={BAR.y + 35} text-anchor="middle" class="bar-sub">0 pupil records held here</text>
      </g>

      <!-- connector tiles (share-weighted, always locked) -->
      {#each TILES as t (t.id)}
        <g class="tile" class:lit={tilesLit && !pooled}>
          <rect x={t.x} y={TILE_Y} width={t.w} height={TILE_H} rx="8" class="tbox" />
          <text x={t.cx} y={TILE_Y + 22} text-anchor="middle" class="t-lab" class:narrow={t.w < 100}>{t.w < 100 ? t.short : t.label}</text>
          <text x={t.cx} y={TILE_Y + 37} text-anchor="middle" class="t-share">{t.share}%</text>
          <!-- padlock: stays shut -->
          <g class="lock" transform="translate({t.cx - 7}, {TILE_Y + 50})">
            <rect x="0" y="7" width="14" height="11" rx="2" class="lock-body" />
            <path d="M 3 7 V 4.5 A 4 4 0 0 1 11 4.5 V 7" class="lock-shackle" />
          </g>
          {#if tilesLit && !pooled && t.w > 60}
            <text x={t.cx} y={TILE_Y + TILE_H - 6} text-anchor="middle" class="t-count">+{t.count.toLocaleString('en-GB')}</text>
          {/if}
        </g>
      {/each}
      <text x={ROW_X} y={TILE_Y - 12} class="row-lab">~24,000 SCHOOLS &amp; COLLEGES · WEIGHTED BY MIS MARKET SHARE · RECORDS STAY PUT</text>

      {#key runKey}
        {#if !pooled}
          <!-- FEDERATED: query in, fan out, totals return -->
          <g class="flow">
            <path d={queryDown} class="line q" />
            <circle r="6" class="dot q"><animateMotion dur="0.8s" begin="0s" fill="freeze" path={queryDown} /></circle>
            {#each TILES as t, i (t.id)}
              <path d={fanPath(t)} class="line q" />
              <circle r="5" class="dot q"><animateMotion dur="0.7s" begin="{(0.8 + i * 0.06).toFixed(2)}s" fill="freeze" path={fanPath(t)} /></circle>
              <path d={returnPath(t)} class="line a" />
              <circle r="5.5" class="dot a"><animateMotion dur="0.85s" begin="{(2.2 + i * 0.06).toFixed(2)}s" fill="freeze" path={returnPath(t)} /></circle>
            {/each}
          </g>
        {:else}
          <!-- POOLED counterfactual: raw records stream up into one central store -->
          <g class="pool">
            <rect x={STORE.x} y={STORE.y} width={STORE.w} height={STORE.h} rx="8" class="store" />
            <rect x={STORE.x + 3} y={STORE.y + STORE.h - 3 - (STORE.h - 6) * poolFill} width={STORE.w - 6} height={(STORE.h - 6) * poolFill} rx="5" class="store-fill" />
            <text x={STORE.x + STORE.w / 2} y={STORE.y - 10} text-anchor="middle" class="store-lab">ONE NATIONAL STORE</text>
            <text x={STORE.x + STORE.w / 2} y={STORE.y + STORE.h / 2} text-anchor="middle" class="store-n">{(POOL_RECORDS / 1e6).toFixed(1)}M</text>
            {#each TILES as t, i (t.id)}
              {@const up = `M ${t.cx} ${TILE_Y} C ${t.cx} ${TILE_Y - 80}, ${STORE.x + STORE.w / 2} ${STORE.y + STORE.h + 40}, ${STORE.x + STORE.w / 2} ${STORE.y + STORE.h}`}
              <path d={up} class="line r" />
              <circle r="5" class="dot r"><animateMotion dur="0.9s" begin="{(i * 0.08).toFixed(2)}s" repeatCount="3" path={up} /></circle>
            {/each}
          </g>
        {/if}
      {/key}

      <!-- the answer -->
      {#if !pooled}
        <g class="answer" class:show={phase === 'answered' || shownAnswer > 0}>
          <rect x="600" y="70" width="240" height="66" rx="10" class="ans-box" />
          <text x="720" y="104" text-anchor="middle" class="ans-n">{shownAnswer.toLocaleString('en-GB')}</text>
          <text x="720" y="122" text-anchor="middle" class="ans-lab">{WORKED_ANSWER_LABEL} · no-PII total</text>
        </g>
      {/if}
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
  .qt-head { display: flex; gap: 16px; align-items: stretch; flex-wrap: wrap; padding: 18px 20px 6px; }
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

  .stage-scroll { overflow-x: auto; padding: 4px 6px 0; }
  svg { display: block; min-width: 760px; width: 100%; height: auto; }

  .bar { fill: var(--accent-ink, #0e5b66); stroke: #083d45; stroke-width: 1.5; }
  .bar-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; fill: #eaf4f2; font-weight: 600; }
  .bar-sub { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.14em; fill: #bfe0dc; }

  .tbox { fill: #ffffff; stroke: rgba(26,16,8,0.55); stroke-width: 1.4; transition: stroke 0.3s, fill 0.3s; }
  .tile.lit .tbox { stroke: #2f7d4f; stroke-width: 2; fill: #eef6f0; }
  .t-lab { font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 600; fill: var(--ink); }
  .t-lab.narrow { font-size: 9px; }
  .t-share { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; fill: rgba(26,16,8,0.62); }
  .t-count { font-family: 'Fraunces', serif; font-weight: 600; font-size: 12px; fill: #216b3f; }
  .lock-body { fill: rgba(26,16,8,0.72); }
  .lock-shackle { fill: none; stroke: rgba(26,16,8,0.72); stroke-width: 1.6; }
  .row-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; fill: rgba(26,16,8,0.62); }

  .line { fill: none; stroke-width: 1.8; opacity: 0.5; }
  .line.q { stroke: var(--accent-ink, #0e5b66); stroke-dasharray: 3 4; }
  .line.a { stroke: #2f7d4f; stroke-dasharray: 3 4; }
  .line.r { stroke: #8a2d3a; }
  .dot { stroke: #ede4d4; stroke-width: 1.2; }
  .dot.q { fill: var(--accent-ink, #0e5b66); }
  .dot.a { fill: #2f7d4f; }
  .dot.r { fill: #8a2d3a; }

  .store { fill: #f4e2e2; stroke: #8a2d3a; stroke-width: 2; }
  .store-fill { fill: #8a2d3a; }
  .store-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; fill: #8a2d3a; font-weight: 600; }
  .store-n { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; fill: #fff; }

  .answer { opacity: 0; transition: opacity 0.4s; }
  .answer.show { opacity: 1; }
  .ans-box { fill: #eef6f0; stroke: #2f7d4f; stroke-width: 2; }
  .ans-n { font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; fill: #1a4d2e; }
  .ans-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.08em; fill: #216b3f; }

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
