<script lang="ts">
  // SystemMap — the whole architecture in one frame, six bands deep.
  //
  // The interaction is the point: with nothing hovered, the flows sit faint and you read the
  // shape. Hover any box and only its own connections light up, so you can trace one path
  // through six layers without a hairball of nineteen crossing lines.
  //
  // Rendering rules (svelte5-pitfalls §1): no timers held in $state; structure always drawn.
  import { goto } from '$app/navigation';
  import { BANDS, NODES, FLOWS, type MapNode } from '../lib/system';
  import { app } from '../lib/appState.svelte';

  let hover = $state<string | null>(null);
  const eli = $derived(app.narrative === 'eli5');

  // ---- geometry (viewBox 1000 × H) ----------------------------------------
  const W = 1000;
  const LX = 112;
  const RPAD = 14;
  const COLS = 8;
  const GAP = 8;
  const COLW = (W - LX - RPAD - GAP * (COLS - 1)) / COLS;
  const BAND_H = 66;
  const NH = 40;
  const TOP = 6;

  const bandY = (i: number) => TOP + i * BAND_H;
  const bandIdx = (b: string) => BANDS.findIndex((x) => x.id === b);
  const nodeY = (n: MapNode) => bandY(bandIdx(n.band)) + (BAND_H - NH) / 2;
  const nodeX = (n: MapNode) => LX + n.col * (COLW + GAP);
  const nodeW = (n: MapNode) => (n.span ?? 1) * COLW + ((n.span ?? 1) - 1) * GAP;
  const nodeCx = (n: MapNode) => nodeX(n) + nodeW(n) / 2;
  const H = TOP + BANDS.length * BAND_H + 26;

  const byId = new Map(NODES.map((n) => [n.id, n]));

  // Which nodes are connected to the hovered one (either direction)?
  const lit = $derived.by(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    for (const f of FLOWS) {
      if (f.from === hover) s.add(f.to);
      if (f.to === hover) s.add(f.from);
    }
    return s;
  });

  const flowLit = (f: { from: string; to: string }) => !!hover && (f.from === hover || f.to === hover);
  const nodeDim = (id: string) => !!lit && !lit.has(id);

  /** Cubic bezier between two node boxes, leaving from the lower edge and arriving at the upper. */
  function path(f: { from: string; to: string }): string {
    const a = byId.get(f.from);
    const b = byId.get(f.to);
    if (!a || !b) return '';
    const ay = nodeY(a);
    const by = nodeY(b);
    const down = by > ay;
    const y1 = down ? ay + NH : ay;
    const y2 = down ? by : by + NH;
    const x1 = nodeCx(a);
    const x2 = nodeCx(b);
    const dy = Math.abs(y2 - y1);
    const c = Math.max(18, dy * 0.45);
    return `M ${x1} ${y1} C ${x1} ${down ? y1 + c : y1 - c}, ${x2} ${down ? y2 - c : y2 + c}, ${x2} ${y2}`;
  }

  const hoveredNode = $derived(hover ? byId.get(hover) ?? null : null);

  function open(n: MapNode) {
    if (n.section) goto(`/projects/engine-room/${n.section}`);
  }
</script>

<div class="sm">
  <div class="sm-scroll">
    <svg viewBox="0 0 {W} {H}" role="img"
      aria-label="The system as six stacked bands: surfaces, engines, reasoning, memory, the outside world, and the infrastructure it runs on. Boxes are components; curves are the flows between them.">

      <!-- ---- band backgrounds + gutter labels ---- -->
      {#each BANDS as b, i}
        {@const y = bandY(i)}
        <rect x="0" y={y} width={W} height={BAND_H - 4} rx="6" class="band" class:alt={i % 2 === 1} />
        <text x="10" y={y + 21} class="band-no">{b.no}</text>
        <text x="27" y={y + 21} class="band-name">{eli ? b.eli5Name : b.name}</text>
        <text x="10" y={y + 36} class="band-blurb">
          {(eli ? b.eli5Blurb : b.blurb).slice(0, 44)}{(eli ? b.eli5Blurb : b.blurb).length > 44 ? '…' : ''}
        </text>
      {/each}

      <!-- ---- flows, drawn behind the boxes ---- -->
      <g class="flows">
        {#each FLOWS as f}
          <path d={path(f)} class="flow" class:lit={flowLit(f)} class:dim={!!hover && !flowLit(f)} />
        {/each}
      </g>

      <!-- ---- nodes ---- -->
      {#each NODES as n}
        {@const x = nodeX(n)}
        {@const y = nodeY(n)}
        {@const w = nodeW(n)}
        <g class="node" class:key={n.key} class:on={hover === n.id} class:dim={nodeDim(n.id)}
           class:clickable={!!n.section}
           role="button" tabindex="0"
           aria-label="{n.label} — {n.what}{n.section ? '. Opens the ' + n.section + ' section.' : ''}"
           onmouseenter={() => (hover = n.id)}
           onmouseleave={() => (hover = null)}
           onfocus={() => (hover = n.id)}
           onblur={() => (hover = null)}
           onclick={() => open(n)}
           onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n); } }}>
          <rect {x} {y} width={w} height={NH} rx="5" class="nbox" />
          <text x={x + w / 2} y={y + NH / 2 + 4} text-anchor="middle" class="nlabel">{n.label}</text>
          {#if n.section}
            <circle cx={x + w - 8} cy={y + 8} r="2" class="ndot" />
          {/if}
        </g>
      {/each}

      <text x="0" y={H - 8} class="key-note">
        HOVER A BOX TO LIGHT ITS CONNECTIONS · A DOT MEANS THAT BOX HAS A SECTION — CLICK TO OPEN IT
      </text>
    </svg>
  </div>

  <!-- readout: fixed height so the map does not jump as you move across it -->
  <div class="sm-read" class:active={!!hoveredNode}>
    {#if hoveredNode}
      <span class="sr-band">{BANDS[bandIdx(hoveredNode.band)].name.toUpperCase()}</span>
      <b class="sr-label">{hoveredNode.label}</b>
      <span class="sr-what">{hoveredNode.what}</span>
      {#if hoveredNode.section}<span class="sr-go">click to open →</span>{/if}
    {:else}
      <!-- The legend above already says how to drive it; this line only names the axis. -->
      <span class="sr-idle">Above the line, ways in. Below it, what actually happens.</span>
    {/if}
  </div>
</div>

<style>
  .sm { margin: 14px 0 6px; }
  .sm-scroll { overflow-x: auto; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.4); padding: 8px 10px; }
  .sm-scroll svg { display: block; min-width: 880px; width: 100%; height: auto; }

  .band { fill: rgba(28,22,17,0.028); }
  .band.alt { fill: rgba(28,22,17,0.055); }
  .band-no { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; fill: var(--accent-ink); }
  .band-name { font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 600; fill: #1c1611; }
  .band-blurb { font-family: 'DM Sans', sans-serif; font-size: 7.5px; fill: rgba(28,22,17,0.5); }

  .flow { fill: none; stroke: var(--accent-ink); stroke-width: 1.1; opacity: 0.13; transition: opacity 0.15s, stroke-width 0.15s; }
  .flow.lit { opacity: 0.8; stroke-width: 2; }
  .flow.dim { opacity: 0.035; }

  .node { transition: opacity 0.15s; }
  .node.clickable { cursor: pointer; }
  .node.dim { opacity: 0.3; }
  .nbox { fill: rgba(255,255,255,0.86); stroke: rgba(28,22,17,0.2); stroke-width: 1; transition: fill 0.14s, stroke 0.14s; }
  .node.key .nbox { fill: #fdfbf6; stroke: rgba(28,22,17,0.42); stroke-width: 1.5; }
  .node.on .nbox { fill: var(--accent-ink); stroke: var(--accent-ink); }
  .nlabel { font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 500; fill: #1c1611; transition: fill 0.14s; }
  .node.key .nlabel { font-weight: 600; }
  .node.on .nlabel { fill: #fff; }
  .ndot { fill: var(--accent); opacity: 0.75; }
  .node.on .ndot { fill: #fff; }
  .node:focus { outline: none; }
  .node:focus-visible .nbox { stroke: var(--accent); stroke-width: 2.5; }

  .key-note { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.08em; fill: rgba(28,22,17,0.4); }

  .sm-read { margin-top: 9px; min-height: 42px; display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap;
    padding: 9px 13px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.12);
    background: rgba(255,255,255,0.4); transition: border-color 0.15s, background 0.15s; }
  .sm-read.active { border-color: var(--accent-ink-tint-35, rgba(14,91,102,0.35)); background: var(--accent-ink-tint-12); }
  .sr-band { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.12em; color: var(--accent-ink); }
  .sr-label { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .sr-what { font-size: 13px; line-height: 1.5; color: rgba(28,22,17,0.72); flex: 1 1 260px; min-width: 0; }
  .sr-go { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent); white-space: nowrap; }
  .sr-idle { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.58); max-width: 92ch; }
</style>
