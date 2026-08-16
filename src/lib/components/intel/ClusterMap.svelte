<script lang="ts">
  // The graph at cluster scale.
  //
  // This is the only view that shows all of it. The entity views ship the 600
  // most central nodes of nine thousand and narrow further with every filter, so
  // the picture you look at there is not the graph the clusters were computed
  // on. One bubble per cluster has nothing to leave out.
  //
  // Deliberately NOT another force-directed hairball at a smaller scale: with a
  // hundred nodes and a few hundred weighted links, the questions are "how big
  // is each part of this" and "which parts touch", and both are answered better
  // by a layout that does not move. So it is a deterministic packed layout —
  // same input, same picture, every time — which also means no simulation to
  // start, tick or tear down.

  import { clusterColour } from './graph-visual';
  import type { ClusterGraph } from './cluster-types';

  let {
    graph,
    onSelect,
    height = 420,
  }: {
    graph: ClusterGraph;
    onSelect?: (key: string) => void;
    height?: number;
  } = $props();

  const WIDTH = 1000;

  /**
   * Radius from entity count, on a square-root scale.
   *
   * Area, not radius, is what the eye reads as quantity, so a cluster of 400
   * must not be forty times the width of one of 10 — it should be about six.
   */
  const radiusOf = (size: number, max: number) => 12 + 46 * Math.sqrt(size / Math.max(max, 1));

  /**
   * How many bubbles carry a caption.
   *
   * Not all of them, for the reason the 3D view already learned: a name on every
   * cluster puts a hundred captions over the thing they annotate, and at this
   * scale most bubbles are narrower than their own label so each one is clipped
   * to nothing anyway. The biggest few orient you; the rest are a hover and a
   * click. Same number the 3D shells use.
   */
  const NAMED_CLUSTERS = 8;

  /**
   * Advance width of one character at the caption size, in user units.
   *
   * JetBrains Mono is 0.6em wide and the captions sit at the 12px floor, so a
   * caption is 7.2px per character. Kept as a constant because the character
   * budget and the stylesheet have to agree — when they drifted, labels were
   * computed to fit and then rendered wider than their own bubble.
   */
  const CHAR_PX = 7.2;

  const layout = $derived.by(() => {
    const nodes = [...graph.nodes].sort((a, b) => b.size - a.size);
    if (!nodes.length) return { placed: [], links: [], height };

    const maxSize = Math.max(...nodes.map((n) => n.size));
    const centreX = WIDTH / 2;
    const centreY = height / 2;

    // A phyllotaxis spiral: biggest in the middle, the rest fanning out at the
    // golden angle so nothing lands on top of anything else and the order is
    // fully determined by rank. The alternative — a force layout — would put the
    // same graph somewhere different on every visit.
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    const spread = Math.min(WIDTH, height) / 2.6;

    const placed = nodes.map((node, i) => {
      const r = spread * Math.sqrt(i / Math.max(nodes.length - 1, 1));
      const theta = i * GOLDEN;
      return {
        ...node,
        x: centreX + r * Math.cos(theta) * 1.55,
        y: centreY + r * Math.sin(theta),
        r: radiusOf(node.size, maxSize),
      };
    });

    // Push overlapping bubbles apart.
    //
    // The spiral places CENTRES, and knows nothing about radii — so the biggest
    // clusters, which are the ones worth reading, were the ones most likely to
    // be sitting on top of each other. This is the relaxation half of circle
    // packing: a fixed number of passes, each moving an overlapping pair apart
    // by half their overlap, largest first.
    //
    // Deterministic on purpose. Same input, same picture — which is the whole
    // reason this is not a force simulation.
    const PAD = 6;
    for (let pass = 0; pass < 90; pass++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i];
          const b = placed[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const want = a.r + b.r + PAD;
          const dist = Math.hypot(dx, dy) || 0.001;
          if (dist >= want) continue;
          // Nudge along a fixed axis when two centres coincide exactly, rather
          // than dividing by zero and flinging both to NaN.
          const ux = dist < 0.01 ? 1 : dx / dist;
          const uy = dist < 0.01 ? 0 : dy / dist;
          const shift = (want - dist) / 2;
          a.x -= ux * shift;
          a.y -= uy * shift;
          b.x += ux * shift;
          b.y += uy * shift;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Bring everything back inside the frame, keeping relative positions.
    const minX = Math.min(...placed.map((p) => p.x - p.r));
    const maxX = Math.max(...placed.map((p) => p.x + p.r));
    const minY = Math.min(...placed.map((p) => p.y - p.r));
    const maxY = Math.max(...placed.map((p) => p.y + p.r));
    // Scales UP as well as down. Relaxation leaves the packed cloud wherever it
    // happens to end up, which on a graph with a few dominant clusters is a
    // small island in the middle of a large empty frame.
    const scale = Math.min(
      (WIDTH - 24) / Math.max(maxX - minX, 1),
      (height - 24) / Math.max(maxY - minY, 1),
    );
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    for (const p of placed) {
      p.x = centreX + (p.x - midX) * scale;
      p.y = centreY + (p.y - midY) * scale;
      p.r *= scale;
    }

    const byKey = new Map(placed.map((p) => [p.key, p]));
    const maxCount = Math.max(1, ...graph.links.map((l) => l.count));
    const links = graph.links
      // Only the joins heavy enough to mean something. Every pair of clusters
      // sharing one stray edge would draw a mesh that says nothing.
      .filter((l) => l.count >= 2)
      .map((l) => {
        const a = byKey.get(l.source);
        const b = byKey.get(l.target);
        if (!a || !b) return null;
        return { a, b, count: l.count, w: 0.6 + 3.4 * (l.count / maxCount) };
      })
      .filter((l): l is NonNullable<typeof l> => Boolean(l));

    return { placed, links, height };
  });

  let hovered = $state<string | null>(null);
  const hoverNeighbours = $derived.by(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    for (const l of layout.links) {
      if (l.a.key === hovered) set.add(l.b.key);
      else if (l.b.key === hovered) set.add(l.a.key);
    }
    return set;
  });

  const dim = (key: string) => Boolean(hoverNeighbours && !hoverNeighbours.has(key));
</script>

{#if !graph.nodes.length}
  <p class="empty">No clusters to map yet.</p>
{:else}
  <div class="map">
    <svg viewBox="0 0 {WIDTH} {height}" role="img" aria-label="Clusters and how they connect">
      <g class="links">
        {#each layout.links as l (l.a.key + l.b.key)}
          <line
            x1={l.a.x}
            y1={l.a.y}
            x2={l.b.x}
            y2={l.b.y}
            stroke-width={l.w}
            class:dim={dim(l.a.key) && dim(l.b.key)}
          />
        {/each}
      </g>
      <g>
        {#each layout.placed as n, i (n.key)}
          <!-- How many characters fit INSIDE this bubble, at the mono cap size.
               A caption wider than its own circle reads as belonging to whatever
               it spills over, which on a packed map is another cluster. -->
          {@const fits = Math.floor((n.r * 1.7) / CHAR_PX)}
          {@const named = i < NAMED_CLUSTERS && n.r > 26 && fits >= 5}
          <g
            class="node"
            class:dim={dim(n.key)}
            role="button"
            tabindex="0"
            aria-label="{n.label}, {n.size} entities"
            onmouseenter={() => (hovered = n.key)}
            onmouseleave={() => (hovered = null)}
            onfocus={() => (hovered = n.key)}
            onblur={() => (hovered = null)}
            onclick={() => onSelect?.(n.key)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(n.key);
              }
            }}
          >
            <circle cx={n.x} cy={n.y} r={n.r} fill={clusterColour(n.colourIndex)} fill-opacity="0.22" />
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill="none"
              stroke={clusterColour(n.colourIndex)}
              stroke-width="1.5"
            />
            <!-- Named only where the bubble can hold the name, and clipped to
                 what actually fits INSIDE it. A caption wider than its own
                 circle reads as belonging to whatever it spills over, which on
                 a packed map is always something else's bubble. -->
            {#if named}
              <text x={n.x} y={n.y} text-anchor="middle" class="cap">
                {n.label.length > fits ? `${n.label.slice(0, fits - 1)}…` : n.label}
              </text>
              <text x={n.x} y={n.y + 15} text-anchor="middle" class="num">{n.size}</text>
            {:else}
              <text x={n.x} y={n.y + 4} text-anchor="middle" class="num">{n.size}</text>
            {/if}
            <title>{n.label} — {n.size} entities</title>
          </g>
        {/each}
      </g>
    </svg>
  </div>
{/if}

<style>
  .map {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
  }
  svg {
    display: block;
    width: 100%;
    min-width: 640px;
  }

  .links line {
    stroke: var(--text-primary);
    stroke-opacity: 0.16;
  }
  .links line.dim {
    stroke-opacity: 0.04;
  }

  .node {
    cursor: pointer;
  }
  .node.dim {
    opacity: 0.25;
  }
  .node:hover circle,
  .node:focus-visible circle {
    stroke-width: 2.5;
  }
  .node:focus-visible {
    outline: none;
  }

  /* Both at the 12px floor, not below it. An SVG caption is still text
     somebody has to read, and the type scale's floor is not waived by the
     label happening to live inside a circle. */
  .cap {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-primary);
    pointer-events: none;
  }
  .num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-ghost);
    pointer-events: none;
  }

  .empty {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }
</style>
