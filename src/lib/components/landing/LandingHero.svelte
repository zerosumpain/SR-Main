<script lang="ts">
  import { roundPulse } from '$lib/biome/state';

  let {
    tag,
    primary,
    ghost,
    strap,
    pulse,
    steps,
    temp,
    condition,
  }: {
    tag: string;
    primary: string;
    ghost: string;
    strap: string;
    pulse: number;
    steps: number;
    temp: number;
    condition: string;
  } = $props();
</script>

<div class="lh">
  <p class="lh-tag">{tag}</p>
  <h1 class="lh-head">{primary}<br /><span class="ghost">{ghost}</span></h1>
  <p class="lh-strap">{strap}</p>
  <p class="lh-vitals">
    {roundPulse(pulse)} BPM <span class="sep">/</span>
    {steps.toLocaleString('en-GB')} STEPS <span class="sep">/</span>
    {Math.round(temp)}°C {condition.toUpperCase()}
  </p>
</div>

<style>
  .lh {
    max-width: 760px;
  }
  .lh-tag {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 14px;
  }
  .lh-head {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(52px, 9vw, 120px);
    line-height: 0.86;
    letter-spacing: -0.03em;
    text-transform: uppercase;
    margin: 0;
    color: var(--text-primary);
  }
  .lh-head .ghost {
    color: var(--text-ghost);
  }
  .lh-strap {
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-secondary);
    border-left: 3px solid var(--accent);
    padding-left: 14px;
    margin: 20px 0 0;
    max-width: 440px;
  }
  .lh-vitals {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--accent);
    margin: 18px 0 0;
  }
  .lh-vitals .sep {
    color: var(--text-ghost);
  }
</style>
