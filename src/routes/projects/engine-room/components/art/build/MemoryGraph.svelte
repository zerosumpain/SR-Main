<script lang="ts">
  // MemoryGraph — a sketch of the codegraph you can pull about. The nodes are illustrative
  // (a handful of files, tests, checks, past builds and lessons); the links between them are
  // the real edge kinds the codegraph stores, each joining the kinds of thing it really joins.
  // The schematic below is keyed by the EdgeKind type, so a new kind fails the type check
  // until it is drawn.
  //
  // d3-force lays it out in the browser only. The server renders the same nodes on a circle,
  // so the drawing is never empty before script runs. With reduced motion the layout is
  // settled in one go and shown still; dragging works either way.
  import { onMount } from 'svelte';
  import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3';
  import type { EDGE_KINDS } from '$lib/codegraph/query';
  import { still } from '../../../lib/motion';

  type EdgeKind = (typeof EDGE_KINDS)[number];
  type Kind = 'file' | 'test' | 'gate' | 'episode' | 'lesson';
  interface N extends SimulationNodeDatum { id: string; kind: Kind; label: string }
  interface L { source: string | N; target: string | N; kind: EdgeKind }

  interface Props {
    kinds: string[];
    edgeCopy: Record<string, string>;
    nodeCopy: Record<Kind, string>;
    gates: string[];
    selected: string | null;
    onselect: (k: string | null) => void;
  }
  let { kinds, edgeCopy, nodeCopy, gates, selected, onselect }: Props = $props();

  const SCHEMA = {
    co_change: [['f1', 'f2'], ['f3', 'f4']],
    needs_context: [['f2', 'f3'], ['f4', 'f5']],
    gated_by: [['f1', 'g1'], ['f3', 'g2'], ['f5', 'g1']],
    imports: [['f1', 'f3'], ['f2', 'f5']],
    fixed_by: [['e1', 'f2'], ['e2', 'f4']],
    tests: [['t1', 'f1'], ['t2', 'f4']],
    references: [['l1', 'f2'], ['l2', 'f5'], ['l1', 'f4']],
  } satisfies Record<EdgeKind, Array<[string, string]>>;

  const KINDS: Array<[Kind, string[]]> = [
    ['file', ['f1', 'f2', 'f3', 'f4', 'f5']], ['test', ['t1', 't2']], ['gate', ['g1', 'g2']],
    ['episode', ['e1', 'e2']], ['lesson', ['l1', 'l2']],
  ];
  const LABEL: Record<Kind, string> = { file: 'file', test: 'test', gate: 'check', episode: 'past build', lesson: 'lesson' };

  const seed = (): N[] => {
    const all = KINDS.flatMap(([kind, ids]) => ids.map((id, i) => ({ id, kind, label: kind === 'gate' ? gates[i] ?? LABEL.gate : LABEL[kind] })));
    return all.map((n, i) => ({ ...n, x: 300 + 160 * Math.cos((i / all.length) * 2 * Math.PI), y: 220 + 160 * Math.sin((i / all.length) * 2 * Math.PI) }));
  };
  let nodes = $state.raw<N[]>(seed());
  const live = $derived(new Set(kinds));
  // Edges are held by id; positions are looked up from the latest node copies, so every tick
  // re-renders (the simulation mutates its own objects, which Svelte can't see).
  const EDGES: Array<{ s: string; t: string; kind: EdgeKind }> =
    (Object.entries(SCHEMA) as Array<[EdgeKind, Array<[string, string]>]>).flatMap(([kind, pairs]) => pairs.map(([s, t]) => ({ s, t, kind })));
  const links = $derived(EDGES.filter((e) => live.has(e.kind)));
  const at = $derived(new Map(nodes.map((n) => [n.id, n])));

  let w = $state(600);
  const h = $derived(w < 560 ? 400 : 460);
  let sim: Simulation<N, undefined> | null = null;

  onMount(() => {
    const ns = nodes.map((n) => ({ ...n }));
    const ls: L[] = links.map((e) => ({ source: e.s, target: e.t, kind: e.kind }));
    sim = forceSimulation<N>(ns)
      .force('link', forceLink<N, L & SimulationNodeDatum>(ls as never).id((d) => (d as N).id).distance(w < 560 ? 70 : 125).strength(0.5))
      .force('charge', forceManyBody().strength(w < 560 ? -260 : -900))
      .force('center', forceCenter(w / 2, h / 2))
      .force('x', forceX(w / 2).strength(0.03))
      .force('y', forceY(h / 2).strength(0.1))
      .force('collide', forceCollide(w < 560 ? 30 : 46))
      .on('tick', () => {
        for (const n of ns) { n.x = Math.max(46, Math.min(w - 46, n.x ?? 0)); n.y = Math.max(28, Math.min(h - 44, n.y ?? 0)); }
        nodes = ns.map((n) => ({ ...n }));
      });
    if (still()) { sim.stop(); sim.tick(300); nodes = ns.map((n) => ({ ...n })); }
    return () => sim?.stop();
  });
  $effect(() => {
    // Re-centre when the box changes size.
    if (!sim) return;
    (sim.force('center') as ReturnType<typeof forceCenter>)?.x(w / 2).y(h / 2);
    (sim.force('x') as ReturnType<typeof forceX>)?.x(w / 2);
    (sim.force('y') as ReturnType<typeof forceY>)?.y(h / 2);
    if (!still()) sim.alpha(0.4).restart();
  });

  let svgEl: SVGSVGElement | undefined = $state();
  let dragging = $state<string | null>(null);
  function down(e: PointerEvent, n: N) {
    if (!sim) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragging = n.id;
    const s = sim.nodes().find((x) => x.id === n.id);
    if (s) { s.fx = s.x; s.fy = s.y; }
    sim.alphaTarget(0.3).restart();
  }
  function move(e: PointerEvent) {
    if (!dragging || !sim || !svgEl) return;
    const r = svgEl.getBoundingClientRect();
    const s = sim.nodes().find((x) => x.id === dragging);
    if (s) { s.fx = ((e.clientX - r.left) / r.width) * w; s.fy = ((e.clientY - r.top) / r.height) * h; }
  }
  function up() {
    if (!dragging || !sim) return;
    const s = sim.nodes().find((x) => x.id === dragging);
    if (s) { s.fx = null; s.fy = null; }
    dragging = null;
    sim.alphaTarget(0);
    if (still()) sim.stop();
  }
  const focusKind = $derived(selected);
  const touches = (n: N) => !focusKind || links.some((l) => l.kind === focusKind && (l.s === n.id || l.t === n.id));
</script>

<div class="mg">
  <div class="chips" role="group" aria-label="Kinds of link">
    {#each kinds as k (k)}
      <button class:on={selected === k} aria-pressed={selected === k} onclick={() => onselect(selected === k ? null : k)}>
        <span class="sw" data-k={k}></span>{k.replace(/_/g, ' ')}
      </button>
    {/each}
  </div>

  <div class="box" bind:clientWidth={w}>
    <svg bind:this={svgEl} viewBox="0 0 {w} {h}" width={w} height={h} role="img"
         aria-label="A sketch of the build's memory: files, tests, checks, past builds and lessons joined by {kinds.length} kinds of link."
         onpointermove={move} onpointerup={up} onpointercancel={up}>
      {#each links as l, i (i)}
        {@const s = at.get(l.s)}
        {@const t = at.get(l.t)}
        {#if s && t}
          <line class="edge" class:hot={focusKind === l.kind} class:cool={focusKind && focusKind !== l.kind}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y} />
        {/if}
      {/each}
      {#each nodes as n (n.id)}
        <g class="node {n.kind}" class:cool={!touches(n)} class:grab={dragging === n.id} transform="translate({n.x} {n.y})"
           onpointerdown={(e) => down(e, n)} role="presentation">
          {#if n.kind === 'gate'}
            <rect x="-15" y="-15" width="30" height="30" rx="2" transform="rotate(45)" />
          {:else if n.kind === 'lesson'}
            <rect x="-17" y="-13" width="34" height="26" rx="2" />
          {:else}
            <circle r={n.kind === 'file' ? 20 : 16} />
          {/if}
          <text y="38" text-anchor="middle">{n.label}</text>
        </g>
      {/each}
    </svg>
  </div>

  <ul class="legend">
    {#each KINDS as [k]}
      <li class={k}><span class="mk"></span><b>{LABEL[k]}</b> {nodeCopy[k]}</li>
    {/each}
  </ul>
  <p class="cap" aria-live="polite">
    {#if selected}<b>{selected.replace(/_/g, ' ')}</b> joins {edgeCopy[selected] ?? ''}.{:else}Drag any node. Pick a kind of link above to light it up.{/if}
  </p>
</div>

<style>
  .mg { min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .chips button { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: var(--radius-pill); cursor: pointer;
    border: 1px solid var(--rule-strong); background: transparent; color: var(--fg-2); font-family: var(--er-mono); font-size: var(--fs-label-xs); }
  .chips button.on { background: var(--tone-text); border-color: var(--tone-text); color: var(--er-ink); }
  .sw { width: 16px; height: 3px; background: currentColor; }
  .box { width: 100%; border: 1px solid var(--rule); background: radial-gradient(circle at 50% 45%, rgba(232, 134, 58, 0.08), transparent 70%); touch-action: none; }
  svg { display: block; width: 100%; height: auto; user-select: none; }
  .edge { stroke: var(--rule-strong); stroke-width: 2; transition: stroke 0.3s, opacity 0.3s; }
  .edge.hot { stroke: var(--tone-text); stroke-width: 4; stroke-dasharray: 8 6; animation: march 0.8s linear infinite; }
  @keyframes march { to { stroke-dashoffset: -14; } }
  .edge.cool { opacity: 0.18; }
  .node { cursor: grab; transition: opacity 0.3s; }
  .node.grab { cursor: grabbing; }
  .node.cool { opacity: 0.3; }
  .node circle, .node rect { stroke: var(--er-ink); stroke-width: 2; }
  .file circle, .legend .file .mk { fill: var(--er-cream); background: var(--er-cream); }
  .test circle, .legend .test .mk { fill: var(--er-bronze-ink); background: var(--er-bronze-ink); }
  .gate rect, .legend .gate .mk { fill: var(--er-orange-ink); background: var(--er-orange-ink); }
  .episode circle, .legend .episode .mk { fill: var(--er-amber-ink); background: var(--er-amber-ink); }
  .lesson rect, .legend .lesson .mk { fill: var(--er-petrol-ink); background: var(--er-petrol-ink); }
  .node text { font-family: var(--er-mono); font-size: 13px; fill: var(--fg-2); pointer-events: none; }
  .legend { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 18px; }
  .legend li { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-label); color: var(--fg-3); }
  .legend b { color: var(--fg); font-weight: 600; }
  .mk { flex-shrink: 0; width: 12px; height: 12px; border-radius: var(--radius-pill); align-self: center; }
  .cap { margin: 16px 0 0; font-size: var(--fs-body); color: var(--fg-2); min-height: 1.6em; }
  .cap b { color: var(--tone-text); text-transform: capitalize; }
</style>
