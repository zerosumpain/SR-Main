<script lang="ts">
  // Why the composite is the number it is.
  //
  // The confusion this exists to end: Whoop says 94% recovered, the page says
  // readiness 66, and nothing explains the gap. Recovery is ONE of four inputs
  // and carries 40% of the weight; the other 60% is HRV trend, sleep quality
  // and how much load you are carrying. Showing the four contributions as
  // shares of the score makes the arithmetic visible, and the sentence names
  // whichever leg is doing the pulling.
  //
  // (The load leg used to score being FRESH at 30/100 — it penalised rest,
  // which is what put a 94% recovery day at 66. That is fixed in
  // readiness-service; this component is how you can see it working.)
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';

  export interface ReadinessFactors {
    recovery: { value: number; weight: number };
    hrvTrend: { value: number; weight: number; direction: 'up' | 'down' | 'stable' };
    sleepQuality: { value: number; weight: number };
    loadBalance: { value: number; weight: number; zone: string };
  }

  let {
    score,
    label,
    recommendation,
    factors,
    onevidence,
  }: {
    score: number;
    label: string;
    recommendation: string;
    factors: ReadinessFactors;
    onevidence?: (id: string) => void;
  } = $props();

  const ZONE_WORDS: Record<string, string> = {
    optimal: 'in the band where fitness builds',
    slightly_high: 'carrying a little fatigue',
    caution: 'carrying real fatigue',
    danger: 'carrying too much',
    undertraining: 'fresh, with room to build',
    detraining: 'fresh — the base has gone quiet',
  };

  interface Leg {
    key: string;
    label: string;
    /** 0–100, the leg's own score. */
    value: number;
    weight: number;
    /** Points this leg puts into the composite. */
    points: number;
    /** The most points it could have put in. */
    maxPoints: number;
    sub: string;
    evidence: string;
  }

  const legs = $derived.by((): Leg[] => [
    {
      key: 'recovery',
      label: 'Recovery',
      value: factors.recovery.value,
      weight: factors.recovery.weight,
      points: factors.recovery.value * factors.recovery.weight,
      maxPoints: 100 * factors.recovery.weight,
      sub: "Whoop's own overnight score",
      evidence: 'recovery-debt',
    },
    {
      key: 'hrv',
      label: 'HRV trend',
      value: factors.hrvTrend.value,
      weight: factors.hrvTrend.weight,
      points: factors.hrvTrend.value * factors.hrvTrend.weight,
      maxPoints: 100 * factors.hrvTrend.weight,
      sub: `today against your 7-day mean · ${factors.hrvTrend.direction}`,
      evidence: 'autonomic-balance',
    },
    {
      key: 'sleep',
      label: 'Sleep',
      value: factors.sleepQuality.value,
      weight: factors.sleepQuality.weight,
      points: factors.sleepQuality.value * factors.sleepQuality.weight,
      maxPoints: 100 * factors.sleepQuality.weight,
      sub: 'performance against your own need',
      evidence: 'sleep-regularity',
    },
    {
      key: 'load',
      label: 'Capacity',
      value: factors.loadBalance.value,
      weight: factors.loadBalance.weight,
      points: factors.loadBalance.value * factors.loadBalance.weight,
      maxPoints: 100 * factors.loadBalance.weight,
      sub: ZONE_WORDS[factors.loadBalance.zone] ?? factors.loadBalance.zone,
      evidence: 'acwr',
    },
  ]);

  /** The leg giving away the most points against its own ceiling. */
  const weakest = $derived(
    [...legs].sort((a, b) => a.maxPoints - a.points - (b.maxPoints - b.points)).at(-1) ?? null,
  );
  const shortfall = $derived(weakest ? weakest.maxPoints - weakest.points : 0);

  const explainer = $derived.by(() => {
    const rec = Math.round(factors.recovery.value);
    const head = `Recovery is Whoop's own number and 40% of this; the composite is all four legs together, which is why the two rarely match.`;
    if (!weakest || shortfall < 4) {
      return `${head} Today nothing is dragging: ${rec}% recovered and every leg near its ceiling.`;
    }
    return `${head} Today recovery reads ${rec}% but ${weakest.label.toLowerCase()} is ${Math.round(weakest.value)} out of 100, and that alone costs the composite ${Math.round(shortfall)} points.`;
  });
</script>

<div class="rb">
  <div class="rb-figure">
    <p class="rb-score">{Math.round(score)}<span class="rb-of">/100</span></p>
    <p class="rb-label">{label}</p>
    <p class="rb-rec">{recommendation}</p>
  </div>

  <div class="rb-legs">
    {#each legs as leg (leg.key)}
      <div class="rb-leg">
        <div class="rb-leg-hd">
          <span class="rb-leg-name">{leg.label}</span>
          <span class="rb-leg-pts">
            {leg.points.toFixed(0)}<span class="rb-leg-max"> of {leg.maxPoints.toFixed(0)}</span>
          </span>
        </div>
        <div class="rb-bar" role="img" aria-label="{leg.label}: {Math.round(leg.value)} out of 100, worth {Math.round(leg.maxPoints)} points of the composite">
          <span class="rb-bar-fill" style="width: {Math.max(0, Math.min(100, leg.value))}%"></span>
        </div>
        <span class="rb-leg-sub">{leg.sub}<EvidenceChip id={leg.evidence} onopen={onevidence} /></span>
      </div>
    {/each}
  </div>
</div>

<p class="h-note">{explainer}</p>

<style>
  .rb {
    display: grid;
    grid-template-columns: minmax(0, 190px) minmax(0, 1fr);
    gap: 1.5rem 2rem;
    align-items: start;
  }
  @media (max-width: 720px) {
    .rb {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .rb-figure {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
  }
  .rb-score {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: var(--fs-num-lg);
    letter-spacing: -0.02em;
    line-height: 0.9;
    color: var(--text-primary);
    margin: 0;
  }
  .rb-of {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    color: var(--text-ghost);
    margin-left: 0.3rem;
    letter-spacing: 0.08em;
  }
  .rb-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    margin: 0.35rem 0 0 0;
  }
  .rb-rec {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-muted);
    margin: 0;
  }

  .rb-legs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 1rem 1.5rem;
    min-width: 0;
  }
  .rb-leg {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }
  .rb-leg-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .rb-leg-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .rb-leg-pts {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .rb-leg-max {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .rb-bar {
    height: 8px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-hair);
    position: relative;
  }
  .rb-bar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
  }
  .rb-leg-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-ghost);
  }
</style>
