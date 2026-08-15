<script lang="ts">
  // Contradiction — the reusable "two-camps" widget. Lays out a genuine disagreement in the
  // evidence as two columns, states what the engine assumes to proceed and what would resolve
  // it, and carries a confidence rating on the model's stance. Generalises the one executed
  // contradiction (London effect) into a component any study can drop in. Self-contained.
  import type { Contradiction } from '../lib/contradictions.ts';
  import ConfidenceBadge from './ConfidenceBadge.svelte';
  import { app } from '../lib/appState.svelte';

  interface Props { c: Contradiction; }
  let { c }: Props = $props();
  let open = $state(false);
</script>

<div class="cx">
  <button class="cx-head" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="cx-q">{c.question}</span>
    <span class="cx-meta">
      <ConfidenceBadge level={c.confidence} small note="Confidence in the engine’s current stance" />
      <span class="chev" class:open>▾</span>
    </span>
  </button>

  <div class="camps">
    <div class="camp a">
      <span class="camp-lab">{c.campA.label}</span>
      <p class="camp-claim">{c.campA.claim}</p>
      <span class="camp-who">{c.campA.who.join(' · ')}</span>
    </div>
    <div class="vs" aria-hidden="true">vs</div>
    <div class="camp b">
      <span class="camp-lab">{c.campB.label}</span>
      <p class="camp-claim">{c.campB.claim}</p>
      <span class="camp-who">{c.campB.who.join(' · ')}</span>
    </div>
  </div>

  {#if open}
    <div class="detail">
      <div class="ev-row">
        <div><span class="ev-lab">Evidence — {c.campA.label}</span><p>{c.campA.evidence}</p></div>
        <div><span class="ev-lab">Evidence — {c.campB.label}</span><p>{c.campB.evidence}</p></div>
      </div>
      <div class="model-row">
        <span class="m-lab">What the model assumes</span>
        <p>{c.engineAssumes}</p>
      </div>
      <div class="model-row resolve">
        <span class="m-lab">What would resolve it</span>
        <p>{c.whatWouldResolve}</p>
      </div>
      {#if c.levers?.length}
        <div class="jump">
          <span class="j-lab">Levers this bears on:</span>
          {#each c.levers as id}<button class="j-btn" onclick={() => app.focusLever(id)}>{id}</button>{/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cx { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid #b4455e; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); margin: 10px 0; overflow: hidden; }
  .cx-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: transparent; border: none; cursor: pointer; padding: 9px 12px; text-align: left; }
  .cx-q { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .cx-meta { display: inline-flex; align-items: center; gap: 7px; }
  .chev { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); transition: transform 0.15s; }
  .chev.open { transform: rotate(180deg); }
  .camps { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: stretch; padding: 0 12px 11px; }
  @media (max-width: 560px) { .camps { grid-template-columns: 1fr; } .vs { display: none; } }
  .camp { background: rgba(28,22,17,0.03); border-radius: var(--radius-sharp); padding: 8px 9px; border-top: 2px solid; }
  .camp.a { border-top-color: var(--accent-ink); }
  .camp.b { border-top-color: #b4632e; }
  .camp-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.65); }
  .camp-claim { margin: 4px 0 5px; font-size: var(--fs-label-xs); line-height: 1.45; color: var(--ink); }
  .camp-who { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .vs { align-self: center; font-family: var(--fs-serif); font-style: italic; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.4); }
  .detail { border-top: 1px solid rgba(28,22,17,0.1); padding: 10px 12px; background: rgba(28,22,17,0.02); }
  .ev-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 560px) { .ev-row { grid-template-columns: 1fr; } }
  .ev-lab, .m-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.5); }
  .ev-row p, .model-row p { margin: 3px 0 0; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.8); }
  .model-row { margin-top: 9px; }
  .model-row.resolve { border-left: 2px solid var(--success); padding-left: 8px; }
  .jump { margin-top: 9px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .j-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .j-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: #8a2d3a; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius-sharp); padding: 1px 6px; cursor: pointer; }
  .j-btn:hover { background: var(--error-border); }
</style>
