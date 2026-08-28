<script lang="ts">
  import type { LeverState } from '$lib/policy-engine/types';
  import { LEVERS, GROUP_META, GROUP_ORDER, LEVERS_BY_ID, LEVER_META, DRIVE_LABEL, LEVER_ELI5_NAME } from '$lib/policy-engine/levers';
  import { app } from '../lib/appState.svelte';
  const lname = (id: string, label: string) => (app.narrative === 'eli5' ? LEVER_ELI5_NAME[id] ?? label : label);
  const gname = (g: string) => (app.narrative === 'eli5' ? GROUP_META[g].eli5 : GROUP_META[g].label);

  interface Props {
    levers: LeverState;
    onChange: (id: string, value: number) => void;
    onResetLever: (id: string) => void;
    multicol?: boolean;
  }
  let { levers, onChange, onResetLever, multicol = false }: Props = $props();

  let openInfo = $state<string | null>(null);
  let collapsed = $state<Record<string, boolean>>({});
  let railEl: HTMLDivElement | undefined = $state();
  let flashId = $state<string | null>(null);
  // when a chart hint asks to "adjust this slider", expand its group, scroll to it and flash it
  $effect(() => {
    const id = app.highlightLever;
    if (!id) return;
    const L = LEVERS_BY_ID[id];
    if (L && collapsed[L.group]) collapsed[L.group] = false;
    app.highlightLever = null;
    flashId = id;
    setTimeout(() => (railEl?.querySelector(`[data-lever="${id}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 70);
    setTimeout(() => { if (flashId === id) flashId = null; }, 1700);
  });

  function fmtVal(id: string): string {
    const L = LEVERS_BY_ID[id];
    const v = levers[id] ?? L.baseline;
    return L.format ? L.format(v) : `${v}${L.unit === '%' ? '%' : L.unit === 'index' ? '' : ''}`;
  }
  function pct(id: string): number {
    const L = LEVERS_BY_ID[id];
    const v = levers[id] ?? L.baseline;
    return ((v - L.min) / (L.max - L.min)) * 100;
  }
  function policyPct(id: string): number {
    const L = LEVERS_BY_ID[id];
    return ((L.policy - L.min) / (L.max - L.min)) * 100;
  }
  const confLabel: Record<string, string> = { high: 'well-evidenced', medium: 'moderate', low: 'weak', assumption: 'assumption' };
</script>

<div class="rail" class:multicol bind:this={railEl}>
  {#each GROUP_ORDER as g}
    {@const meta = GROUP_META[g]}
    {@const items = LEVERS.filter((l) => l.group === g)}
    <section class="group">
      <button class="group-head" onclick={() => (collapsed[g] = !collapsed[g])} style="--gc:{meta.colour}">
        <span class="g-tag">{meta.tag}</span>
        <span class="g-label">{gname(g)}</span>
        <span class="g-count">{items.length}</span>
        <span class="g-chev" class:open={!collapsed[g]}>▾</span>
      </button>

      {#if !collapsed[g]}
        <div class="levers">
          {#each items as L (L.id)}
            {@const changed = (levers[L.id] ?? L.baseline) !== L.baseline}
            <div class="lever" class:flash={flashId === L.id} data-lever={L.id}>
              <div class="lever-top">
                <span class="l-label">{lname(L.id, L.label)}</span>
                <span class="l-val" class:changed>{fmtVal(L.id)}</span>
                <button class="l-info" class:active={openInfo === L.id}
                        onclick={() => (openInfo = openInfo === L.id ? null : L.id)}
                        aria-label="Evidence for {L.label}">i</button>
              </div>

              <div class="slider-wrap" style="--gc:{meta.colour}">
                <input class="slider" type="range" min={L.min} max={L.max} step={L.step}
                       value={levers[L.id] ?? L.baseline}
                       style="--fill:{pct(L.id)}%"
                       oninput={(e) => onChange(L.id, Number((e.currentTarget as HTMLInputElement).value))} />
                <span class="policy-tick" style="left:{policyPct(L.id)}%" title="Announced policy: {L.format ? L.format(L.policy) : L.policy}"></span>
              </div>

              {#if openInfo === L.id}
                <div class="info">
                  <p class="i-blurb">{L.blurb}</p>
                  <p class="i-evidence">{L.evidence}</p>
                  {#if LEVER_META[L.id]}
                    <p class="i-model"><b>In the model:</b> {LEVER_META[L.id].modelNote}</p>
                    <div class="i-drives">
                      <span class="dl">moves:</span>
                      {#each LEVER_META[L.id].drives as d}<span class="drv">{DRIVE_LABEL[d]}</span>{/each}
                    </div>
                  {/if}
                  <div class="i-meta">
                    <span class="conf conf-{L.confidence}">{confLabel[L.confidence]}</span>
                    <span class="i-ref">{L.policyRef}</span>
                  </div>
                  <div class="i-foot">
                    {#if changed}<button class="i-reset" onclick={() => onResetLever(L.id)}>reset</button>{/if}
                    {#if L.url}<a class="i-src" href={L.url} target="_blank" rel="noopener">source ↗</a>{/if}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .rail { display: flex; flex-direction: column; gap: 8px; }
  .rail.multicol { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; align-items: start; }
  .lever { border-radius: var(--radius-sharp); }
  .lever.flash { animation: leverFlash 1.6s ease; }
  @keyframes leverFlash { 0%, 100% { background: transparent; } 18%, 60% { background: var(--accent-ink-tint-22); } }
  @media (prefers-reduced-motion: reduce) { .lever.flash { animation: none; background: var(--accent-ink-tint-22); } }
  .group { border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); overflow: hidden; background: rgba(255,255,255,0.28); }
  .group-head {
    width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    background: rgba(28,22,17,0.035); border: none; cursor: pointer; text-align: left;
    border-left: 3px solid var(--gc);
  }
  .group-head:hover { background: rgba(28,22,17,0.06); }
  .g-tag {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.1em;
    color: #fff; background: var(--gc); padding: 2px 5px; border-radius: var(--radius-sharp);
  }
  .g-label { font-family: var(--fs-serif); font-weight: 500; font-size: var(--fs-label); color: var(--ink); flex: 1; }
  .g-count { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.4); }
  .g-chev { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); transition: transform 0.2s; }
  .g-chev.open { transform: rotate(0); }
  .g-chev:not(.open) { transform: rotate(-90deg); }

  .levers { padding: 6px 10px 10px; display: flex; flex-direction: column; gap: 11px; }
  .lever-top { display: flex; align-items: baseline; gap: 6px; }
  .l-label { font-size: var(--fs-label-xs); color: var(--ink); flex: 1; line-height: 1.25; }
  .l-val {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600;
    color: rgba(28,22,17,0.55); white-space: nowrap;
  }
  .l-val.changed { color: var(--ink); }
  .l-info {
    width: 15px; height: 15px; border-radius: var(--radius-pill); border: 1px solid rgba(28,22,17,0.3);
    background: transparent; color: rgba(28,22,17,0.55); font-size: var(--fs-label-xs); font-style: italic;
    font-family: Georgia, serif; cursor: pointer; line-height: 1; padding: 0; flex-shrink: 0;
  }
  .l-info:hover, .l-info.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

  .slider-wrap { position: relative; padding-top: 2px; }
  .slider {
    -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: var(--radius-sharp);
    background: linear-gradient(to right, var(--gc) 0%, var(--gc) var(--fill), rgba(28,22,17,0.14) var(--fill), rgba(28,22,17,0.14) 100%);
    outline: none; cursor: pointer; margin: 4px 0;
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: var(--radius-pill);
    background: var(--paper); border: 2px solid var(--gc); cursor: pointer;
  }
  .slider::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--paper);
    border: 2px solid var(--gc); cursor: pointer;
  }
  .policy-tick {
    position: absolute; top: 1px; width: 2px; height: 12px; background: rgba(28,22,17,0.4);
    transform: translateX(-50%); pointer-events: none; border-radius: var(--radius-sharp);
  }

  .info {
    background: rgba(28,22,17,0.045); border-radius: var(--radius-sharp); padding: 8px 9px; margin-top: 2px;
    border-left: 2px solid var(--ink);
  }
  .i-blurb { margin: 0 0 5px; font-size: var(--fs-label-xs); line-height: 1.4; color: var(--ink); }
  .i-evidence { margin: 0 0 6px; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.7); }
  .i-model { margin: 0 0 6px; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.78); }
  .i-model b { color: var(--ink); }
  .i-drives { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; }
  .dl { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.45); }
  .drv { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-sharp); padding: 1px 5px; }
  .i-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 5px; }
  .conf {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.05em; text-transform: uppercase;
    padding: 2px 5px; border-radius: var(--radius-sharp); font-weight: 600;
  }
  .conf-high { background: var(--success-bg); color: var(--success); }
  .conf-medium { background: rgba(176,99,46,0.16); color: #b4632e; }
  .conf-low { background: var(--error-border); color: var(--error); }
  .conf-assumption { background: var(--accent-ink-tint-22); color: var(--accent-ink); }
  .i-ref { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .i-foot { display: flex; gap: 10px; align-items: center; }
  .i-reset {
    background: transparent; border: none; border-bottom: 1px dashed rgba(28,22,17,0.4);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6);
    cursor: pointer; padding: 0; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .i-reset:hover { color: var(--ink); }
  .i-src {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--gc);
    text-decoration: none; border-bottom: 1px dashed currentColor;
  }
</style>
