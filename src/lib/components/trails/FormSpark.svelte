<script lang="ts">
  import type { SegmentForm } from '$lib/trails/segments/form';
  import { formLabel } from '$lib/trails/segments/form';

  let {
    form,
    width = 64,
    height = 18,
  }: { form: SegmentForm; width?: number; height?: number } = $props();

  // Durations, oldest first. The line is INVERTED against the raw value on
  // purpose: the number is a time, so lower is better, and a line that fell as
  // you got faster would read as decline to every eye that has seen a chart.
  const path = $derived.by(() => {
    const xs = form.spark;
    if (xs.length < 2) return '';
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const span = hi - lo || 1;
    const step = width / (xs.length - 1);
    return xs
      .map((v, i) => {
        const y = height - 1 - ((hi - v) / span) * (height - 2);
        return `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  });

  const stroke = $derived(
    form.direction === 'improving'
      ? 'var(--accent-ink)'
      : form.direction === 'slipping'
        ? 'var(--trend-down)'
        : 'var(--text-ghost)',
  );

  const label = $derived(formLabel(form));
</script>

<span class="fs-wrap" title={label}>
  {#if path}
    <svg
      class="fs-svg"
      viewBox="0 0 {width} {height}"
      width={width}
      height={height}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <path d={path} fill="none" stroke={stroke} stroke-width="2" stroke-linejoin="round" />
    </svg>
  {:else}
    <span class="fs-none" aria-label={label}>—</span>
  {/if}
  <span class="fs-text" class:improving={form.direction === 'improving'} class:slipping={form.direction === 'slipping'}>
    {#if form.direction === 'improving'}Improving{:else if form.direction === 'slipping'}Slipping{:else if form.direction === 'holding'}Holding{:else}New{/if}
  </span>
</span>

<style>
  .fs-wrap {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .fs-svg {
    display: block;
    flex: none;
  }
  .fs-none {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    width: 64px;
    text-align: center;
  }
  .fs-text {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .fs-text.improving {
    color: var(--accent-ink);
  }
  .fs-text.slipping {
    color: var(--trend-down);
  }
</style>
