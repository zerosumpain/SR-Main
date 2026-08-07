<script lang="ts">
  // DecayCurve — how much an edge is still worth, scrubbed by age.
  //
  // Two lines rather than one, because the interesting decision is not the half-life, it is
  // that the decay is PARTIAL. The dashed line is what a naive multiply would do; the solid
  // one is what actually happens. They diverge exactly where the wrong answer would start
  // ranking a fresh guess above a well-corroborated old relationship.
  import { DECAY, SWEEP, decayed } from '../../../lib/channels';

  const W = 520, H = 168;
  const pad = { l: 40, r: 12, t: 10, b: 26 };
  const MAX_DAYS = SWEEP.windowDays;

  let age = $state(28);

  const x = (d: number) => pad.l + (d / MAX_DAYS) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - v * (H - pad.t - pad.b);

  const raw = (d: number) => Math.max(DECAY.floor, Math.pow(0.5, d / DECAY.halfLifeDays));

  const line = (f: (d: number) => number) =>
    Array.from({ length: MAX_DAYS + 1 }, (_, d) => `${d === 0 ? 'M' : 'L'} ${x(d).toFixed(1)} ${y(f(d)).toFixed(1)}`).join(' ');

  const partial = $derived(line((d) => decayed(1, d)));
  const naive = $derived(line(raw));

  const here = $derived(decayed(1, age));
  const naiveHere = $derived(raw(age));
</script>

<div class="dc">
  <label class="f">
    <span class="f-lab">Age of the evidence</span>
    <input type="range" min="0" max={MAX_DAYS} step="1" bind:value={age} />
    <output class="f-out">{age} days</output>
  </label>

  <div class="plot">
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Edge weight against age. At {age} days a fully corroborated edge is still worth {here.toFixed(2)}; a naive multiply would put it at {naiveHere.toFixed(2)}. The half-life is {DECAY.halfLifeDays} days and the floor is {DECAY.floor}.">
      <!-- axes -->
      <line x1={pad.l} y1={y(0)} x2={W - pad.r} y2={y(0)} stroke="rgba(28,22,17,0.3)" />
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={y(0)} stroke="rgba(28,22,17,0.3)" />
      {#each [0, 0.5, 1] as t}
        <text x={pad.l - 6} y={y(t) + 3} text-anchor="end" class="tick">{t.toFixed(1)}</text>
        <line x1={pad.l} y1={y(t)} x2={W - pad.r} y2={y(t)} stroke="rgba(28,22,17,0.08)" />
      {/each}

      <!-- half-life marker -->
      <line x1={x(DECAY.halfLifeDays)} y1={pad.t} x2={x(DECAY.halfLifeDays)} y2={y(0)}
            stroke="rgba(28,22,17,0.3)" stroke-dasharray="3 3" />
      <text x={x(DECAY.halfLifeDays) + 4} y={pad.t + 9} class="tick">half-life {DECAY.halfLifeDays}d</text>

      <path d={naive} class="l-naive" />
      <path d={partial} class="l-real" />

      <line x1={x(age)} y1={pad.t} x2={x(age)} y2={y(0)} class="cursor" />
      <circle cx={x(age)} cy={y(naiveHere)} r="3.5" class="d-naive" />
      <circle cx={x(age)} cy={y(here)} r="4" class="d-real" />

      <text x={pad.l} y={H - 6} class="tick">today</text>
      <text x={W - pad.r} y={H - 6} text-anchor="end" class="tick">{MAX_DAYS}d — the edge of the window</text>
    </svg>
  </div>

  <div class="read" aria-live="polite">
    <span class="r-item"><b>{here.toFixed(2)}</b>what the edge is worth</span>
    <span class="r-item alt"><b>{naiveHere.toFixed(2)}</b>what multiplying it would give</span>
    <span class="r-note">Half the weight is earned by corroboration and age cannot touch it.</span>
  </div>
</div>

<style>
  .dc { display: flex; flex-direction: column; gap: 9px; min-width: 0; }

  .f { display: flex; align-items: center; gap: 9px; }
  .f-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); white-space: nowrap; }
  .f input { accent-color: var(--accent); flex: 1 1 auto; max-width: 240px; }
  .f-out { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600;
    color: var(--text-primary); white-space: nowrap; }

  /* Capped: stretched to a wide page the 520-unit viewBox doubles every label with it. */
  .plot { max-width: 720px; }
  .plot svg { display: block; width: 100%; height: auto; }
  .tick { font-family: 'JetBrains Mono', monospace; font-size: 8px; fill: rgba(28,22,17,0.45); }

  .l-real { fill: none; stroke: var(--accent); stroke-width: 2; }
  .l-naive { fill: none; stroke: rgba(28,22,17,0.4); stroke-width: 1.4; stroke-dasharray: 4 3; }
  .cursor { stroke: rgba(28,22,17,0.35); stroke-width: 1; }
  .d-real { fill: var(--accent); }
  .d-naive { fill: rgba(28,22,17,0.45); }

  .read { display: flex; align-items: baseline; gap: 8px 18px; flex-wrap: wrap; }
  .r-item { display: inline-flex; align-items: baseline; gap: 6px; font-size: 11.5px; color: rgba(28,22,17,0.6); }
  .r-item b { font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 600; color: var(--accent); }
  .r-item.alt b { color: rgba(28,22,17,0.45); }
  .r-note { font-size: 11.5px; color: rgba(28,22,17,0.5); margin-left: auto; }

  @media (max-width: 620px) { .r-note { margin-left: 0; } }
</style>
