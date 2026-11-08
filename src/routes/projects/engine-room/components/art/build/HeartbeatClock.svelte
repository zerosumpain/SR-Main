<script lang="ts">
  // HeartbeatClock — the scheduler's registry as a day. Each activity is one ring of a
  // twenty-four hour dial, bright across the hours it may run and with a tick for every time
  // its cadence comes round. The ledger beside it is the same list in words; pointing at a row
  // lights its ring.
  //
  // Cadences and windows are read from the heartbeat registry (facts.build.activities).
  import { every } from '../../../lib/format';
  import { shown } from '../../../lib/motion';

  interface Act { name: string; cadenceMinutes: number; window: string | null; what: string }
  let { acts }: { acts: Act[] } = $props();

  const C = 200, R0 = 70, STEP = 13;
  let hot = $state<string | null>(null);

  const hours = (w: string | null): [number, number] => {
    const m = w?.match(/(\d+)\D+(\d+)/);
    return m ? [Number(m[1]), Number(m[2])] : [0, 24];
  };
  const pt = (h: number, r: number) => {
    const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
    return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
  };
  function arc(r: number, [a, b]: [number, number]) {
    const span = ((b - a + 24) % 24) || 24;
    if (span >= 24) return `M ${C} ${C - r} A ${r} ${r} 0 1 1 ${C - 0.01} ${C - r}`;
    const s = pt(a, r), e = pt(a + span, r);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${span > 12 ? 1 : 0} 1 ${e.x} ${e.y}`;
  }
  function ticks(r: number, w: [number, number], cadence: number) {
    const per = cadence / 60;
    if (per <= 0 || 24 / per > 48) return [];
    const span = ((w[1] - w[0] + 24) % 24) || 24;
    const out: Array<{ x: number; y: number }> = [];
    for (let h = 0; h < span; h += per) out.push(pt(w[0] + h, r));
    return out;
  }
</script>

<div class="hb">
  <svg viewBox="0 0 400 400" role="img" aria-label="A twenty-four hour dial with one ring per scheduled activity" {@attach shown()}>
    <circle class="face" cx={C} cy={C} r={R0 + acts.length * STEP + 14} />
    {#each [0, 6, 12, 18] as h}
      {@const p = pt(h, R0 + acts.length * STEP + 2)}
      {@const q = pt(h, R0 - 22)}
      <line class="hr" x1={q.x} y1={q.y} x2={p.x} y2={p.y} />
    {/each}
    {#each acts as a, i (a.name)}
      {@const r = R0 + i * STEP}
      {@const w = hours(a.window)}
      <g class="ring" class:hot={hot === a.name} class:cool={hot && hot !== a.name}>
        <circle class="track" cx={C} cy={C} r={r} />
        <path class="span" d={arc(r, w)} pathLength="1" data-draw style="--d:{i * 0.08}s" />
        {#each ticks(r, w, a.cadenceMinutes) as t}<circle class="tick" cx={t.x} cy={t.y} r="2.6" />{/each}
      </g>
    {/each}
    <text class="lbl" x={C} y={C - 6} text-anchor="middle">24h</text>
    <text class="lbl sm" x={C} y={C + 16} text-anchor="middle">midnight at top</text>
  </svg>

  <ul class="ledger">
    {#each acts as a (a.name)}
      <li class:hot={hot === a.name}>
        <button onpointerenter={() => (hot = a.name)} onpointerleave={() => (hot = null)} onfocus={() => (hot = a.name)} onblur={() => (hot = null)} onclick={() => (hot = hot === a.name ? null : a.name)}>
          <code>{a.name}</code>
          <span class="what">{a.what}</span>
          <em>{every(a.cadenceMinutes)}{a.window ? `, ${a.window}` : ''}</em>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .hb { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: clamp(20px, 4vw, 56px); align-items: center; }
  svg { width: 100%; max-width: 440px; height: auto; display: block; margin: 0 auto; }
  .face { fill: var(--wash); stroke: var(--rule); }
  .hr { stroke: var(--rule); stroke-width: 1; }
  .track { fill: none; stroke: var(--rule); stroke-width: 7; }
  .span { fill: none; stroke: var(--tone); stroke-width: 7; transition: opacity 0.3s, stroke 0.3s; }
  .tick { fill: var(--ground); }
  .ring.cool .span { opacity: 0.25; }
  .ring.hot .span { stroke: var(--tone-text); }
  .lbl { font-family: var(--er-display); font-size: 26px; fill: var(--fg); }
  .lbl.sm { font-family: var(--er-mono); font-size: 13px; fill: var(--fg-3); }
  .ledger { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule-strong); }
  .ledger li { border-bottom: 1px solid var(--rule); }
  .ledger button { width: 100%; display: grid; grid-template-columns: minmax(15ch, auto) minmax(0, 1fr) auto; gap: 4px 14px; align-items: baseline;
    padding: 10px 6px; background: none; border: none; color: inherit; text-align: left; cursor: pointer; font: inherit; }
  .ledger li.hot { background: var(--wash); }
  .ledger code { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--tone-text); }
  .what { font-size: var(--fs-label); color: var(--fg-2); }
  .ledger em { font-style: normal; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); white-space: nowrap; }
  @media (max-width: 860px) {
    .hb { grid-template-columns: minmax(0, 1fr); }
    .ledger button { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  }
</style>
