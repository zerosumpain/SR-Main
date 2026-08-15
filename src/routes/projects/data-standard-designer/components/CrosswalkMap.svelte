<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { crosswalkColorKey } from '../lib/engine';

  // Controls
  let showCrossLinks = $state(false);
  let showWider = $state(false);
  let view = $state<'radial' | 'bipartite'>('radial');
  let openId = $state<string | null>(null);

  const net = $derived(app.crosswalkNet);
  const edges = $derived(app.crosswalkEdges);

  // 6-hue palette keyed by shared identifier, so a given identifier always
  // paints the same colour. Warm-brutalist friendly.
  const PALETTE = ['#c1572b', '#2a6f97', '#2a9d6a', '#8a5a9e', '#b88a2a', '#4a4a8a'];
  const colorOf = (key: string) => PALETTE[crosswalkColorKey(key)];

  const CX = 300, CY = 215, R = 140, R2 = 205, NODE = 30, ONODE = 19;
  const trunc = (s: string, n = 13) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // Inner node positions on a circle.
  const innerPos = $derived.by(() =>
    net.inner.map((n, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, net.inner.length)) * 2 * Math.PI;
      return { ...n, a, x: CX + R * Math.cos(a), y: CY + R * Math.sin(a), color: colorOf(n.colorKey) };
    }),
  );
  const posById = $derived(new Map(innerPos.map((p) => [p.id, p])));

  // 2nd-order node positions: fan out around their "through" inner node.
  const outerPos = $derived.by(() => {
    const byThrough = new Map<string, typeof net.secondOrder>();
    for (const so of net.secondOrder) {
      if (!byThrough.has(so.throughId)) byThrough.set(so.throughId, []);
      byThrough.get(so.throughId)!.push(so);
    }
    const out: { id: string; name: string; throughId: string; x: number; y: number }[] = [];
    for (const [throughId, list] of byThrough) {
      const p = posById.get(throughId);
      if (!p) continue;
      list.forEach((so, k) => {
        const spread = (k - (list.length - 1) / 2) * 0.42;
        const a = p.a + spread;
        out.push({ id: so.id, name: so.name, throughId, x: CX + R2 * Math.cos(a), y: CY + R2 * Math.sin(a) });
      });
    }
    return out;
  });

  // Drill-down: the field-level edges for the opened node.
  const openEdges = $derived(openId ? edges.filter((e) => e.standardId === openId) : []);
  const openInner = $derived(openId ? net.inner.find((i) => i.id === openId) : undefined);
  const openOuter = $derived(openId ? net.secondOrder.find((s) => s.id === openId) : undefined);

  function nodeClick(id: string) { openId = openId === id ? null : id; }

  // Bipartite data: fields that participate, and the standards they join.
  const fieldNodes = $derived([...new Set(edges.map((e) => e.fieldName))]);
  function quad(x1: number, y1: number, x2: number, y2: number) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    // pull control toward centre so cross-arcs bow inward
    const cx = mx + (CX - mx) * 0.35, cy = my + (CY - my) * 0.35;
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  }
</script>

<div class="xmap">
  <div class="controls">
    <div class="seg">
      <button class:on={view === 'radial'} onclick={() => (view = 'radial')}>Radial</button>
      <button class:on={view === 'bipartite'} onclick={() => (view = 'bipartite')}>Bipartite</button>
    </div>
    {#if view === 'radial'}
      <label class="tg"><input type="checkbox" bind:checked={showCrossLinks} /> Cross-links</label>
      <label class="tg"><input type="checkbox" bind:checked={showWider} /> Wider network (2nd-order)</label>
    {/if}
  </div>

  {#if !net.inner.length}
    <p class="empty">No crosswalk yet. Reuse an identifier or pull a field from the library on the <a href="/projects/data-standard-designer/schema">Schema</a> step, and the relationship map appears here.</p>
  {:else if view === 'radial'}
    <div class="canvas">
      <svg viewBox="0 0 600 440" role="img" aria-label="Crosswalk relationship map">
        <!-- 2nd-order edges -->
        {#if showWider}
          {#each outerPos as o}
            {@const p = posById.get(o.throughId)}
            {#if p}<line x1={p.x} y1={p.y} x2={o.x} y2={o.y} stroke="var(--text-ghost)" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.7" />{/if}
          {/each}
        {/if}
        <!-- cross-links -->
        {#if showCrossLinks}
          {#each net.crossLinks as cl}
            {@const a = posById.get(cl.a)}{@const b = posById.get(cl.b)}
            {#if a && b}<path d={quad(a.x, a.y, b.x, b.y)} fill="none" stroke="var(--text-muted)" stroke-width="1.6" opacity="0.55" />{/if}
          {/each}
        {/if}
        <!-- spokes -->
        {#each innerPos as p}
          <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={p.color} stroke-width={Math.min(7, 2 + p.linkCount)} stroke-linecap="round" />
        {/each}
        <!-- 2nd-order nodes -->
        {#if showWider}
          {#each outerPos as o}
            <g class="node outer" onclick={() => nodeClick(o.id)} role="button" tabindex="0">
              <circle cx={o.x} cy={o.y} r={ONODE} fill="var(--surface-elevated)" stroke="var(--text-ghost)" stroke-dasharray="3 2" />
              <text x={o.x} y={o.y + 3} text-anchor="middle">{trunc(o.name, 10)}</text>
            </g>
          {/each}
        {/if}
        <!-- inner nodes -->
        {#each innerPos as p}
          <g class="node" class:sel={openId === p.id} onclick={() => nodeClick(p.id)} role="button" tabindex="0">
            <circle cx={p.x} cy={p.y} r={NODE} fill="var(--card-bg)" stroke={p.color} stroke-width="2" />
            <text x={p.x} y={p.y + 3} text-anchor="middle">{trunc(p.name)}</text>
          </g>
        {/each}
        <!-- centre -->
        <circle cx={CX} cy={CY} r="40" fill="var(--text-primary)" />
        <text x={CX} y={CY - 2} text-anchor="middle" class="ctr">YOUR</text>
        <text x={CX} y={CY + 11} text-anchor="middle" class="ctr">STANDARD</text>
      </svg>
    </div>
    <div class="legend">
      <span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--accent)" stroke-width="4" /></svg> your join (thicker = more links)</span>
      <span><svg width="22" height="8"><path d="M0,6 Q11,0 22,6" stroke="var(--text-muted)" stroke-width="1.6" fill="none" /></svg> standards cross-link</span>
      <span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--text-ghost)" stroke-width="1.3" stroke-dasharray="4 3" /></svg> 2nd-order neighbour</span>
    </div>
  {:else}
    <!-- bipartite -->
    <div class="canvas">
      <svg viewBox="0 0 600 {Math.max(160, Math.max(fieldNodes.length, net.inner.length) * 42 + 30)}" role="img" aria-label="Field to standard connections">
        {#each edges as e}
          {@const li = fieldNodes.indexOf(e.fieldName)}
          {@const ri = net.inner.findIndex((s) => s.id === e.standardId)}
          {#if li >= 0 && ri >= 0}
            <path d={`M180,${li * 42 + 40} C300,${li * 42 + 40} 300,${ri * 42 + 40} 420,${ri * 42 + 40}`} fill="none" stroke={colorOf(e.via)} stroke-width="2" opacity="0.6" />
          {/if}
        {/each}
        {#each fieldNodes as fn, i}
          <g><rect x="20" y={i * 42 + 28} width="160" height="24" rx="5" fill="var(--surface-elevated)" stroke="var(--card-border)" /><text x="172" y={i * 42 + 44} text-anchor="end" class="bp">{trunc(fn, 18)}</text></g>
        {/each}
        {#each net.inner as s, i}
          <g class="node" onclick={() => nodeClick(s.id)} role="button" tabindex="0"><rect x="420" y={i * 42 + 28} width="160" height="24" rx="5" fill="var(--card-bg)" stroke={colorOf(s.colorKey)} /><text x="428" y={i * 42 + 44} class="bp">{trunc(s.name, 18)}</text></g>
        {/each}
      </svg>
    </div>
    <p class="bp-note">Left = your fields · right = standards they join · click a standard for the links.</p>
  {/if}

  <!-- drill-down panel -->
  {#if openId}
    <div class="drill">
      {#if openInner}
        <div class="drill-head"><b>{openInner.name}</b><span class="dsd-pill ok">{openEdges.length} link{openEdges.length === 1 ? '' : 's'}</span></div>
        <ul>
          {#each openEdges as e}
            <li><span class="fld">{e.fieldName}</span><span class="arrow">→</span><span class="via">{e.nature.replace(/-/g, ' ')} · via {e.via}</span></li>
          {/each}
        </ul>
      {:else if openOuter}
        <div class="drill-head"><b>{openOuter.name}</b><span class="dsd-pill muted">2nd-order</span></div>
        <p class="reach">One hop away — reachable through <b>{openOuter.throughName}</b>. Align with it to connect your standard here too.</p>
        <button class="dsd-btn sm" onclick={() => app.openStandard(openOuter.id)}>Explore {openOuter.name} →</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .xmap { margin: 8px 0 4px; }
  .controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
  .seg { display: inline-flex; border: 1.5px solid var(--card-border); border-radius: var(--radius-pill); overflow: hidden; }
  .seg button { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; padding: 6px 14px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); }
  .seg button.on { background: var(--accent); color: #fff; }
  .tg { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); cursor: pointer; }

  .canvas { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); background: var(--card-bg); padding: 8px; }
  .canvas svg { width: 100%; height: auto; display: block; }
  .node { cursor: pointer; }
  .node text { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--text-primary); pointer-events: none; }
  .node.outer text { font-size: var(--fs-label-xs); fill: var(--text-muted); }
  .node:hover circle, .node:hover rect { filter: brightness(1.08); }
  .node.sel circle { stroke-width: 3.5; }
  .ctr { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--bg); pointer-events: none; }
  .bp { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--text-primary); pointer-events: none; }

  .legend { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; font-size: var(--fs-label-xs); color: var(--text-muted); margin-top: 8px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .bp-note { font-size: var(--fs-label-xs); color: var(--text-muted); text-align: center; margin: 8px 0 0; }
  .empty { font-size: var(--fs-label); color: var(--text-muted); font-style: italic; }
  .empty a { color: var(--accent); }

  .drill { margin-top: 12px; border: 1.5px solid var(--accent); border-radius: var(--radius-sharp); padding: 12px 14px; background: var(--accent-tint-04); }
  .drill-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .drill-head b { font-size: var(--fs-nav); color: var(--text-primary); }
  .drill ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .drill li { display: flex; gap: 7px; align-items: baseline; font-size: var(--fs-label); }
  .fld { color: var(--text-primary); font-weight: 600; }
  .arrow { color: var(--accent); }
  .via { color: var(--text-muted); font-size: var(--fs-label-xs); }
  .reach { font-size: var(--fs-label); color: var(--text-secondary); line-height: 1.5; margin: 0 0 8px; }
</style>
