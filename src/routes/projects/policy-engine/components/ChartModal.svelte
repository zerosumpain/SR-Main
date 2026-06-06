<script lang="ts">
  import OutcomeChart, { type ChartSeries } from './OutcomeChart.svelte';

  interface Props {
    title: string;
    unit: string;
    years: number[];
    series: ChartSeries[];
    baseYear: number;
    horizonYear: number;
    target?: { value: number; label: string } | null;
    dp: number;
    zeroBased?: boolean;
    narrative: string;
    onClose: () => void;
  }
  let { title, unit, years, series, baseYear, horizonYear, target = null, dp, zeroBased = false, narrative, onClose }: Props = $props();

  let card: HTMLDivElement;
  let copied = $state(false);

  function copyNarrative() {
    const text = `${title} (${unit}) — Education Policy Modelling\n\n${narrative}`;
    navigator.clipboard?.writeText(text).then(() => { copied = true; setTimeout(() => (copied = false), 1600); }).catch(() => {});
  }

  function downloadCsv() {
    const header = ['year', ...series.map((s) => s.label.replace(/[,\n]/g, ' '))];
    const lines = [header.join(',')];
    years.forEach((yr, i) => {
      lines.push([yr, ...series.map((s) => (isFinite(s.values[i]) ? s.values[i] : ''))].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function downloadPng() {
    const svg = card?.querySelector('svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const vb = svg.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : svg.clientWidth || 800;
    const h = vb && vb.height ? vb.height : svg.clientHeight || 300;
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale; canvas.height = h * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#f1ead6'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  }

  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="card" bind:this={card} onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
    <div class="m-head">
      <div>
        <h3>{title}</h3>
        <span class="m-unit">{unit}</span>
      </div>
      <button class="m-close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="m-chart">
      <OutcomeChart {title} {unit} {years} {series} {baseYear} {horizonYear} {target} {dp} {zeroBased} height={520} />
    </div>

    <div class="m-narrative">
      <span class="m-nlabel">Narrative</span>
      <p>{narrative}</p>
    </div>

    <div class="m-actions">
      <button class="m-act primary" onclick={copyNarrative}>{copied ? '✓ Copied' : 'Copy narrative'}</button>
      <button class="m-act" onclick={downloadCsv}>Download data (CSV)</button>
      <button class="m-act" onclick={downloadPng}>Download chart (PNG)</button>
      <span class="m-src">Education Policy Modelling · strangeramblings.com/projects/policy-engine</span>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 200; background: rgba(28,22,17,0.4); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: var(--paper, #f1ead6); border: 1px solid rgba(28,22,17,0.2); border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,0.3); width: min(1180px, 95vw); max-height: 94vh; overflow-y: auto; padding: 18px 22px; font-family: 'DM Sans', system-ui, sans-serif; }
  .m-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; margin: 0; color: var(--ink, #1c1611); }
  .m-unit { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); }
  .m-close { background: none; border: 1px solid rgba(28,22,17,0.2); border-radius: 6px; width: 28px; height: 28px; cursor: pointer; color: var(--ink, #1c1611); font-size: 13px; flex-shrink: 0; }
  .m-close:hover { background: rgba(28,22,17,0.06); }
  .m-chart { margin-bottom: 10px; }
  .m-narrative { background: rgba(28,22,17,0.045); border-left: 3px solid var(--ink, #1c1611); border-radius: 5px; padding: 9px 12px; margin-bottom: 12px; }
  .m-nlabel { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); }
  .m-narrative p { margin: 3px 0 0; font-size: 13px; line-height: 1.55; color: var(--ink, #1c1611); }
  .m-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .m-act { font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 6px 12px; border-radius: 7px; border: 1px solid rgba(28,22,17,0.25); background: rgba(255,255,255,0.5); color: var(--ink, #1c1611); cursor: pointer; }
  .m-act:hover { background: rgba(28,22,17,0.06); }
  .m-act.primary { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border-color: var(--ink, #1c1611); }
  .m-src { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.4); }
  @media (max-width: 560px) { .m-src { display: none; } }
</style>
