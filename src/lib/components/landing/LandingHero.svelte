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
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  /* The loudest voice on the page — nothing below it goes above --fs-num-lg. */
  .lh-head {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(38px, 8.5vw, 104px);
    line-height: 0.9;
    letter-spacing: -0.045em;
    text-transform: uppercase;
    margin: 0;
    color: var(--text-primary);
  }
  .lh-head .ghost {
    color: var(--text-ghost);
  }
  .lh-strap {
    font-size: var(--fs-body-lg);
    line-height: 1.6;
    color: var(--text-muted);
    margin: 20px 0 0;
    max-width: 44ch;
  }
  /* The same `/`-separated ledger the hub header uses, in the hero's register. */
  .lh-vitals {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    margin: 18px 0 0;
  }
  .lh-vitals .sep {
    color: var(--text-ghost);
    margin: 0 0.4ch;
  }
</style>
