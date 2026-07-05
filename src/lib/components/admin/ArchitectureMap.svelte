<script lang="ts">
  import type { ArchGroup, ArchNode, ArchEdge, HealthStatus } from '$lib/architecture/topology';

  let {
    groups,
    nodes,
    edges,
    health,
  }: {
    groups: ArchGroup[];
    nodes: ArchNode[];
    edges: ArchEdge[];
    health: Record<string, HealthStatus>;
  } = $props();

  const PROVIDER_COLOR: Record<ArchGroup['provider'], string> = {
    client: '#8a8f98',
    cloudflare: '#f38020',
    hetzner: '#c0395a',
    home: '#3a7d6e',
    azure: '#2a7de1',
    google: '#ea4335',
    llm: '#7c5cbf',
    messaging: '#25d366',
    backup: '#b08935',
  };
  const STATUS_COLOR: Record<HealthStatus, string> = {
    up: '#3fb27f',
    degraded: '#e0a03c',
    down: '#e05656',
    unknown: '#8a8f98',
    static: 'transparent',
  };
  const STATUS_LABEL: Record<HealthStatus, string> = {
    up: 'up', degraded: 'degraded', down: 'unreachable', unknown: 'not probed', static: '',
  };

  const NW = 176, NH = 48, NODE_GAP = 11, GHEAD = 26, GPAD = 12, GGAP = 22, COLGAP = 80, M = 18;

  const providerOf = (groupId: string) => groups.find((g) => g.id === groupId)?.provider ?? 'client';
  const statusOf = (n: ArchNode): HealthStatus => (n.healthId ? (health[n.healthId] ?? 'unknown') : 'static');

  const layout = $derived.by(() => {
    const cols = [...new Set(groups.map((g) => g.col))].sort((a, b) => a - b);
    const colX: Record<number, number> = {};
    cols.forEach((c, i) => (colX[c] = M + i * (NW + GPAD * 2 + COLGAP)));
    const groupW = NW + GPAD * 2;

    const placedGroups: (ArchGroup & { x: number; y: number; w: number; h: number })[] = [];
    const placedNodes: Record<string, { x: number; y: number }> = {};
    const colY: Record<number, number> = {};
    cols.forEach((c) => (colY[c] = M));

    for (const g of groups) {
      const gnodes = nodes.filter((n) => n.group === g.id);
      const gx = colX[g.col];
      const gy = colY[g.col];
      const inner = gnodes.length * NH + Math.max(0, gnodes.length - 1) * NODE_GAP;
      const gh = GHEAD + GPAD + inner + GPAD;
      placedGroups.push({ ...g, x: gx, y: gy, w: groupW, h: gh });
      gnodes.forEach((n, i) => {
        placedNodes[n.id] = { x: gx + GPAD, y: gy + GHEAD + GPAD + i * (NH + NODE_GAP) };
      });
      colY[g.col] = gy + gh + GGAP;
    }

    const W = Math.max(...cols.map((c) => colX[c])) + groupW + M;
    const H = Math.max(...Object.values(colY)) - GGAP + M;

    const placedEdges = edges
      .map((e) => {
        const s = placedNodes[e.from];
        const t = placedNodes[e.to];
        if (!s || !t) return null;
        const sCx = s.x + NW / 2, tCx = t.x + NW / 2;
        const rightward = tCx >= sCx;
        const sx = rightward ? s.x + NW : s.x;
        const tx = rightward ? t.x : t.x + NW;
        const sy = s.y + NH / 2, ty = t.y + NH / 2;
        const c = Math.max(28, Math.abs(tx - sx) * 0.5);
        const path = `M${sx},${sy} C${sx + (rightward ? c : -c)},${sy} ${tx + (rightward ? -c : c)},${ty} ${tx},${ty}`;
        const mx = (sx + tx) / 2, my = (sy + ty) / 2;
        return { ...e, path, mx, my };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return { groups: placedGroups, nodePos: placedNodes, edges: placedEdges, W, H };
  });

  let hovered = $state<string | null>(null);

  const connected = $derived.by(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    for (const e of edges) {
      if (e.from === hovered) set.add(e.to);
      if (e.to === hovered) set.add(e.from);
    }
    return set;
  });

  const hoveredNode = $derived(nodes.find((n) => n.id === hovered) ?? null);
  const isEdgeActive = (e: ArchEdge) => !hovered || e.from === hovered || e.to === hovered;
  const isNodeDim = (id: string) => !!hovered && !connected?.has(id);
</script>

<div class="arch">
  <div class="map-scroll">
    <div class="map-inner">
      <svg viewBox="0 0 {layout.W} {layout.H}" width="100%" role="img" aria-label="System architecture map">
        <!-- group boxes -->
        {#each layout.groups as g (g.id)}
          <g class="grp">
            <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="10"
              fill="color-mix(in srgb, {PROVIDER_COLOR[g.provider]} 5%, transparent)"
              stroke="color-mix(in srgb, {PROVIDER_COLOR[g.provider]} 40%, transparent)" stroke-width="1" />
            <rect x={g.x} y={g.y} width="9" height="9" rx="2" transform="translate(11,9)" fill={PROVIDER_COLOR[g.provider]} />
            <text x={g.x + 26} y={g.y + 16} class="grp-lab">{g.label}</text>
          </g>
        {/each}

        <!-- edges -->
        {#each layout.edges as e (e.from + '>' + e.to)}
          <path d={e.path} class="edge edge-{e.kind ?? 'plain'}" class:dim={!isEdgeActive(e)} class:hot={hovered && isEdgeActive(e)} />
          {#if e.label && (!hovered || isEdgeActive(e))}
            <text x={e.mx} y={e.my - 4} class="edge-lab" class:show={hovered && isEdgeActive(e)}>{e.label}</text>
          {/if}
        {/each}

        <!-- nodes -->
        {#each nodes as n (n.id)}
          {@const p = layout.nodePos[n.id]}
          {#if p}
            {@const st = statusOf(n)}
            <foreignObject x={p.x} y={p.y} width={NW} height={NH}
              onmouseenter={() => (hovered = n.id)} onmouseleave={() => (hovered = null)}>
              <div xmlns="http://www.w3.org/1999/xhtml" class="node" class:dim={isNodeDim(n.id)} class:hl={hovered === n.id}
                style="--pc:{PROVIDER_COLOR[providerOf(n.group)]}">
                <div class="node-top">
                  <span class="node-lab" title={n.label}>{n.label}</span>
                  {#if st !== 'static'}
                    <span class="dot" style="background:{STATUS_COLOR[st]}" title={STATUS_LABEL[st]}
                      class:pulse={st === 'up'}></span>
                  {/if}
                </div>
                {#if n.note}<span class="node-note" title={n.note}>{n.note}</span>{/if}
              </div>
            </foreignObject>
          {/if}
        {/each}
      </svg>
    </div>
  </div>

  <aside class="side">
    <div class="detail" class:show={!!hoveredNode}>
      {#if hoveredNode}
        {@const st = statusOf(hoveredNode)}
        <span class="d-kick" style="color:{PROVIDER_COLOR[providerOf(hoveredNode.group)]}">
          {groups.find((g) => g.id === hoveredNode.group)?.label}
        </span>
        <h4>{hoveredNode.label}</h4>
        {#if hoveredNode.note}<p class="d-note">{hoveredNode.note}</p>{/if}
        <div class="d-meta">
          <span class="d-kind">{hoveredNode.kind}</span>
          {#if st !== 'static'}
            <span class="d-status"><span class="dot" style="background:{STATUS_COLOR[st]}"></span>{STATUS_LABEL[st]}</span>
          {/if}
        </div>
        {#if hoveredNode.url}<a class="d-link" href={hoveredNode.url} target="_blank" rel="noreferrer">{hoveredNode.url}</a>{/if}
      {:else}
        <span class="d-empty">Hover a node to inspect it. Live dots show reachability of the probed services; grey dots aren’t probed.</span>
      {/if}
    </div>

    <div class="legend">
      <span class="lg-hd">Providers</span>
      {#each groups as g (g.id)}
        <span class="lg"><i style="background:{PROVIDER_COLOR[g.provider]}"></i>{g.label.split(' · ')[0].split(' (')[0]}</span>
      {/each}
      <span class="lg-hd" style="margin-top:8px">Status</span>
      <span class="lg"><i style="background:{STATUS_COLOR.up}"></i>up</span>
      <span class="lg"><i style="background:{STATUS_COLOR.degraded}"></i>degraded</span>
      <span class="lg"><i style="background:{STATUS_COLOR.down}"></i>unreachable</span>
      <span class="lg"><i style="background:{STATUS_COLOR.unknown}"></i>not probed</span>
    </div>
  </aside>
</div>

<style>
  .arch {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 232px;
    gap: 18px;
    align-items: start;
  }
  .map-scroll { overflow-x: auto; scrollbar-width: thin; }
  .map-inner { min-width: 900px; }
  svg { display: block; overflow: visible; }

  .grp-lab {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    fill: var(--text-secondary);
  }

  .edge { fill: none; stroke: var(--divider); stroke-width: 1.4; }
  .edge-data { stroke: color-mix(in srgb, var(--accent) 55%, var(--divider)); }
  .edge-primary { stroke: color-mix(in srgb, var(--accent) 80%, transparent); stroke-width: 1.8; }
  .edge-backup { stroke-dasharray: 3 4; }
  .edge-control { stroke-dasharray: 1 4; }
  .edge.dim { opacity: 0.12; }
  .edge.hot { stroke: var(--accent); stroke-width: 2.2; }
  .edge-lab {
    font-family: var(--font-mono);
    font-size: 8.5px;
    fill: var(--text-ghost);
    text-anchor: middle;
    opacity: 0;
    pointer-events: none;
  }
  .edge-lab.show { opacity: 1; fill: var(--text-secondary); }

  .node {
    box-sizing: border-box;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 6px 9px;
    border: 1px solid var(--divider);
    border-left: 3px solid var(--pc);
    border-radius: 6px;
    background: var(--surface-elevated, var(--bg));
    cursor: default;
    transition: opacity 0.12s, border-color 0.12s, box-shadow 0.12s;
  }
  .node.hl { border-color: var(--pc); box-shadow: 0 0 0 1px var(--pc); }
  .node.dim { opacity: 0.32; }
  .node-top { display: flex; align-items: center; gap: 6px; }
  .node-lab {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .node-note {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.pulse { box-shadow: 0 0 0 0 color-mix(in srgb, var(--pc) 0%, transparent); animation: p 2.4s ease-out infinite; }
  @keyframes p {
    0% { box-shadow: 0 0 0 0 rgba(63, 178, 127, 0.5); }
    70%, 100% { box-shadow: 0 0 0 5px rgba(63, 178, 127, 0); }
  }

  .side { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 12px; }
  .detail {
    border: 1px solid var(--divider);
    border-radius: 8px;
    background: var(--surface-elevated, transparent);
    padding: 12px 14px;
    min-height: 132px;
  }
  .d-kick { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; }
  .detail h4 { margin: 5px 0 4px; font-size: 15px; font-weight: 600; color: var(--text-primary); line-height: 1.2; }
  .d-note { margin: 0; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-secondary); }
  .d-meta { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
  .d-kind {
    font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-secondary); border: 1px solid var(--divider); border-radius: 3px; padding: 1px 5px;
  }
  .d-status { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); }
  .d-link { display: inline-block; margin-top: 9px; font-family: var(--font-mono); font-size: 10px; color: var(--accent); word-break: break-all; }
  .d-empty { font-size: 11.5px; line-height: 1.5; color: var(--text-ghost); }

  .legend {
    display: flex; flex-direction: column; gap: 5px;
    border: 1px solid var(--divider); border-radius: 8px; padding: 11px 13px;
  }
  .lg-hd { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); }
  .lg { display: inline-flex; align-items: center; gap: 7px; font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); }
  .lg i { width: 10px; height: 10px; border-radius: 3px; flex: none; }

  @media (max-width: 860px) {
    .arch { grid-template-columns: 1fr; }
    .side { position: static; flex-direction: row; flex-wrap: wrap; }
    .detail { flex: 1; min-width: 220px; }
  }
</style>
