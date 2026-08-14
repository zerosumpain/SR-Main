<script lang="ts" module>
  export interface FrontierLead {
    id: string;
    query: string;
    parentId: string | null;
    depth: number;
    origin: string;
    originDetail: string | null;
    status: string;
    reason: string | null;
    score: number | null;
  }
</script>

<script lang="ts">
  /**
   * The investigation's shape, drawn live.
   *
   * This shows the FRONTIER — the lines of enquiry and how they were judged —
   * not the entity graph. A completed session averages 253 entities and 151
   * relationships, which draws as a hairball that says nothing about direction
   * or about what the run gave up on. Tens of lead nodes do.
   *
   * The abandoned branches are the point. A run that quietly stopped pursuing
   * something looks identical to one that never tried; drawing the pruned
   * branches in place, greyed and struck through, is what makes the difference
   * visible.
   *
   * Layout is a deterministic tidy-tree rather than a force simulation: the data
   * is a tree, positions must not jitter as nodes stream in, and a d3 simulation
   * that both reads and writes reactive state from its tick handler is the
   * documented route to `effect_update_depth_exceeded`.
   */
  let {
    leads = [],
    onSelect,
  }: {
    leads: FrontierLead[];
    onSelect?: (lead: FrontierLead) => void;
  } = $props();

  const NODE_W = 168;
  const NODE_H = 34;
  const GAP_X = 28;
  const GAP_Y = 22;

  interface Placed extends FrontierLead {
    x: number;
    y: number;
  }

  /**
   * Assign a row per depth and stack siblings vertically. Children are laid out
   * under their parent's subtree in insertion order, so a node never moves once
   * placed — new leads extend the drawing rather than rearranging it.
   */
  const placed = $derived.by((): Placed[] => {
    const byParent = new Map<string | null, FrontierLead[]>();
    for (const l of leads) {
      const key = l.parentId && leads.some((p) => p.id === l.parentId) ? l.parentId : null;
      const list = byParent.get(key) ?? [];
      list.push(l);
      byParent.set(key, list);
    }

    const out: Placed[] = [];
    let cursorY = 0;

    const walk = (parentId: string | null, depth: number): void => {
      for (const lead of byParent.get(parentId) ?? []) {
        const y = cursorY;
        cursorY += NODE_H + GAP_Y;
        out.push({ ...lead, x: depth * (NODE_W + GAP_X), y });
        walk(lead.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const positions = $derived(new Map(placed.map((p) => [p.id, p])));
  const width = $derived(Math.max(1, ...placed.map((p) => p.x + NODE_W)) + 8);
  const height = $derived(Math.max(1, ...placed.map((p) => p.y + NODE_H)) + 8);

  const edges = $derived(
    placed
      .filter((p) => p.parentId && positions.has(p.parentId))
      .map((p) => ({ id: p.id, from: positions.get(p.parentId!)!, to: p })),
  );

  const counts = $derived.by(() => {
    const c: Record<string, number> = {};
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  });

  /** A branch that was cut, rather than one that simply finished. */
  function isAbandoned(status: string): boolean {
    return status === 'drifted' || status === 'pruned';
  }

  function label(l: FrontierLead): string {
    return l.query.length > 26 ? l.query.slice(0, 25) + '…' : l.query;
  }

  function title(l: FrontierLead): string {
    const bits = [l.query, `status: ${l.status}`];
    if (l.reason) bits.push(l.reason);
    if (l.originDetail) bits.push(`from: ${l.originDetail}`);
    return bits.join('\n');
  }
</script>

<div class="frontier">
  <div class="hd">
    <span class="sr-label-tight">Lines of enquiry</span>
    <span class="legend">
      {#each ['productive', 'exhausted', 'drifted', 'pruned', 'stalled', 'running', 'queued'] as s (s)}
        {#if counts[s]}<span class="key {s}">{counts[s]} {s}</span>{/if}
      {/each}
    </span>
  </div>

  {#if placed.length === 0}
    <p class="note">No lines of enquiry opened yet.</p>
  {:else}
    <div class="scroll">
      <svg {width} {height} role="img" aria-label="Research frontier: lines of enquiry and which were abandoned">
        {#each edges as e (e.id)}
          <path
            class="edge"
            class:cut={isAbandoned(e.to.status)}
            d="M{e.from.x + NODE_W} {e.from.y + NODE_H / 2} H{e.from.x + NODE_W + GAP_X / 2} V{e.to.y +
              NODE_H / 2} H{e.to.x}"
          />
        {/each}

        {#each placed as l (l.id)}
          <g
            class="node {l.status}"
            transform="translate({l.x},{l.y})"
            role="button"
            tabindex="0"
            aria-label={title(l)}
            onclick={() => onSelect?.(l)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(l);
              }
            }}
          >
            <title>{title(l)}</title>
            <rect width={NODE_W} height={NODE_H} rx="2" />
            <text x="8" y={NODE_H / 2 + 4}>{label(l)}</text>
            {#if isAbandoned(l.status)}
              <line class="strike" x1="8" y1={NODE_H / 2} x2={NODE_W - 8} y2={NODE_H / 2} />
            {/if}
          </g>
        {/each}
      </svg>
    </div>
  {/if}
</div>

<style>
  .frontier { border: 1px solid rgba(26, 16, 8, 0.18); background: var(--surface-elevated, #faf6ee); padding: 0.7rem 0.8rem; }
  .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .legend { display: flex; gap: 0.5rem; flex-wrap: wrap; font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .key { color: var(--text-muted); }
  .key.productive { color: var(--success, #2d7d46); }
  .key.drifted, .key.pruned { color: var(--error, #c44); }
  .key.running { color: var(--accent); }
  .note { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; }

  /* Wide trees scroll inside their own box; the page must never scroll sideways. */
  .scroll { overflow-x: auto; overflow-y: hidden; max-height: 320px; overflow-y: auto; }

  .edge { fill: none; stroke: var(--text-ghost); stroke-width: 1.2; }
  .edge.cut { stroke-dasharray: 3 3; opacity: 0.55; }

  .node { cursor: pointer; }
  .node rect { fill: var(--bg); stroke: rgba(26, 16, 8, 0.28); stroke-width: 1.2; }
  .node text { font-family: var(--font-mono); font-size: 11px; fill: var(--text-primary); }
  .node:hover rect { stroke: var(--accent); }
  .node:focus-visible rect { stroke: var(--accent); stroke-width: 2; }

  .node.running rect { stroke: var(--accent); stroke-width: 2; }
  .node.productive rect { stroke: var(--success, #2d7d46); }
  .node.exhausted rect { stroke-dasharray: 4 3; }
  .node.stalled rect { stroke-dasharray: 2 4; opacity: 0.75; }
  .key.stalled { color: var(--text-ghost); }
  .node.drifted rect, .node.pruned rect { stroke: var(--error, #c44); stroke-dasharray: 4 3; }
  .node.drifted text, .node.pruned text { fill: var(--text-muted); }
  .strike { stroke: var(--error, #c44); stroke-width: 1; opacity: 0.8; }
</style>
