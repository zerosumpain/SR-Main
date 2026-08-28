<script lang="ts">
  import { PRESSURES } from '$lib/dfe-data-strategy/pressures';
  import { app } from '../lib/appState.svelte';
  import type { Origin } from '$lib/dfe-data-strategy/types';

  const ORIGIN_COL: Record<Origin, string> = { 'cross-government': '#2f6155', 'dfe-policy': '#8a2d3a', partners: '#2f6f97' };
  const ORIGIN_LABEL: Record<Origin, string> = { 'cross-government': 'Cross-government', 'dfe-policy': 'The department policy', partners: 'Partners' };

  const W = 720, H = 480, L = 56, R = 30, T = 30, B = 52;
  const px = (sev: number) => L + ((sev - 0.5) / 5) * (W - L - R);
  const py = (urg: number) => T + (1 - (urg - 0.5) / 5) * (H - T - B);

  // jitter points that share a (severity, urgency) cell so they don't overlap
  const placed = $derived.by(() => {
    const counts = new Map<string, number>();
    return PRESSURES.map((p) => {
      const key = `${p.severity},${p.urgency}`;
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      const ring = Math.floor(n / 6), slot = n % 6;
      const ang = (slot / 6) * Math.PI * 2;
      const rad = 9 + ring * 14;
      return { p, x: px(p.severity) + Math.cos(ang) * rad * (n ? 1 : 0), y: py(p.urgency) + Math.sin(ang) * rad * (n ? 1 : 0) };
    });
  });

  let hovered = $state<string | null>(null);
  const hov = $derived(PRESSURES.find((p) => p.id === hovered) ?? null);
  const ordered = $derived([...placed].sort((a, b) => (a.p.id === hovered ? 1 : b.p.id === hovered ? -1 : 0)));
</script>

<div class="pmap">
  <svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Pressures by severity and urgency">
    <!-- quadrant tints -->
    <rect x={px(3)} y={T} width={W - R - px(3)} height={py(3) - T} fill="rgba(177,69,94,0.07)" />
    <rect x={L} y={py(3)} width={W - R - L} height={H - B - py(3)} fill="rgba(28,22,17,0.025)" />
    <line x1={px(3)} y1={T} x2={px(3)} y2={H - B} stroke="rgba(28,22,17,0.14)" stroke-dasharray="2 4" />
    <line x1={L} y1={py(3)} x2={W - R} y2={py(3)} stroke="rgba(28,22,17,0.14)" stroke-dasharray="2 4" />
    <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="none" stroke="rgba(28,22,17,0.18)" />

    <text x={W - R - 8} y={T + 16} text-anchor="end" class="q">ACT NOW</text>
    <text x={L + 8} y={T + 16} text-anchor="start" class="q dim">MONITOR</text>
    <text x={W - R - 8} y={H - B - 8} text-anchor="end" class="q dim">PLAN FOR</text>
    <text x={L + 8} y={H - B - 8} text-anchor="start" class="q dim">BACKGROUND</text>
    <text x={(L + W - R) / 2} y={H - 12} text-anchor="middle" class="ax">Severity →</text>
    <text x={15} y={(T + H - B) / 2} text-anchor="middle" class="ax" transform="rotate(-90 15 {(T + H - B) / 2})">Urgency →</text>

    {#each ordered as d (d.p.id)}
      {@const active = hovered === d.p.id}
      <g role="button" tabindex="0" aria-label={d.p.title}
        onmouseenter={() => (hovered = d.p.id)} onmouseleave={() => (hovered = null)}
        onfocus={() => (hovered = d.p.id)} onblur={() => (hovered = null)}
        onclick={() => app.openSuggest({ kind: 'pressure', id: d.p.id, label: d.p.title })}
        onkeydown={(e) => { if (e.key === 'Enter') app.openSuggest({ kind: 'pressure', id: d.p.id, label: d.p.title }); }}
        style="cursor:pointer">
        <circle cx={d.x} cy={d.y} r={active ? 9 : 6} fill={ORIGIN_COL[d.p.origin]} fill-opacity={active ? 0.95 : 0.74} stroke="#f1ead6" stroke-width="1.5" />
      </g>
    {/each}
  </svg>

  <div class="side">
    <div class="legend">
      {#each Object.entries(ORIGIN_LABEL) as [k, label]}
        <span class="lg"><i style="background:{ORIGIN_COL[k as Origin]}"></i>{label}</span>
      {/each}
    </div>
    <div class="detail" class:show={!!hov}>
      {#if hov}
        <span class="d-org" style="color:{ORIGIN_COL[hov.origin]}">{ORIGIN_LABEL[hov.origin]}</span>
        <h4>{hov.title}</h4>
        <p class="d-su">Severity {hov.severity}/5 · Urgency {hov.urgency}/5</p>
        <p class="d-desc">{hov.description}</p>
        <span class="d-hint">Click a point to draft policies for it.</span>
      {:else}
        <span class="d-empty">Hover a pressure. Top-right is what should command attention first; click any point to draft policies.</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .pmap { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(210px, 0.9fr); gap: 14px 20px; align-items: start; }
  svg { display: block; }
  .q { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.14em; fill: #b1455e; }
  .q.dim { fill: rgba(28,22,17,0.4); }
  .ax { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.5); }
  .side { display: flex; flex-direction: column; gap: 12px; }
  .legend { display: flex; flex-direction: column; gap: 4px; }
  .lg { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.65); }
  .lg i { width: 11px; height: 11px; border-radius: var(--radius-pill); }
  .detail { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.5); padding: 13px 15px; min-height: 150px; }
  .detail.show { background: rgba(255,255,255,0.75); }
  .d-org { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
  .detail h4 { margin: 6px 0 4px; font-family: var(--fs-serif); font-size: var(--fs-body); font-weight: 600; color: var(--ink); line-height: 1.2; }
  .d-su { margin: 0 0 7px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }
  .d-desc { margin: 0 0 7px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .d-hint, .d-empty { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.5); }
  @media (max-width: 820px) { .pmap { grid-template-columns: 1fr; } }
</style>
