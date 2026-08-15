<script lang="ts">
  // FlowsDiagram — Figure 3 rebuilt: the two core flows as user-stepped
  // walkthroughs. Each flow has its own stepper; the current step's traffic
  // animation replays every 5 s until the user advances (the same interaction
  // grammar as the federation sim and the blueprint above).
  import { onMount } from 'svelte';
  import { CORE_FLOWS, type CoreFlow } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  let idx = $state<Record<'a' | 'b', number>>({ a: 0, b: 0 });
  let replayKey = $state(0);
  let replayTimer: ReturnType<typeof setInterval> | undefined; // plain let — never $state

  onMount(() => {
    replayTimer = setInterval(() => { replayKey += 1; }, 5000);
    return () => clearInterval(replayTimer);
  });

  function next(f: CoreFlow) {
    if (idx[f.key] < f.steps.length - 1) idx[f.key] += 1;
  }
  function back(f: CoreFlow) {
    if (idx[f.key] > 0) idx[f.key] -= 1;
  }

  // node strip geometry: nodes evenly spaced on a 560-wide line
  const STRIP_W = 560;
  const nodeX = (f: CoreFlow, i: number) => 40 + (i * (STRIP_W - 80)) / (f.nodes.length - 1);
  function segPath(f: CoreFlow, step: number): string {
    const [a, b] = f.steps[step].lit;
    const x1 = nodeX(f, a);
    const x2 = nodeX(f, b);
    if (a === b) return `M ${x1 - 14} 40 A 14 14 0 1 1 ${x1 + 14} 40`; // self-loop arc
    return `M ${x1} 40 H ${x2}`;
  }
</script>

<div class="flows">
  {#each CORE_FLOWS as f (f.key)}
    {@const cur = idx[f.key]}
    {@const step = f.steps[cur]}
    <section class="flow" style="--fc:{f.color}">
      <header class="f-head">
        <span class="f-tag">{f.tag}</span>
        <h3>{f.name}</h3>
      </header>

      <!-- node strip: who is talking at this step -->
      <div class="strip-scroll">
        <svg viewBox="0 0 {STRIP_W} 78" role="img" aria-label="{f.name} — step {cur + 1} of {f.steps.length}: {step.title}">
          <line class="rail" x1="40" y1="40" x2={STRIP_W - 40} y2="40" />
          {#key `${cur}-${replayKey}`}
            <path class="seg" d={segPath(f, cur)} />
            <circle r="5" fill={f.color}>
              <animateMotion dur="1.7s" repeatCount="indefinite" path={segPath(f, cur)} />
            </circle>
          {/key}
          {#each f.nodes as n, i}
            {@const on = i >= step.lit[0] && i <= step.lit[1]}
            <circle class="n-dot" class:on cx={nodeX(f, i)} cy="40" r={on ? 8 : 6} />
            <text class="n-lab" class:on x={nodeX(f, i)} y={i % 2 === 0 ? 18 : 66} text-anchor="middle">{n}</text>
          {/each}
        </svg>
      </div>

      <!-- current step card -->
      <div class="step-card" style="animation-name: {replayKey % 2 ? 'step-pulse-a' : 'step-pulse-b'}">
        <span class="s-no">{cur + 1}</span>
        <div class="s-body">
          <b>{step.title}</b>
          <p>{step.desc}</p>
        </div>
      </div>

      <!-- progress dots + transport -->
      <div class="f-nav">
        <div class="dots">
          {#each f.steps as s, i}
            <button class="pd" class:on={i === cur} class:done={i < cur} aria-label="Go to step {i + 1}: {s.title}"
                    onclick={() => (idx[f.key] = i)} title={s.title}></button>
          {/each}
        </div>
        <span class="f-step">{cur + 1}/{f.steps.length} · replays every 5 s</span>
        <div class="f-btns">
          <button class="nav-btn ghost" onclick={() => back(f)} disabled={cur === 0}>◂</button>
          <button class="nav-btn primary" onclick={() => next(f)} disabled={cur === f.steps.length - 1}>Next step ▸</button>
        </div>
      </div>

      <footer class="f-foot">{f.footer}</footer>
    </section>
  {/each}
</div>

{#if eli}
  <p class="eli-note">Two stories: the safe everyday one (left — only totals ever travel) and the rare emergency one
    (right — a named professional gets the minimum needed, and it is always written down).</p>
{/if}

<style>
  .flows { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .flow { border: 1.5px solid rgba(26,16,8,0.35); border-top: 4px solid var(--fc); border-radius: var(--radius-sharp); background: var(--surface-elevated, #e8dece); padding: 18px 20px 14px; min-width: 0; display: flex; flex-direction: column; }
  .f-head .f-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.2em; color: var(--fc); }
  .f-head h3 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(17px, 1.8vw, 22px); margin: 3px 0 10px; color: var(--ink); }

  .strip-scroll { overflow-x: auto; }
  svg { display: block; min-width: 420px; width: 100%; height: auto; }
  .rail { stroke: rgba(26,16,8,0.3); stroke-width: 2; }
  .seg { fill: none; stroke: var(--fc); stroke-width: 2.5; opacity: 0.6; }
  .n-dot { fill: #ffffff; stroke: rgba(26,16,8,0.55); stroke-width: 1.5; }
  .n-dot.on { stroke: var(--fc); stroke-width: 2.5; }
  .n-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em; fill: rgba(26,16,8,0.72); }
  .n-lab.on { fill: var(--ink); font-weight: 600; }

  .step-card { display: flex; gap: 12px; align-items: flex-start; border: 1.5px solid var(--fc); border-radius: var(--radius-sharp); background: #ffffff; padding: 12px 14px; margin: 10px 0 12px; min-height: 92px;
    animation-duration: 0.9s; animation-timing-function: ease-out; }
  .s-no { flex: 0 0 26px; width: 26px; height: 26px; display: grid; place-content: center; background: var(--fc); color: #fff; border-radius: var(--radius-pill); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .s-body b { font-family: var(--fs-serif); font-size: var(--fs-body); color: var(--ink); }
  .s-body p { font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.76); margin: 4px 0 0; }

  .f-nav { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: auto; }
  .dots { display: inline-flex; gap: 5px; }
  .pd { width: 11px; height: 11px; border-radius: var(--radius-pill); border: 1.5px solid rgba(26,16,8,0.5); background: transparent; cursor: pointer; padding: 0; }
  .pd.done { background: rgba(28,22,17,0.3); border-color: transparent; }
  .pd.on { background: var(--fc); border-color: var(--fc); }
  .f-step { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; color: rgba(26,16,8,0.6); }
  .f-btns { margin-left: auto; display: inline-flex; gap: 6px; }
  .nav-btn { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; border-radius: var(--radius-sharp); padding: 7px 13px; cursor: pointer; }
  .nav-btn.primary { background: var(--ink); color: var(--paper, #f1ead6); border: 1.5px solid var(--ink); }
  .nav-btn.primary:hover:not(:disabled) { background: #000; }
  .nav-btn.ghost { background: transparent; color: var(--ink); border: 1.5px solid rgba(28,22,17,0.35); }
  .nav-btn.ghost:hover:not(:disabled) { border-color: var(--ink); }
  .nav-btn:disabled { opacity: 0.35; cursor: default; }

  .f-foot { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,16,8,0.62); text-align: center; margin-top: 12px; border-top: 1px dashed rgba(26,16,8,0.28); padding-top: 8px; }

  .eli-note { font-size: var(--fs-label); font-style: italic; color: rgba(26,16,8,0.72); margin: 12px 2px 0; }

  /* -global-: the animation-name arrives via an inline style, which Svelte's scoper does not rewrite */
  @keyframes -global-step-pulse-a { 0% { background: #fbf7ee; } 100% { background: #ffffff; } }
  @keyframes -global-step-pulse-b { 0% { background: #fbf7ee; } 100% { background: #ffffff; } }

  @media (max-width: 900px) {
    .flows { grid-template-columns: 1fr; }
  }
</style>
