<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { ORGS, ORG_BY_ID, ORG_GROUP_META } from '../../lib/orgs';
  import CommitList from './CommitList.svelte';
  import type { Commitment } from '../../lib/types';

  // the new connections between partners: every flow the filtered commitments create,
  // department-centred radial layout, edge weight = number of commitments behind the flow
  const W = 940;
  const H = 640;
  const CX = W / 2;
  const CY = H / 2 + 6;
  const RADII = [0, 108, 192, 276];

  const pos = (orgId: string) => {
    const o = ORG_BY_ID[orgId];
    const a = ((o.angle - 90) * Math.PI) / 180;
    return { x: CX + RADII[o.ring] * Math.cos(a), y: CY + RADII[o.ring] * Math.sin(a) };
  };

  interface Edge {
    key: string;
    from: string;
    to: string;
    count: number;
    commitments: Commitment[];
    whats: string[];
  }
  const edges = $derived.by(() => {
    const map = new Map<string, Edge>();
    for (const c of ledger.filtered)
      for (const f of c.flows) {
        const key = `${f.from}→${f.to}`;
        const e = map.get(key) ?? { key, from: f.from, to: f.to, count: 0, commitments: [], whats: [] };
        e.count++;
        if (!e.commitments.includes(c)) e.commitments.push(c);
        if (e.whats.length < 4 && !e.whats.includes(f.what)) e.whats.push(f.what);
        map.set(key, e);
      }
    return [...map.values()].sort((a, b) => a.count - b.count); // draw heavy edges last (on top)
  });
  const degree = $derived.by(() => {
    const d: Record<string, number> = {};
    for (const e of edges) {
      d[e.from] = (d[e.from] ?? 0) + e.count;
      d[e.to] = (d[e.to] ?? 0) + e.count;
    }
    return d;
  });
  const activeOrgs = $derived(new Set(edges.flatMap((e) => [e.from, e.to])));

  function path(e: Edge): string {
    const a = pos(e.from);
    const b = pos(e.to);
    // curve pulled toward the centre (soft bundling); flatter when one end IS the centre
    const viaCentre = e.from === 'dfe' || e.to === 'dfe' ? 0.82 : 0.45;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const qx = CX + (mx - CX) * viaCentre;
    const qy = CY + (my - CY) * viaCentre;
    return `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`;
  }

  let hoverEdge = $state<string | null>(null);
  const isFocused = (e: Edge) =>
    (ledger.flowFocus && ledger.flowFocus.from === e.from && ledger.flowFocus.to === e.to) ||
    (ledger.orgFocus && (e.from === ledger.orgFocus || e.to === ledger.orgFocus));
  const anyFocus = $derived(!!ledger.flowFocus || !!ledger.orgFocus);

  const focusList = $derived.by(() => {
    if (ledger.flowFocus) {
      const e = edges.find((x) => x.from === ledger.flowFocus!.from && x.to === ledger.flowFocus!.to);
      return e?.commitments ?? [];
    }
    if (ledger.orgFocus) {
      const seen = new Set<string>();
      const out: Commitment[] = [];
      for (const e of edges)
        if (e.from === ledger.orgFocus || e.to === ledger.orgFocus)
          for (const c of e.commitments)
            if (!seen.has(c.id)) {
              seen.add(c.id);
              out.push(c);
            }
      return out;
    }
    return [];
  });
  const focusEdge = $derived(ledger.flowFocus ? edges.find((x) => x.from === ledger.flowFocus!.from && x.to === ledger.flowFocus!.to) : null);

  const labelAnchor = (orgId: string) => {
    const p = pos(orgId);
    if (Math.abs(p.x - CX) < 30) return 'middle';
    return p.x > CX ? 'start' : 'end';
  };
  const labelDY = (orgId: string) => {
    const o = ORG_BY_ID[orgId];
    const p = pos(orgId);
    const r = 8 + Math.min((degree[orgId] ?? 0) * 0.5, 9);
    return p.y < CY - 20 ? -r - 6 : r + 14;
  };
</script>

<div class="fm">
  {#if !edges.length}
    <p class="none">No data flows match the current filters.</p>
  {:else}
    <div class="legend">
      {#each Object.entries(ORG_GROUP_META).filter(([g]) => g !== 'dfe') as [g, m]}
        <span class="lg"><i style="--c:{m.color}"></i>{m.label}</span>
      {/each}
      <span class="lg-note">line weight = commitments behind the flow · click a line or an organisation</span>
    </div>
    <div class="svg-wrap">
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Map of the new data flows between organisations">
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(28,22,17,0.45)" />
          </marker>
          <marker id="arr-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#8a2d3a" />
          </marker>
        </defs>
        {#each RADII.slice(1) as r}
          <circle cx={CX} cy={CY} r={r} fill="none" stroke="rgba(28,22,17,0.06)" stroke-width="1" />
        {/each}
        <!-- edges -->
        {#each edges as e (e.key)}
          {@const hot = hoverEdge === e.key || isFocused(e)}
          <path
            d={path(e)}
            fill="none"
            stroke={hot ? '#8a2d3a' : anyFocus ? 'rgba(28,22,17,0.1)' : 'rgba(28,22,17,0.3)'}
            stroke-width={1.2 + Math.min(e.count, 8) * 0.85}
            marker-end={hot ? 'url(#arr-hot)' : 'url(#arr)'}
            class="edge"
            role="button"
            tabindex="0"
            aria-label="{ORG_BY_ID[e.from].name} to {ORG_BY_ID[e.to].name}: {e.count} commitment{e.count === 1 ? '' : 's'}"
            onmouseenter={() => (hoverEdge = e.key)}
            onmouseleave={() => (hoverEdge = null)}
            onclick={() => ledger.focusFlow(e.from, e.to)}
            onkeydown={(ev) => ev.key === 'Enter' && ledger.focusFlow(e.from, e.to)}
          />
        {/each}
        <!-- nodes -->
        {#each ORGS.filter((o) => o.id === 'dfe' || activeOrgs.has(o.id)) as o (o.id)}
          {@const p = pos(o.id)}
          {@const r = o.id === 'dfe' ? 26 : 8 + Math.min((degree[o.id] ?? 0) * 0.5, 9)}
          <g
            class="node"
            class:dim={anyFocus && ledger.orgFocus !== o.id && !(ledger.flowFocus && (ledger.flowFocus.from === o.id || ledger.flowFocus.to === o.id)) && o.id !== 'dfe'}
            role="button"
            tabindex="0"
            aria-label={o.name}
            onclick={() => ledger.focusOrg(ledger.orgFocus === o.id ? null : o.id)}
            onkeydown={(ev) => ev.key === 'Enter' && ledger.focusOrg(ledger.orgFocus === o.id ? null : o.id)}
          >
            <circle cx={p.x} cy={p.y} {r} fill={ORG_GROUP_META[o.group].color} stroke="#fdfaf2" stroke-width="2.5" />
            {#if o.id === 'dfe'}
              <text x={p.x} y={p.y + 4} text-anchor="middle" class="dfe-lab">the department</text>
            {:else}
              <text x={p.x + (labelAnchor(o.id) === 'start' ? r + 5 : labelAnchor(o.id) === 'end' ? -r - 5 : 0)} y={labelAnchor(o.id) === 'middle' ? p.y + labelDY(o.id) : p.y + 3.5} text-anchor={labelAnchor(o.id)} class="lab">{o.short}</text>
            {/if}
          </g>
        {/each}
      </svg>
      {#if hoverEdge}
        {@const e = edges.find((x) => x.key === hoverEdge)}
        {#if e}
          <div class="tipbar">
            <b>{ORG_BY_ID[e.from].short} → {ORG_BY_ID[e.to].short}</b> · {e.count} commitment{e.count === 1 ? '' : 's'} · {e.whats[0]}{e.whats.length > 1 ? ' …' : ''}
          </div>
        {/if}
      {/if}
    </div>

    {#if anyFocus}
      <div class="focus">
        <div class="f-head">
          <h3>
            {#if ledger.flowFocus && focusEdge}
              {ORG_BY_ID[focusEdge.from].name} → {ORG_BY_ID[focusEdge.to].name}
            {:else if ledger.orgFocus}
              Flows touching {ORG_BY_ID[ledger.orgFocus]?.name}
            {/if}
            <span class="f-n">({focusList.length})</span>
          </h3>
          <button class="f-clear" onclick={() => ledger.focusOrg(null)}>✕ clear</button>
        </div>
        {#if focusEdge}
          <ul class="f-whats">
            {#each focusEdge.whats as w}<li>{w}</li>{/each}
          </ul>
        {/if}
        <CommitList items={focusList} dense />
      </div>
    {:else}
      <p class="hint">The picture the white papers draw: every line is a NEW flow of data a commitment creates. Click the heaviest lines first — that's where the strategy's sharing, standards and legal work concentrates.</p>
    {/if}
  {/if}
</div>

<style>
  .none {
    margin: 0;
    font-size: 12.5px;
    color: rgba(28, 22, 17, 0.55);
    padding: 14px;
    border: 1px dashed rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-round);
    text-align: center;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.65);
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .lg i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
  }
  .lg-note {
    margin-left: auto;
    color: rgba(28, 22, 17, 0.45);
  }
  .svg-wrap {
    position: relative;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: #fdfaf2;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .edge {
    cursor: pointer;
    transition: stroke 0.12s;
  }
  .node {
    cursor: pointer;
  }
  .node.dim {
    opacity: 0.35;
  }
  .lab {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 600;
    fill: rgba(28, 22, 17, 0.75);
    paint-order: stroke;
    stroke: #fdfaf2;
    stroke-width: 3px;
  }
  .dfe-lab {
    font-family: 'Fraunces', serif;
    font-size: 15px;
    font-weight: 600;
    fill: #f1ead6;
  }
  .tipbar {
    position: absolute;
    left: 10px;
    bottom: 10px;
    right: 10px;
    background: var(--ink, #1c1611);
    color: #f1ead6;
    border-radius: var(--radius-round);
    padding: 7px 12px;
    font-size: 12px;
    pointer-events: none;
  }
  .tipbar b {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }
  .focus {
    margin-top: 14px;
    border: 1px solid var(--accent-ink-tint-35);
    border-left: 4px solid var(--accent-ink);
    border-radius: var(--radius-round);
    background: var(--accent-ink-tint-06);
    padding: 12px 15px;
  }
  .f-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .f-head h3 {
    margin: 0;
    font-family: 'Fraunces', serif;
    font-size: 16px;
    font-weight: 600;
    color: var(--ink);
  }
  .f-n {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--accent-ink);
  }
  .f-clear {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    padding: 3px 9px;
    background: transparent;
    border: 1px dashed rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-round);
    color: rgba(28, 22, 17, 0.6);
    cursor: pointer;
  }
  .f-whats {
    margin: 0 0 10px;
    padding-left: 17px;
  }
  .f-whats li {
    font-size: 12px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.72);
  }
  .hint {
    margin: 12px 0 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.6);
    max-width: 86ch;
  }
</style>
