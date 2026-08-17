<script lang="ts">
  // WilsonBench — the relevance arithmetic, run live with the shipped constants.
  //
  // This mirrors the production formula exactly (lib/lessons.ts RELEVANCE holds the
  // constants; the shape is prior/recency/outcome/liveness with weights that shift as
  // evidence accumulates). Nothing here is illustrative-only: drag the sliders and you
  // are computing the same number the ranking computes.
  import { RELEVANCE } from '../../../lib/lessons';

  let { tone = '#8a2d3a' }: { tone?: string } = $props();

  let helpful = $state(1);
  let unhelpful = $state(0);
  let ageDays = $state(30);
  let stale = $state(false);

  const n = $derived(helpful + unhelpful);

  // Wilson lower bound at ~95%, with the neutral prior and the floor, as shipped.
  const outcome = $derived.by(() => {
    if (n <= 0) return RELEVANCE.neutralPrior;
    const p = helpful / n;
    const z2 = RELEVANCE.z * RELEVANCE.z;
    const centre = p + z2 / (2 * n);
    const margin = RELEVANCE.z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    const bound = (centre - margin) / (1 + z2 / n);
    return Math.max(RELEVANCE.outcomeFloor, Math.min(1, bound));
  });

  // Age decay with a floor: old is not wrong, it is just not first.
  const recency = $derived(
    RELEVANCE.recencyFloor +
      (1 - RELEVANCE.recencyFloor) * Math.pow(0.5, ageDays / RELEVANCE.halfLifeDays),
  );

  // The weights move with evidence — recency sorts an unproven corpus, outcomes
  // take over as observations accumulate. No mode switch.
  const confidence = $derived(n / (n + RELEVANCE.evidenceHalfWeight));
  const belief = $derived((1 - confidence) * RELEVANCE.neutralPrior + confidence * outcome);
  const effectiveRecency = $derived(1 - (1 - confidence) * (1 - recency));
  const liveness = $derived(stale ? RELEVANCE.staleWeight : 1);
  const score = $derived(belief * effectiveRecency * liveness);

  const because = $derived.by(() => {
    let s: string;
    if (n === 0) s = 'no outcomes resolved yet — ranked on recency alone';
    else if (outcome > RELEVANCE.neutralPrior) s = `helped ${helpful} of ${n} builds it was served to`;
    else if (helpful === 0) s = `served ${n}× and never once preceded an improvement — atrophying`;
    else if (unhelpful === 0) s = `helped all ${n} so far — too few to rank on yet`;
    else s = `mixed: helped ${helpful} of ${n}`;
    return stale ? `${s}; every file it names is gone` : s;
  });

  const PARTS = $derived([
    { label: 'Outcome (Wilson lower bound)', value: outcome },
    { label: 'Belief (prior blended by evidence)', value: belief },
    { label: 'Recency, after its evidence discount', value: effectiveRecency },
    { label: 'Liveness', value: liveness },
  ]);
</script>

<div class="wb" style="--tone:{tone}">
  <div class="sliders">
    <label class="sl">
      <span class="sl-k">Helped <b>{helpful}</b></span>
      <input type="range" min="0" max="50" step="1" bind:value={helpful} />
    </label>
    <label class="sl">
      <span class="sl-k">Didn't help <b>{unhelpful}</b></span>
      <input type="range" min="0" max="50" step="1" bind:value={unhelpful} />
    </label>
    <label class="sl">
      <span class="sl-k">Age <b>{ageDays} days</b></span>
      <input type="range" min="0" max="720" step="10" bind:value={ageDays} />
    </label>
    <label class="tick">
      <input type="checkbox" bind:checked={stale} />
      <span>Every file it cites is gone</span>
    </label>
  </div>

  <div class="parts">
    {#each PARTS as p (p.label)}
      <div class="part">
        <span class="p-lab">{p.label}</span>
        <div class="p-track"><div class="p-fill" style="width:{p.value * 100}%"></div></div>
        <span class="p-val">{p.value.toFixed(2)}</span>
      </div>
    {/each}
  </div>

  <p class="readout" aria-live="polite">
    <b class="score">{score.toFixed(3)}</b> — {because}.
  </p>
</div>

<style>
  .wb { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

  .sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px 22px; align-items: end; }
  .sl { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .sl-k { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em;
    text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .sl-k b { color: var(--text-primary); letter-spacing: 0; }
  .sl input { width: 100%; accent-color: var(--tone); }
  .tick { display: inline-flex; align-items: center; gap: 8px; font-size: var(--fs-label);
    color: rgba(28,22,17,0.74); padding-bottom: 2px; cursor: pointer; }
  .tick input { accent-color: var(--tone); }

  .parts { display: flex; flex-direction: column; gap: 6px; }
  .part { display: grid; grid-template-columns: minmax(150px, 260px) 1fr 46px; gap: 10px; align-items: center; }
  .p-lab { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.65); }
  .p-track { height: 12px; border-radius: var(--radius-sharp); background: rgba(28,22,17,0.07);
    border: 1px solid rgba(28,22,17,0.12); overflow: hidden; }
  .p-fill { height: 100%; background: color-mix(in srgb, var(--tone) 55%, transparent); }
  .p-val { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); text-align: right; }

  .readout { margin: 0; padding-top: 10px; border-top: 1px dashed rgba(28,22,17,0.18);
    font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); }
  .score { font-family: var(--font-mono); font-size: var(--fs-body-sm); color: var(--tone); }

  @media (max-width: 560px) {
    .part { grid-template-columns: 1fr 46px; }
    .p-lab { grid-column: 1 / -1; }
  }
</style>
