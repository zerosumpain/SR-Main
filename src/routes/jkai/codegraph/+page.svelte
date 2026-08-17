<script lang="ts">
  // The ER map. A force layout over files, sized by how much history each
  // carries and joined by what actually changed alongside what.
  //
  // Hand-rolled rather than pulling in the Intel NetworkGraph: that component
  // is bound to intel's entity/relationship types and its trust-grade
  // encodings, and forking it to take a second node shape would leave two
  // copies of the same physics to keep in step. This is ~80 lines of the same
  // idea with the encodings this graph actually needs.
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  interface Sim { id: string; path: string; episodes: number; lessons: number; existsOnHead: boolean; x: number; y: number; vx: number; vy: number; r: number }

  const W = 1000;
  const H = 620;

  let selected = $state<string | null>(null);

  // A PURE function returning a fresh layout, consumed by $derived — not an
  // $effect writing into $state. Two reasons, and the second is the bug that
  // forced it: an $effect never runs during SSR, so the server rendered
  // `sim = []` and the page announced "The graph is empty. Run the backfill"
  // over a perfectly populated graph. Deriving it means the map is correct in
  // the SSR HTML and identical after hydration.
  function layout(sourceNodes: PageData['nodes'], sourceEdges: PageData['edges']) {
    const nodes: Sim[] = sourceNodes.map((n, i) => {
      const weight = n.episodes + n.lessons;
      const angle = (i / Math.max(1, sourceNodes.length)) * Math.PI * 2;
      return {
        id: n.id, path: n.path, episodes: n.episodes, lessons: n.lessons,
        existsOnHead: n.existsOnHead,
        // Seed on a ring rather than at random: a deterministic start makes the
        // same graph draw the same way twice, which matters when you are
        // comparing it against yesterday.
        x: W / 2 + Math.cos(angle) * 240,
        y: H / 2 + Math.sin(angle) * 200,
        vx: 0, vy: 0,
        r: Math.max(4, Math.min(22, 4 + Math.sqrt(weight) * 3.2)),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const ls = sourceEdges.filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ a: e.source, b: e.target, kind: e.kind, weight: e.weight }));

    // Fixed iteration count, run synchronously: the graph is small and a
    // settled layout on first paint beats watching it wobble into place.
    for (let step = 0; step < 320; step++) {
      const alpha = 1 - step / 320;
      for (const l of ls) {
        const s = byId.get(l.a)!, t = byId.get(l.b)!;
        const dx = t.x - s.x, dy = t.y - s.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const target = 70 + 30 / Math.sqrt(l.weight);
        const f = ((dist - target) / dist) * 0.05 * alpha;
        s.x += dx * f; s.y += dy * f; t.x -= dx * f; t.y -= dy * f;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = Math.max(40, dx * dx + dy * dy);
          const f = (900 / d2) * alpha;
          a.x -= dx * f; a.y -= dy * f; b.x += dx * f; b.y += dy * f;
        }
        const n = nodes[i];
        n.x += (W / 2 - n.x) * 0.006 * alpha;
        n.y += (H / 2 - n.y) * 0.006 * alpha;
        n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
        n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y));
      }
    }
    return { nodes, links: ls };
  }

  const laid = $derived(layout(data.nodes, data.edges));
  const sim = $derived(laid.nodes);
  const links = $derived(laid.links);

  const chosen = $derived(sim.find((n) => n.id === selected) ?? null);
  const neighbours = $derived(
    chosen
      ? links.filter((l) => l.a === chosen.id || l.b === chosen.id)
          .map((l) => sim.find((n) => n.id === (l.a === chosen.id ? l.b : l.a)))
          .filter(Boolean) as Sim[]
      : [],
  );
  const short = (p: string) => p.split('/').slice(-2).join('/');
</script>

<svelte:head><title>Codegraph — map</title></svelte:head>

<section class="wrap">
  <header>
    <h1>Build-history map</h1>
    <p class="lede">
      Files that carry history, sized by how much of it they carry, joined where they change
      together. Showing the busiest <strong>{data.shown}</strong> of {data.total} nodes.
    </p>
  </header>

  {#if !sim.length}
    <p class="empty">
      The graph is empty. Run <code>node scripts/codegraph-backfill.mjs --all</code> on homeserv
      to populate it from the session history.
    </p>
  {:else}
    <div class="board">
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Build history graph">
        {#each links as l (l.a + l.b + l.kind)}
          {@const a = sim.find((n) => n.id === l.a)}
          {@const b = sim.find((n) => n.id === l.b)}
          {#if a && b}
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={l.kind === 'co_change' ? 'var(--accent-ink)' : 'var(--divider)'}
              stroke-width={Math.min(3, 0.6 + l.weight * 0.25)}
              opacity={selected ? (l.a === selected || l.b === selected ? 0.75 : 0.06) : 0.18}
            />
          {/if}
        {/each}
        {#each sim as n (n.id)}
          <g
            class="node"
            class:dim={selected && selected !== n.id && !neighbours.some((x) => x.id === n.id)}
            onclick={() => (selected = selected === n.id ? null : n.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = selected === n.id ? null : n.id; } }}
            role="button"
            tabindex="0"
            aria-label={n.path}
          >
            <circle
              cx={n.x} cy={n.y} r={n.r}
              fill={n.existsOnHead ? 'var(--accent)' : 'var(--divider)'}
              stroke={selected === n.id ? 'var(--accent-ink)' : 'transparent'}
              stroke-width="2.5"
            />
            {#if n.r > 11 || selected === n.id}
              <text x={n.x} y={n.y - n.r - 5} text-anchor="middle">{short(n.path)}</text>
            {/if}
          </g>
        {/each}
      </svg>

      <aside>
        {#if chosen}
          <h2>{chosen.path}</h2>
          <dl>
            <div><dt>Episodes</dt><dd>{chosen.episodes}</dd></div>
            <div><dt>Lessons</dt><dd>{chosen.lessons}</dd></div>
            <div><dt>At HEAD</dt><dd>{chosen.existsOnHead ? 'yes' : 'deleted'}</dd></div>
          </dl>
          <p class="hint">Changes alongside ({neighbours.length}):</p>
          <ul>
            {#each neighbours.slice(0, 12) as n (n.id)}<li>{short(n.path)}</li>{/each}
          </ul>
          <a class="ask" href="/jkai/codegraph/ask?q={encodeURIComponent(`file:${chosen.path} | hops 1`)}">
            Ask the graph about this file →
          </a>
        {:else}
          <h2>Pick a file</h2>
          <p class="hint">
            Size is history carried. A grey node is a file that no longer exists at HEAD —
            its lessons may still be true, but nothing can act on them.
          </p>
          <p class="hint">
            Solid links are <strong>co-change</strong> (edited in the same session); faint links
            are <strong>needs-context</strong> (read before editing the other).
          </p>
        {/if}
      </aside>
    </div>
  {/if}
</section>

<style>
  .wrap { max-width: 1240px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-family: var(--font-display); font-size: var(--fs-display-sm); margin: 0 0 0.4rem; }
  .lede { color: var(--text-secondary); max-width: 62ch; margin: 0 0 1.5rem; }
  .board { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 1.25rem; align-items: start; }
  svg { width: 100%; height: auto; background: var(--card-bg); border: 1px solid var(--card-border); }
  .node { cursor: pointer; }
  .node.dim { opacity: 0.22; }
  .node text { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--text-secondary); pointer-events: none; }
  aside { border: 1px solid var(--card-border); background: var(--card-bg); padding: 1rem; }
  aside h2 { font-family: var(--font-mono); font-size: 0.85rem; word-break: break-all; margin: 0 0 0.75rem; }
  dl { display: grid; gap: 0.35rem; margin: 0 0 1rem; }
  dl > div { display: flex; justify-content: space-between; font-size: 0.85rem; }
  dt { color: var(--text-secondary); }
  dd { margin: 0; font-family: var(--font-mono); }
  .hint { color: var(--text-secondary); font-size: 0.85rem; line-height: 1.5; }
  ul { list-style: none; padding: 0; margin: 0 0 1rem; font-family: var(--font-mono); font-size: 0.78rem; }
  li { padding: 0.15rem 0; color: var(--text-secondary); word-break: break-all; }
  .ask { font-size: 0.85rem; color: var(--accent-ink); }
  .empty { border: 1px solid var(--card-border); background: var(--card-bg); padding: 1.5rem; }
  code { font-family: var(--font-mono); background: var(--code-bg); padding: 0.1rem 0.3rem; }
  @media (max-width: 900px) { .board { grid-template-columns: minmax(0, 1fr); } }
</style>
