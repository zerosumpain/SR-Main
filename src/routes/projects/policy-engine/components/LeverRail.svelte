<script lang="ts">
  import type { LeverState } from '../lib/types';
  import { LEVERS, GROUP_META, GROUP_ORDER, LEVERS_BY_ID, LEVER_META, DRIVE_LABEL } from '../lib/levers';

  interface Props {
    levers: LeverState;
    onChange: (id: string, value: number) => void;
    onResetLever: (id: string) => void;
    multicol?: boolean;
  }
  let { levers, onChange, onResetLever, multicol = false }: Props = $props();

  let openInfo = $state<string | null>(null);
  let collapsed = $state<Record<string, boolean>>({});

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

<div class="rail" class:multicol>
  {#each GROUP_ORDER as g}
    {@const meta = GROUP_META[g]}
    {@const items = LEVERS.filter((l) => l.group === g)}
    <section class="group">
      <button class="group-head" onclick={() => (collapsed[g] = !collapsed[g])} style="--gc:{meta.colour}">
        <span class="g-tag">{meta.tag}</span>
        <span class="g-label">{meta.label}</span>
        <span class="g-count">{items.length}</span>
        <span class="g-chev" class:open={!collapsed[g]}>▾</span>
      </button>

      {#if !collapsed[g]}
        <div class="levers">
          {#each items as L (L.id)}
            {@const changed = (levers[L.id] ?? L.baseline) !== L.baseline}
            <div class="lever">
              <div class="lever-top">
                <span class="l-label">{L.label}</span>
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
  .group { border: 1px solid rgba(28,22,17,0.1); border-radius: 7px; overflow: hidden; background: rgba(255,255,255,0.28); }
  .group-head {
    width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    background: rgba(28,22,17,0.035); border: none; cursor: pointer; text-align: left;
    border-left: 3px solid var(--gc);
  }
  .group-head:hover { background: rgba(28,22,17,0.06); }
  .g-tag {
    font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
    color: #fff; background: var(--gc); padding: 2px 5px; border-radius: 3px;
  }
  .g-label { font-family: 'Fraunces', serif; font-weight: 500; font-size: 13.5px; color: var(--ink, #1c1611); flex: 1; }
  .g-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.4); }
  .g-chev { font-size: 10px; color: rgba(28,22,17,0.5); transition: transform 0.2s; }
  .g-chev.open { transform: rotate(0); }
  .g-chev:not(.open) { transform: rotate(-90deg); }

  .levers { padding: 6px 10px 10px; display: flex; flex-direction: column; gap: 11px; }
  .lever-top { display: flex; align-items: baseline; gap: 6px; }
  .l-label { font-size: 12px; color: var(--ink, #1c1611); flex: 1; line-height: 1.25; }
  .l-val {
    font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 600;
    color: rgba(28,22,17,0.55); white-space: nowrap;
  }
  .l-val.changed { color: var(--ink, #1c1611); }
  .l-info {
    width: 15px; height: 15px; border-radius: 50%; border: 1px solid rgba(28,22,17,0.3);
    background: transparent; color: rgba(28,22,17,0.55); font-size: 9.5px; font-style: italic;
    font-family: Georgia, serif; cursor: pointer; line-height: 1; padding: 0; flex-shrink: 0;
  }
  .l-info:hover, .l-info.active { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border-color: var(--ink, #1c1611); }

  .slider-wrap { position: relative; padding-top: 2px; }
  .slider {
    -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 3px;
    background: linear-gradient(to right, var(--gc) 0%, var(--gc) var(--fill), rgba(28,22,17,0.14) var(--fill), rgba(28,22,17,0.14) 100%);
    outline: none; cursor: pointer; margin: 4px 0;
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: var(--paper, #f1ead6); border: 2px solid var(--gc); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .slider::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%; background: var(--paper, #f1ead6);
    border: 2px solid var(--gc); cursor: pointer;
  }
  .policy-tick {
    position: absolute; top: 1px; width: 2px; height: 12px; background: rgba(28,22,17,0.4);
    transform: translateX(-50%); pointer-events: none; border-radius: 1px;
  }

  .info {
    background: rgba(28,22,17,0.045); border-radius: 5px; padding: 8px 9px; margin-top: 2px;
    border-left: 2px solid var(--ink, #1c1611);
  }
  .i-blurb { margin: 0 0 5px; font-size: 11.5px; line-height: 1.4; color: var(--ink, #1c1611); }
  .i-evidence { margin: 0 0 6px; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.7); }
  .i-model { margin: 0 0 6px; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.78); }
  .i-model b { color: var(--ink, #1c1611); }
  .i-drives { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; }
  .dl { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.45); }
  .drv { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #3f7d6e; background: rgba(63,125,110,0.12); border-radius: 3px; padding: 1px 5px; }
  .i-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 5px; }
  .conf {
    font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase;
    padding: 2px 5px; border-radius: 3px; font-weight: 600;
  }
  .conf-high { background: rgba(47,125,79,0.16); color: #2f7d4f; }
  .conf-medium { background: rgba(176,99,46,0.16); color: #b4632e; }
  .conf-low { background: rgba(177,69,94,0.16); color: #b1455e; }
  .conf-assumption { background: rgba(122,90,166,0.16); color: #7a5aa6; }
  .i-ref { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }
  .i-foot { display: flex; gap: 10px; align-items: center; }
  .i-reset {
    background: transparent; border: none; border-bottom: 1px dashed rgba(28,22,17,0.4);
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.6);
    cursor: pointer; padding: 0; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .i-reset:hover { color: var(--ink, #1c1611); }
  .i-src {
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--gc, #1c1611);
    text-decoration: none; border-bottom: 1px dashed currentColor;
  }
</style>
