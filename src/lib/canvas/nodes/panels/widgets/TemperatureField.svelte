<script lang="ts">
  // Temperature slider with live single-word descriptor (Focused / Balanced
  // / Adventurous / Creative). Thresholds are configurable so panels can
  // tune them — LlmAgent uses tighter bands (0.2 / 0.9) than the default
  // (0.3 / 1.0).

  let {
    value,
    onChange,
    label = 'Temperature',
    min = 0,
    max = 2,
    step = 0.1,
    /** Upper bound of "Focused" band. */
    focusedMax = 0.3,
    /** Upper bound of "Balanced" band. */
    balancedMax = 1.0,
    /** Upper bound of the third band — above this is the highest band. */
    adventurousMax = 1.5,
    /** Descriptor labels for the four bands. Default: Focused / Balanced / Adventurous / Creative. */
    bandLabels = ['Focused', 'Balanced', 'Adventurous', 'Creative'],
    hint = '0 = focused / deterministic · 0.7 = balanced (default) · 1.5+ = creative.',
  }: {
    value: number;
    onChange: (v: number) => void;
    label?: string;
    min?: number;
    max?: number;
    step?: number;
    focusedMax?: number;
    balancedMax?: number;
    adventurousMax?: number;
    bandLabels?: [string, string, string, string];
    hint?: string;
  } = $props();

  const descriptor = $derived.by(() => {
    if (value <= focusedMax) return bandLabels[0];
    if (value <= balancedMax) return bandLabels[1];
    if (value < adventurousMax) return bandLabels[2];
    return bandLabels[3];
  });
</script>

<section class="tf-sec">
  <div class="tf-field">
    <div class="tf-hdr">
      <span class="tf-label">{label}</span>
      <span class="tf-readout">
        <span class="tf-value">{value.toFixed(1)}</span>
        <span class="tf-word">{descriptor}</span>
      </span>
    </div>
    <input
      type="range"
      {min}
      {max}
      {step}
      {value}
      oninput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
      class="tf-range"
    />
    {#if hint}<span class="tf-hint">{@html hint}</span>{/if}
  </div>
</section>

<style>
  .tf-sec { display: flex; flex-direction: column; gap: 8px; }
  .tf-field { display: flex; flex-direction: column; gap: 4px; }
  .tf-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  }
  .tf-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .tf-readout {
    display: inline-flex; gap: 8px; align-items: baseline;
    font-family: var(--font-mono); font-size: var(--fs-label);
  }
  .tf-value { color: var(--text-primary); }
  .tf-word {
    color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: var(--fs-label-xs);
  }
  .tf-range {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .tf-hint { font-size: var(--fs-label); color: var(--text-ghost); }
</style>
