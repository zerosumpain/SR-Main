<script lang="ts">
  // A horizontal zone gauge: a track split into proportional bands with a marker
  // at the current value. Warm-monochrome by design — tones map to in-palette
  // tokens only (accent / warn / trend-down / ghost), never a rainbow.
  type Tone = 'good' | 'warn' | 'bad' | 'cool';
  type Zone = { to: number; label: string; tone: Tone };

  let {
    value,
    min = 0,
    max = 100,
    zones,
    active = -1,
    formatValue = (v: number) => `${Math.round(v)}`,
  }: {
    value: number;
    min?: number;
    max?: number;
    zones: Zone[];
    /** index of the zone the value falls in (for label emphasis); -1 = auto */
    active?: number;
    formatValue?: (v: number) => string;
  } = $props();

  const span = $derived(max - min);
  const markerPct = $derived(
    Math.max(0, Math.min(100, ((value - min) / (span || 1)) * 100)),
  );

  function toneColor(t: Tone): string {
    if (t === 'good') return 'var(--accent)';
    if (t === 'warn') return 'var(--warn)';
    if (t === 'bad') return 'var(--trend-down)';
    return 'rgba(26,16,8,0.22)';
  }

  // Resolve which zone the value sits in, if not given.
  const activeIdx = $derived(
    active >= 0
      ? active
      : (() => {
          for (let i = 0; i < zones.length; i++) if (value <= zones[i].to) return i;
          return zones.length - 1;
        })(),
  );

  // Segment widths as % of the track.
  const segs = $derived(
    zones.map((z, i) => {
      const from = i === 0 ? min : zones[i - 1].to;
      const w = ((z.to - from) / (span || 1)) * 100;
      return { ...z, w: Math.max(0, w), color: toneColor(z.tone) };
    }),
  );
</script>

<div class="bg-wrap">
  <div class="bg-track" role="img" aria-label={`${formatValue(value)} on a ${formatValue(min)}–${formatValue(max)} scale`}>
    {#each segs as s, i (i)}
      <div
        class="bg-seg"
        class:dim={i !== activeIdx}
        style="flex: {s.w} 0 0; background: {s.color};"
      ></div>
    {/each}
    <div class="bg-marker" style="left: {markerPct}%">
      <span class="bg-marker-val">{formatValue(value)}</span>
    </div>
  </div>
  <div class="bg-labels">
    {#each zones as z, i (i)}
      <span class="bg-label" class:on={i === activeIdx}>{z.label}</span>
    {/each}
  </div>
</div>

<style>
  .bg-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
  .bg-track {
    position: relative;
    display: flex;
    height: 14px;
    gap: 1px;
    background: var(--bg);
  }
  .bg-seg {
    height: 100%;
    transition: opacity 180ms var(--ease-out, ease);
  }
  .bg-seg.dim {
    opacity: 0.34;
  }
  .bg-marker {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    background: var(--text-primary);
    transform: translateX(-1px);
    z-index: 2;
  }
  .bg-marker::before {
    content: '';
    position: absolute;
    top: -3px;
    left: 50%;
    width: 7px;
    height: 7px;
    background: var(--text-primary);
    transform: translateX(-50%) rotate(45deg);
  }
  .bg-marker-val {
    position: absolute;
    bottom: calc(100% + 5px);
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 15px;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .bg-labels {
    display: flex;
  }
  .bg-label {
    flex: 1;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 2px;
  }
  .bg-label.on {
    color: var(--text-primary);
    font-weight: 700;
  }
  @media (prefers-reduced-motion: reduce) {
    .bg-seg {
      transition: none;
    }
  }
</style>
