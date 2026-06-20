<script lang="ts">
  import { FRAMEWORKS } from '../lib/frameworks';
  import type { Framework } from '../lib/types';

  const W = 720, H = 400, L = 30, R = 30, T = 40, B = 40;
  const w = (f: Framework) => f.weight ?? 0.5;
  const px = (wt: number) => L + ((Math.max(0.35, Math.min(1, wt)) - 0.35) / 0.65) * (W - L - R);

  // y: uk-gov in the upper band, corporate in the lower; jitter within each to avoid overlap
  const placed = $derived.by(() => {
    const gov = FRAMEWORKS.filter((f) => f.type === 'uk-gov');
    const corp = FRAMEWORKS.filter((f) => f.type === 'corporate');
    const yFor = (list: Framework[], f: Framework, base: number, spread: number) => {
      const i = list.indexOf(f);
      const n = list.length;
      return base + (n > 1 ? ((i / (n - 1)) - 0.5) * spread : 0);
    };
    const midTop = T + (H - T - B) * 0.3;
    const midBot = T + (H - T - B) * 0.74;
    return FRAMEWORKS.map((f) => ({
      f,
      x: px(w(f)),
      y: f.type === 'uk-gov' ? yFor(gov, f, midTop, 120) : yFor(corp, f, midBot, 90),
    }));
  });

  // weight bands
  const SPEC = px(0.55), FOUND = px(0.8);
  let hovered = $state<string | null>(null);
  const hov = $derived(FRAMEWORKS.find((f) => f.id === hovered) ?? null);
  const ordered = $derived([...placed].sort((a, b) => (a.f.id === hovered ? 1 : b.f.id === hovered ? -1 : 0)));
  const col = (f: Framework) => (f.type === 'uk-gov' ? '#2f6155' : '#7a5aa6');
  const r = (f: Framework) => 7 + w(f) * 9;
</script>

<div class="fmap">
  <svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Frameworks by how foundational they are">
    <!-- weight bands -->
    <rect x={L} y={T} width={SPEC - L} height={H - T - B} fill="rgba(28,22,17,0.03)" />
    <rect x={FOUND} y={T} width={W - R - FOUND} height={H - T - B} fill="rgba(47,97,85,0.06)" />
    <text x={(L + SPEC) / 2} y={T - 14} text-anchor="middle" class="band dim">SPECIALIST</text>
    <text x={(SPEC + FOUND) / 2} y={T - 14} text-anchor="middle" class="band dim">CORE</text>
    <text x={(FOUND + W - R) / 2} y={T - 14} text-anchor="middle" class="band">FOUNDATIONAL</text>
    <line x1={SPEC} y1={T} x2={SPEC} y2={H - B} stroke="rgba(28,22,17,0.12)" stroke-dasharray="2 4" />
    <line x1={FOUND} y1={T} x2={FOUND} y2={H - B} stroke="rgba(28,22,17,0.12)" stroke-dasharray="2 4" />
    <text x={L + 4} y={H - B + 26} text-anchor="start" class="ax">← reach for when relevant · should shape everything →</text>

    {#each ordered as d (d.f.id)}
      {@const active = hovered === d.f.id}
      {@const left = d.x > px(0.78)}
      <g role="button" tabindex="0" aria-label={d.f.name}
        onmouseenter={() => (hovered = d.f.id)} onmouseleave={() => (hovered = null)}
        onfocus={() => (hovered = d.f.id)} onblur={() => (hovered = null)} style="cursor:pointer">
        <circle cx={d.x} cy={d.y} r={active ? r(d.f) + 3 : r(d.f)} fill={col(d.f)} fill-opacity={active ? 0.95 : 0.72} stroke="#f1ead6" stroke-width="1.5" />
        <text x={left ? d.x - r(d.f) - 6 : d.x + r(d.f) + 6} y={d.y + 3} text-anchor={left ? 'end' : 'start'} class="lab" class:active>{d.f.name.replace(/ \(.*\)/, '')}</text>
      </g>
    {/each}
  </svg>

  <div class="side">
    <div class="legend">
      <span class="lg"><i style="background:#2f6155"></i>UK government</span>
      <span class="lg"><i style="background:#7a5aa6"></i>Corporate / industry</span>
    </div>
    <div class="detail" class:show={!!hov}>
      {#if hov}
        <span class="d-role">{hov.role ?? 'framework'} · {hov.type === 'uk-gov' ? 'UK gov' : 'corporate'}</span>
        <h4>{hov.name}</h4>
        <p class="d-sum">{hov.summary}</p>
      {:else}
        <span class="d-empty">Hover a framework. The further right, the more it should shape DfE’s strategy from the start; the left-hand ones are specialist tools for a narrow need.</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .fmap { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(210px, 0.9fr); gap: 14px 20px; align-items: start; }
  svg { display: block; overflow: visible; }
  .band { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; letter-spacing: 0.14em; fill: #2f6155; }
  .band.dim { fill: rgba(28,22,17,0.4); }
  .ax { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; fill: rgba(28,22,17,0.45); }
  .lab { font-family: 'DM Sans', sans-serif; font-size: 10.5px; fill: rgba(28,22,17,0.72); }
  .lab.active { font-weight: 600; fill: var(--ink); }
  .side { display: flex; flex-direction: column; gap: 12px; }
  .legend { display: flex; flex-direction: column; gap: 4px; }
  .lg { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.65); }
  .lg i { width: 11px; height: 11px; border-radius: var(--radius-pill); }
  .detail { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 13px 15px; min-height: 140px; }
  .detail.show { background: rgba(255,255,255,0.75); }
  .d-role { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; color: rgba(28,22,17,0.55); }
  .detail h4 { margin: 5px 0 5px; font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--ink); line-height: 1.2; }
  .d-sum { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .d-empty { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.5); }
  @media (max-width: 820px) { .fmap { grid-template-columns: 1fr; } }
</style>
