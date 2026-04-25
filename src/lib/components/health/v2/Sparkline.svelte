<script lang="ts">
  let {
    data,
    accent = true,
    fill = false,
    height = 56,
  }: { data: number[]; accent?: boolean; fill?: boolean; height?: number } = $props();

  const W = 200;
  const H = $derived(height);

  const lo = $derived(Math.min(...data));
  const hi = $derived(Math.max(...data));
  const range = $derived(hi - lo || 1);

  const pts = $derived(
    data.map((v, i) => [
      (i / (data.length - 1 || 1)) * W,
      H - 4 - ((v - lo) / range) * (H - 8),
    ]),
  );
  const d = $derived(
    pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '),
  );
  const dFill = $derived(d + ` L${W},${H} L0,${H} Z`);
  const lastPt = $derived(pts[pts.length - 1]);
</script>

<svg class="h-card-spark" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
  {#if fill}
    <path d={dFill} fill="rgba(196,87,10,0.10)" />
  {/if}
  <path
    {d}
    fill="none"
    stroke={accent ? 'var(--accent)' : 'var(--text-secondary)'}
    stroke-width="1.6"
    stroke-linejoin="round"
    stroke-linecap="round"
  />
  {#if lastPt}
    <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill="var(--accent)" />
  {/if}
</svg>

<style>
  .h-card-spark {
    width: 100%;
    height: var(--spark-h, 56px);
    display: block;
  }
</style>
