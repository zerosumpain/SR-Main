<script lang="ts">
  // FabricDiagram — Figure 1 of the paper rebuilt as an interactive SVG.
  // The model layers up stage by stage (user presses Next; the current stage's
  // entrance animation replays every 5 s — the same interaction grammar as the
  // federation sim). Every component is clickable → inspector card. After the
  // final stage the diagram enters explore mode with per-flow toggles.
  import { onMount } from 'svelte';
  import { FABRIC_NODES, FABRIC_STAGES, FLOW_META, type FabricNode, type FlowKind } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  let stage = $state(0);
  let selected = $state<FabricNode | null>(null);
  // toggling between two identical keyframe names restarts the CSS entrance
  // animation without recreating DOM; SMIL dot groups are re-keyed instead
  let replayKey = $state(0);
  let replayTimer: ReturnType<typeof setInterval> | undefined; // plain let — never $state

  const STAGE_COUNT = FABRIC_STAGES.length;
  const explore = $derived(stage >= STAGE_COUNT); // one past the last stage
  const cap = $derived(FABRIC_STAGES[Math.min(stage, STAGE_COUNT - 1)]);

  // flows switched on by the build-up; user-controlled in explore mode
  let userFlows = $state<Record<FlowKind, boolean>>({ query: true, aggregate: true, pii: true, p2p: true, cross: true });
  const stageFlows = $derived<Record<FlowKind, boolean>>({
    query: stage >= 3, aggregate: stage >= 3, pii: stage >= 4, p2p: stage >= 4, cross: stage >= 5,
  });
  const flows = $derived(explore ? userFlows : stageFlows);

  function next() {
    if (stage < STAGE_COUNT) stage += 1;
    selected = null;
  }
  function back() {
    if (stage > 0) stage -= 1;
    selected = null;
  }
  function pick(n: FabricNode) {
    selected = selected?.id === n.id ? null : n;
  }
  function onKey(e: KeyboardEvent, n: FabricNode) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(n); }
  }

  onMount(() => {
    // drive stage-entrance replays only during the build-up. Once in explore mode the
    // traffic dots loop on their own (SMIL repeatCount), so bumping replayKey would just
    // re-key and snap every dot back to its origin every 5s — a visible stutter, no benefit.
    replayTimer = setInterval(() => { if (stage < STAGE_COUNT) replayKey += 1; }, 5000);
    return () => clearInterval(replayTimer);
  });

  // ---- layout ----------------------------------------------------------
  interface Box { x: number; y: number; w: number; h: number }
  const L = new Map<string, Box>();
  const consumers = FABRIC_NODES.filter((n) => n.band === 'consumers');
  const brokerage = FABRIC_NODES.filter((n) => n.band === 'brokerage');
  const mis = FABRIC_NODES.filter((n) => n.band === 'edge-mis');
  const las = FABRIC_NODES.filter((n) => n.band === 'edge-la');
  const cross = FABRIC_NODES.filter((n) => n.band === 'cross');
  consumers.forEach((n, i) => L.set(n.id, { x: 60 + i * 222, y: 84, w: 202, h: 64 }));
  brokerage.forEach((n, i) => L.set(n.id, { x: 60 + i * 178, y: 346, w: 166, h: 96 }));
  mis.forEach((n, i) => L.set(n.id, { x: 60 + i * 148, y: 624, w: 138, h: 62 }));
  las.forEach((n, i) => L.set(n.id, { x: 60 + i * 270, y: 748, w: 250, h: 54 }));
  cross.forEach((n, i) => L.set(n.id, { x: 990, y: 370 + i * 86, w: 160, h: 56 }));
  const box = (id: string): Box => L.get(id)!;
  const cx = (b: Box) => b.x + b.w / 2;

  // split long labels onto two lines (SVG text has no wrapping)
  function wrap(label: string): string[] {
    if (label.length <= 17) return [label];
    const mid = Math.floor(label.length / 2);
    let best = -1;
    for (let i = 0; i < label.length; i++) if (label[i] === ' ' && Math.abs(i - mid) < Math.abs(best - mid)) best = i;
    return best < 0 ? [label] : [label.slice(0, best), label.slice(best + 1)];
  }

  // ---- flow geometry (stylised, matched to the bands) --------------------
  const queryDown = `M ${cx(box('con-dfe'))} 156 V 296`;
  const fanouts = mis.map((n) => `M 495 446 C 495 520, ${cx(box(n.id))} 540, ${cx(box(n.id))} 620`);
  const laFan = las.map((n) => `M 495 446 C 495 580, ${cx(box(n.id))} 640, ${cx(box(n.id))} 744`);
  const aggBacks = mis.map((n) => `M ${cx(box(n.id))} 620 C ${cx(box(n.id))} 540, 585 520, 585 446`);
  const aggUp = `M 585 296 V 156`;
  const piiFrom = `M ${cx(box('mis-bromcom'))} 620 C ${cx(box('mis-bromcom'))} 545, ${cx(box('brk-policy'))} 530, ${cx(box('brk-policy'))} 446`;
  const piiUp = `M ${cx(box('con-safeguard'))} 296 V 156`;
  const p2p = `M ${cx(box('mis-arbor'))} 688 C ${cx(box('mis-arbor'))} 745, ${cx(box('la-b')) - 60} 790, ${cx(box('la-b'))} 746`;
  const crossPaths = ['x-nhs', 'x-csc', 'x-dwp'].map((id) => {
    const b = box(id);
    return `M 952 396 C 972 396, 970 ${b.y + b.h / 2}, ${b.x - 4} ${b.y + b.h / 2}`;
  });

  const FLOW_PATHS: Record<FlowKind, { d: string; dur: number }[]> = {
    query: [{ d: queryDown, dur: 1.8 }, ...fanouts.map((d) => ({ d, dur: 2.2 })), ...laFan.map((d) => ({ d, dur: 2.6 }))],
    aggregate: [...aggBacks.map((d) => ({ d, dur: 2.4 })), { d: aggUp, dur: 1.8 }],
    pii: [{ d: piiFrom, dur: 2.6 }, { d: piiUp, dur: 2 }],
    p2p: [{ d: p2p, dur: 2.8 }],
    cross: crossPaths.map((d) => ({ d, dur: 2.4 })),
  };
  const FLOW_KEYS = Object.keys(FLOW_META) as FlowKind[];
</script>

<div class="fabric">
  <div class="diagram-scroll">
    <svg viewBox="0 0 1200 830" role="img" aria-label="High-level design of the national education data fabric: commissioning at the top, a thin DfE brokerage in the middle, data held at the edge, cross-domain federation to the side.">
      <!-- band frames -->
      <g class="layer" class:on={stage >= 3} class:ghost={stage < 3}>
        <rect class="band" x="40" y="30" width="910" height="140" rx="10" />
        <text class="band-lab" x="60" y="58">COMMISSIONING &amp; CONSUMERS</text>
      </g>
      <g class="layer" class:on={stage >= 2} class:ghost={stage < 2}>
        <rect class="band strong" x="40" y="300" width="910" height="170" rx="10" />
        <text class="band-lab strong-lab" x="60" y="328">NATIONAL TRUST &amp; BROKERAGE LAYER — DfE-run · brokers only · holds no pupil-level data</text>
      </g>
      <g class="layer on">
        <rect class="band" x="40" y="560" width="910" height="250" rx="10" />
        <text class="band-lab" x="60" y="588">EDGE — DATA HELD AT SOURCE · never leaves except under an approved rule</text>
        <text class="band-sub" x="60" y="610">MIS providers → ~24,000 schools &amp; trusts</text>
        <text class="band-sub" x="60" y="736">Local authorities — children’s services · admissions · attendance · SEND</text>
      </g>
      <g class="layer" class:on={stage >= 5} class:ghost={stage < 5}>
        <rect class="band dashed" x="975" y="300" width="185" height="510" rx="10" />
        <text class="band-lab" x="1067" y="328" text-anchor="middle">BEYOND EDUCATION</text>
        <text class="band-sub" x="1067" y="346" text-anchor="middle">cross-domain trust federation</text>
      </g>

      <!-- flow traffic (dots re-keyed so SMIL restarts with the stage replays) -->
      {#key `${stage}-${replayKey}`}
        <g class="traffic">
          {#each FLOW_KEYS as k}
            {#if flows[k]}
              {#each FLOW_PATHS[k] as p, i}
                <path class="flow-line" d={p.d} style="stroke:{FLOW_META[k].color}" />
                <circle r="4.5" fill={FLOW_META[k].color}>
                  <animateMotion dur="{p.dur}s" begin="{(i * 0.35).toFixed(2)}s" repeatCount="indefinite" path={p.d} />
                </circle>
              {/each}
            {/if}
          {/each}
        </g>
      {/key}

      <!-- nodes -->
      {#each FABRIC_NODES as n, i (n.id)}
        {@const b = box(n.id)}
        <g
          class="node"
          class:on={n.stage <= stage}
          class:current={n.stage === Math.min(stage, STAGE_COUNT - 1) && !explore}
          class:hot={n.hot}
          class:sel={selected?.id === n.id}
          style="--i:{i % 7}; animation-name: {replayKey % 2 ? 'rise-a' : 'rise-b'}"
          role="button"
          tabindex={n.stage <= stage ? 0 : -1}
          aria-label="{n.label} — details"
          onclick={() => pick(n)}
          onkeydown={(e) => onKey(e, n)}
        >
          <rect class="nbox" x={b.x} y={b.y} width={b.w} height={b.h} rx="8" />
          {#if wrap(n.label).length === 2}
            <text class="nlab" x={cx(b)} y={b.y + (n.sub ? 22 : 28)} text-anchor="middle">{wrap(n.label)[0]}</text>
            <text class="nlab" x={cx(b)} y={b.y + (n.sub ? 36 : 42)} text-anchor="middle">{wrap(n.label)[1]}</text>
          {:else}
            <text class="nlab" x={cx(b)} y={b.y + (n.sub ? 26 : b.h / 2 + 4)} text-anchor="middle">{n.label}</text>
          {/if}
          {#if n.sub}
            <text class="nsub" x={cx(b)} y={b.y + (wrap(n.label).length === 2 ? 52 : 44)} text-anchor="middle">{n.sub}</text>
          {/if}
          {#if (n.band === 'edge-mis' || n.band === 'edge-la') && stage >= 1}
            {#key stage === 1 ? replayKey : -1}
              <g class="conn-g" class:fresh={stage === 1}>
                <rect class="conn" x={cx(b) - 34} y={b.y + b.h - 5} width="68" height="7" rx="3.5" />
                <text class="conn-lab" x={cx(b)} y={b.y + b.h + 14} text-anchor="middle">connector</text>
              </g>
            {/key}
          {/if}
        </g>
      {/each}
    </svg>
  </div>

  <!-- caption / transport -->
  <div class="caption">
    <div class="cap-text">
      {#if explore}
        <span class="cap-kicker">EXPLORE THE FABRIC</span>
        <h3>The whole model, running</h3>
        <p>{eli
          ? 'Toggle the traffic on and off, and click any box to see what it does and which country it was borrowed from.'
          : 'All six stages assembled. Toggle each traffic type below, and click any component for what it does, the national deployment it is cherry-picked from, and the standards that implement it.'}</p>
        <div class="flow-chips">
          {#each FLOW_KEYS as k}
            <button class="chip" class:on={userFlows[k]} style="--c:{FLOW_META[k].color}" title={FLOW_META[k].desc} onclick={() => (userFlows[k] = !userFlows[k])}>
              <i></i>{FLOW_META[k].label}
            </button>
          {/each}
        </div>
      {:else}
        <span class="cap-kicker">{cap.kicker}</span>
        <h3>{cap.title}</h3>
        <p>{eli ? cap.eli5 : cap.narration}</p>
      {/if}
    </div>
    <div class="cap-nav">
      <span class="cap-step">{Math.min(stage + 1, STAGE_COUNT)}/{STAGE_COUNT}{#if !explore}&nbsp;· replays every 5 s{/if}</span>
      <div class="cap-btns">
        <button class="nav-btn ghost" onclick={back} disabled={stage === 0}>◂ Back</button>
        {#if !explore}
          <button class="nav-btn primary" onclick={next}>{stage === STAGE_COUNT - 1 ? 'Explore ▸' : 'Next stage ▸'}</button>
        {:else}
          <button class="nav-btn ghost" onclick={() => { stage = 0; selected = null; }}>⟲ Rebuild it</button>
        {/if}
      </div>
    </div>
  </div>

  {#if selected}
    <aside class="inspector">
      <button class="close" onclick={() => (selected = null)} aria-label="Close">✕</button>
      <span class="ins-kicker">{selected.band === 'brokerage' ? 'national brokerage · DfE-run' : selected.band === 'consumers' ? 'commissioning & consumers' : selected.band === 'cross' ? 'cross-domain member' : 'edge · data holder'}</span>
      <h4>{selected.label}{#if selected.sub}&nbsp;<em>· {selected.sub}</em>{/if}</h4>
      <p>{selected.desc}</p>
      {#if selected.exemplar}<p class="ins-row"><b>Cherry-picked from:</b> {selected.exemplar}</p>{/if}
      {#if selected.standards}<p class="ins-row"><b>Standards:</b> {selected.standards}</p>{/if}
    </aside>
  {/if}
</div>

<style>
  .fabric { border: 1.5px solid rgba(28,22,17,0.3); border-radius: var(--radius-round); background: rgba(255,255,255,0.35); overflow: hidden; }
  .diagram-scroll { overflow-x: auto; }
  svg { display: block; min-width: 860px; width: 100%; height: auto; }

  .band { fill: rgba(255,255,255,0.4); stroke: rgba(28,22,17,0.22); stroke-width: 1; }
  .band.strong { stroke: rgba(28,22,17,0.75); stroke-width: 2; fill: var(--accent-ink-tint-06, rgba(14,91,102,0.06)); }
  .band.dashed { stroke-dasharray: 6 5; fill: rgba(255,255,255,0.25); }
  .band-lab { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.14em; fill: rgba(28,22,17,0.62); font-weight: 600; }
  .band-lab.strong-lab { fill: var(--accent-ink); }
  .band-sub { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.08em; fill: rgba(28,22,17,0.45); }

  .layer { opacity: 0; transition: opacity 0.5s ease; pointer-events: none; }
  .layer.on { opacity: 1; }
  /* bands not yet introduced stay as faint blueprint ghosts, so the empty canvas
     reads as a plan being filled in rather than a broken render */
  .layer.ghost { opacity: 0.16; }

  .node { opacity: 0; cursor: pointer; pointer-events: none; }
  .node.on { opacity: 1; pointer-events: auto; }
  /* the stage being introduced replays its entrance (name toggles a/b to restart);
     keyframes are -global- because the name is assigned via an inline style, which
     Svelte's scoper does not rewrite */
  .node.on.current { animation-duration: 0.7s; animation-fill-mode: both; animation-timing-function: ease-out; animation-delay: calc(var(--i) * 110ms); }
  @keyframes -global-rise-a { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes -global-rise-b { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .node:focus-visible .nbox { stroke: var(--accent-ink); stroke-width: 2.5; }

  .nbox { fill: rgba(255,255,255,0.72); stroke: rgba(28,22,17,0.35); stroke-width: 1.2; transition: stroke 0.12s, fill 0.12s; }
  .node:hover .nbox { stroke: rgba(28,22,17,0.8); }
  .node.sel .nbox { stroke: var(--accent-ink); stroke-width: 2.5; fill: var(--accent-ink-tint-06, rgba(14,91,102,0.08)); }
  .node.hot .nbox { stroke: rgba(196,87,10,0.65); fill: rgba(196,87,10,0.07); }
  .node.hot.sel .nbox { stroke: var(--accent, #c4570a); }
  .nlab { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; fill: var(--ink); }
  .nsub { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.05em; fill: rgba(28,22,17,0.52); }
  .conn { fill: #2f7d4f; opacity: 0.85; }
  .conn-lab { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.14em; fill: rgba(47,125,79,0.9); text-transform: uppercase; }
  .conn-g.fresh { animation: conn-in 0.7s ease-out both; }
  @keyframes conn-in { from { opacity: 0; } to { opacity: 1; } }

  .flow-line { fill: none; stroke-width: 1.4; opacity: 0.3; stroke-dasharray: 3 4; }
  .traffic { pointer-events: none; }

  .caption { display: flex; gap: 18px; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; padding: 16px 20px 18px; border-top: 1px solid rgba(28,22,17,0.18); background: rgba(241,234,214,0.75); }
  .cap-text { max-width: 72ch; min-width: 260px; flex: 1 1 380px; }
  .cap-kicker { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.2em; color: var(--accent-ink); }
  .caption h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(18px, 2vw, 24px); margin: 4px 0 6px; color: var(--ink); }
  .caption p { font-size: 13.5px; line-height: 1.55; color: rgba(28,22,17,0.76); margin: 0; }
  .cap-nav { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .cap-step { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); white-space: nowrap; }
  .cap-btns { display: flex; gap: 8px; }
  .nav-btn { font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 600; border-radius: var(--radius-round); padding: 9px 18px; cursor: pointer; }
  .nav-btn.primary { background: var(--ink); color: var(--paper, #f1ead6); border: 1.5px solid var(--ink); }
  .nav-btn.primary:hover { background: #000; }
  .nav-btn.ghost { background: transparent; color: var(--ink); border: 1.5px solid rgba(28,22,17,0.35); }
  .nav-btn.ghost:hover:not(:disabled) { border-color: var(--ink); }
  .nav-btn:disabled { opacity: 0.35; cursor: default; }

  .flow-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.05em; color: var(--ink); background: rgba(255,255,255,0.55); border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; opacity: 0.55; }
  .chip.on { opacity: 1; border-color: var(--c); }
  .chip i { width: 9px; height: 9px; border-radius: var(--radius-pill); background: var(--c); display: inline-block; }

  .inspector { position: relative; margin: 0 20px 18px; border: 1.5px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: rgba(255,255,255,0.6); padding: 14px 18px; }
  .inspector .close { position: absolute; top: 8px; right: 12px; background: none; border: none; color: rgba(28,22,17,0.5); cursor: pointer; font-size: 13px; }
  .inspector .close:hover { color: var(--ink); }
  .ins-kicker { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent-ink); }
  .inspector h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; margin: 3px 0 6px; color: var(--ink); }
  .inspector h4 em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.5); }
  .inspector p { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.78); margin: 0 0 6px; }
  .inspector .ins-row { font-size: 12px; color: rgba(28,22,17,0.66); margin: 2px 0 0; }
  .inspector .ins-row b { color: var(--ink); font-weight: 600; }

  @media (max-width: 700px) {
    .caption { padding: 12px 14px 14px; }
    .cap-nav { align-items: stretch; width: 100%; }
    .cap-btns { justify-content: stretch; }
    .nav-btn { flex: 1; }
    .inspector { margin: 0 14px 14px; }
  }
</style>
