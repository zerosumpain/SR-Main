<script lang="ts">
  // The intel network as a 3D spatial graph.
  //
  // This is the SAME VIEW as NetworkGraph.svelte with a third axis — not a
  // second design. Every encoding, colour, threshold and interaction below is
  // lifted from the 2D component deliberately, and the two must never disagree
  // about what the graph says:
  //
  //   size    PageRank importance, sqrt curve  (identical radius())
  //   colour  detected community               (identical palette)
  //   alpha   confirmed 0.85 / unconfirmed 0.4 / dimmed-by-keyword 0.14
  //   edges   0.16 ink, accent when they cross communities, solid accent on a
  //           traced path; width from the strength bucket (2 / 1.2 / 0.7)
  //   labels  importance big enough to earn one, plus path and keyword hits
  //   page    the cream --bg, because this is still a panel on this site
  //
  // WHY A LIBRARY. The 2D view's behaviour — a simulation that keeps running,
  // that you can drag a node in and watch the rest of the graph answer — comes
  // from d3-force being live. The previous 3D view ticked a d3-force-3d layout
  // to completion in a `for` loop and then froze it, so it looked force-directed
  // without behaving that way, and nothing could be dragged. `3d-force-graph`
  // is d3-force-3d driven per frame with node dragging, raycasting and camera
  // framing already solved; hand-rolling those is re-implementing it. Its forces
  // are injected below so the physics is configured exactly as the 2D view's is.
  //
  // REACTIVITY. Every three.js and graph handle is a plain `let`, never $state:
  // nothing reactive reads them, and a render loop that both reads and writes
  // reactive state is the documented route to effect_update_depth_exceeded (see
  // the svelte5-pitfalls skill). Only `hovered` and `tooltip` are reactive.

  import * as THREE from 'three';
  import {
    forceLink,
    forceManyBody,
    forceCenter,
    forceCollide,
    forceX,
    forceY,
    forceZ,
  } from 'd3-force-3d';
  import { untrack, onDestroy } from 'svelte';

  import type { ForceGraph3DInstance } from '3d-force-graph';
  import type { NetNode, NetEdge } from './types';

  let {
    nodes = [],
    edges = [],
    highlightPath = null,
    matchedIds = [],
    selectedId = null,
    onSelect,
    onOpen,
  }: {
    nodes: NetNode[];
    edges: NetEdge[];
    /** Ordered entity ids to draw as a highlighted route. */
    highlightPath?: string[] | null;
    /**
     * Literal hits from the keyword filter. The rest of what is drawn is the
     * neighbourhood around them — context, not answer — so it is dimmed rather
     * than removed, exactly as in the 2D view.
     */
    matchedIds?: string[];
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
    onOpen?: (id: string) => void;
  } = $props();

  /**
   * The panel, and the element the scene is handed.
   *
   * They have to be different nodes: ForceGraph3D starts by clearing the
   * innerHTML of whatever it is given. Pointed at the panel it wiped the
   * anchors Svelte uses to place the tooltip and the empty state, and hovering
   * a node silently rendered its tooltip into detached DOM.
   */
  let host = $state<HTMLDivElement | null>(null);
  let container = $state<HTMLDivElement | null>(null);
  let hovered = $state<NetNode | null>(null);
  let tooltip = $state({ x: 0, y: 0 });

  // ── Non-reactive handles ───────────────────────────────────────────────────
  interface Sim3DNode extends NetNode {
    x?: number;
    y?: number;
    z?: number;
    fx?: number;
    fy?: number;
    fz?: number;
  }
  /**
   * `forceLink().id()` REPLACES `source`/`target` with the node objects once the
   * simulation is built, so after that point they are no longer the id strings
   * `NetEdge` declares. Re-declared rather than cast at each use, so both forms
   * are visible in the type instead of being a surprise.
   */
  type Sim3DEdge = Omit<NetEdge, 'source' | 'target'> & {
    source: string | Sim3DNode;
    target: string | Sim3DNode;
  };

  type IntelGraph = ForceGraph3DInstance<Sim3DNode, Sim3DEdge>;

  let graph: IntelGraph | null = null;
  let simNodes: Sim3DNode[] = [];
  let simEdges: Sim3DEdge[] = [];
  let resizeObserver: ResizeObserver | null = null;
  /** Node id → the extras group parented to that node's sphere. */
  const extrasById = new Map<string, THREE.Group>();
  /** Materials and geometries we own, so they can be disposed on teardown. */
  const owned: Array<{ dispose: () => void }> = [];
  /** Restores the shared material a node had before it was hover-brightened. */
  let hoverRestore: { mesh: THREE.Mesh; material: THREE.Material } | null = null;
  /** Node positions survive a filter change so the layout does not jump. */
  const positions = new Map<string, { x: number; y: number; z: number }>();
  /** Bumped on every (re)build so a slow dynamic import cannot revive a dead scene. */
  let buildToken = 0;
  /** Set once per build, so the early camera fit happens exactly once. */
  let fitted = false;
  /** Set once per build, so the settle fit happens exactly once. */
  let settledOnce = false;
  let lastClick = { id: '', at: 0 };

  /**
   * Matches the 2D view's palette exactly — the same cluster must be the same
   * colour in both, or switching views looks like switching graphs.
   */
  const CLUSTER_COLOURS = [
    '#0e5b66', '#c4570a', '#2d7a3a', '#7a3a8a', '#b0892a',
    '#3a6ea5', '#a53a3a', '#4a7a6a', '#8a5a2a', '#5a4a8a',
  ];
  const clusterColour = (c: number) => CLUSTER_COLOURS[c % CLUSTER_COLOURS.length];

  /**
   * Design tokens, resolved to literals.
   *
   * WebGL cannot read `var(--bg)`, so the values are read off the live element
   * rather than hardcoded — the scene then follows the design system instead of
   * drifting from it the first time a token is retuned.
   */
  let palette = {
    bg: '#ede4d4',
    accent: '#c4570a',
    label: '#3d2e1a',
    font: 'system-ui, sans-serif',
  };

  function readPalette(el: HTMLElement) {
    const cs = getComputedStyle(el);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    palette = {
      bg: v('--bg', '#ede4d4'),
      accent: v('--accent', '#c4570a'),
      label: v('--text-secondary', '#3d2e1a'),
      font: v('--font-body', 'system-ui, sans-serif'),
    };
  }

  /** `#rrggbb` + alpha → the `rgba()` string the graph's colour accessors parse. */
  function rgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '').trim();
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = Number.parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  const pathSet = $derived(new Set(highlightPath ?? []));
  const matchSet = $derived(new Set(matchedIds ?? []));
  /** Only dim when there is something to dim AGAINST. */
  const dimming = $derived(matchSet.size > 0);
  /**
   * Stable dependency keys. The parent hands fresh arrays on every render, so
   * depending on the arrays themselves would restyle the scene continuously.
   */
  const pathKey = $derived((highlightPath ?? []).join('|'));
  const matchKey = $derived((matchedIds ?? []).join('|'));

  const pathEdgeKeys = $derived.by(() => {
    const set = new Set<string>();
    const p = highlightPath ?? [];
    for (let i = 0; i < p.length - 1; i++) set.add([p[i], p[i + 1]].sort().join('|'));
    return set;
  });

  /**
   * Identical to the 2D view's radius, and deliberately in the same units: the
   * forces below are the 2D configuration unchanged, so the layout settles at
   * the same scale and one node-size curve serves both views.
   */
  function radius(n: NetNode): number {
    // sqrt so a 10× importance difference is a ~3× size difference.
    return 5 + Math.sqrt(Math.max(0, n.importance)) * 20;
  }

  /** The 2D view's fill-opacity rules, unchanged. */
  function nodeAlpha(n: NetNode): number {
    if (dimming && !matchSet.has(n.id)) return 0.14;
    return n.confirmed ? 0.85 : 0.4;
  }

  /**
   * An edge endpoint's id. `forceLink` mutates `source`/`target` from the id
   * string into the node object once the simulation is built, so anything
   * reading them afterwards has to handle both forms.
   */
  function endpointId(v: unknown): string {
    return typeof v === 'string' ? v : ((v as { id?: string })?.id ?? '');
  }

  /**
   * The 2D view's labelling rule, unchanged: anything big enough to earn one,
   * plus whatever is on a traced path or literally matched the keyword.
   * Selection deliberately does NOT label — matching 2D, and it keeps a plain
   * click from having to rebuild every node's label texture.
   */
  function earnsLabel(n: NetNode): boolean {
    return radius(n) > 10 || pathSet.has(n.id) || matchSet.has(n.id);
  }

  // ── Scene pieces ───────────────────────────────────────────────────────────

  /**
   * Label sprites, keyed by entity and dimmed state.
   *
   * Every label is its own canvas texture, and the extras are rebuilt whenever a
   * path or keyword changes which nodes carry one. Without the cache, tracing a
   * few routes in a session would leave a set of orphaned textures behind each
   * time — GPU memory three.js does not reclaim on its own.
   */
  const labelCache = new Map<string, THREE.Sprite>();

  /** A text label as a camera-facing sprite, styled like the 2D view's <text>. */
  function makeLabel(text: string): THREE.Sprite | null {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Same truncation as the 2D view, so a name reads identically in both.
    const label = text.length > 26 ? `${text.slice(0, 24)}…` : text;
    const fontSize = 48;
    const font = `500 ${fontSize}px ${palette.font}`;
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(label).width) + 28;
    canvas.height = Math.round(fontSize * 1.5);

    // Re-set after resizing — changing width/height resets all context state.
    ctx.font = font;
    ctx.textBaseline = 'middle';
    // The 2D view paints its labels with a --bg stroke under the fill so they
    // stay readable over a node. Same trick, same colours.
    ctx.strokeStyle = palette.bg;
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.strokeText(label, 14, canvas.height / 2);
    ctx.fillStyle = palette.label;
    ctx.fillText(label, 14, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // Fixed on screen rather than in the world. The 2D view's labels ride its
      // zoom transform, but a scene with depth has no single zoom: world-scaled
      // text renders as unreadable specks on the far side of a big graph and as
      // headlines on a small one — a keyword filter turned the panel into a wall
      // of overlapping names. A constant ~14px is what the 2D view actually
      // reads at, at every distance.
      sizeAttenuation: false,
    });
    const sprite = new THREE.Sprite(material);
    // With sizeAttenuation off, scale is a fraction of the frustum height:
    // screen height ≈ scale / tan(fov/2) / 2, which puts 0.021 at about 14px on
    // this panel.
    const height = 0.021;
    sprite.scale.set((canvas.width / canvas.height) * height, height, 1);
    // Anchored at its bottom edge, so it grows upward from above the node.
    sprite.center.set(0.5, 0);
    // Labels must not enlarge the click target — only the sphere is clickable,
    // exactly as in 2D where the <text> has pointer-events: none.
    sprite.raycast = () => {};
    owned.push(texture, material);
    return sprite;
  }

  let cageGeometry: THREE.SphereGeometry | null = null;
  let cageMaterial: THREE.MeshBasicMaterial | null = null;
  let haloGeometry: THREE.SphereGeometry | null = null;
  let haloMaterial: THREE.MeshBasicMaterial | null = null;

  /** The 3D reading of the 2D view's dashed accent ring around a broker. */
  function makeBrokerCage(r: number): THREE.Mesh {
    // Few segments and low opacity on purpose: the 2D equivalent is a thin
    // dashed outline, and a dense wireframe ball reads as a solid object rather
    // than as a marker on the node inside it.
    cageGeometry ??= new THREE.SphereGeometry(1, 8, 5);
    cageMaterial ??= new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      wireframe: true,
      transparent: true,
      opacity: 0.38,
    });
    const mesh = new THREE.Mesh(cageGeometry, cageMaterial);
    mesh.scale.setScalar(r + 3.5);
    mesh.raycast = () => {};
    return mesh;
  }

  /** The 3D reading of the 2D view's 3px accent stroke on a selected node. */
  function makeHalo(r: number): THREE.Mesh {
    haloGeometry ??= new THREE.SphereGeometry(1, 16, 12);
    haloMaterial ??= new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0.55,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(haloGeometry, haloMaterial);
    mesh.scale.setScalar(r + 4);
    mesh.raycast = () => {};
    return mesh;
  }

  /**
   * Everything hung off a node's sphere. Returned for every node, including the
   * plain ones: the empty group is how the sphere itself is found again later
   * (`group.parent`), which is what hover brightening and the selection halo
   * need and the library does not otherwise expose.
   */
  function nodeExtras(node: Sim3DNode): THREE.Group {
    const group = new THREE.Group();
    const r = radius(node);

    if (node.brokerage > 0.02) group.add(makeBrokerCage(r));
    if (pathSet.has(node.id) || node.id === selectedId) group.add(makeHalo(r));

    if (earnsLabel(node)) {
      // Keyword-dimmed nodes get a dimmed label, matching the 2D view's
      // treatment of the context around a hit. Part of the cache key, since it
      // is baked into the sprite's material.
      const dim = dimming && !matchSet.has(node.id);
      const key = `${node.id}|${dim ? 1 : 0}`;
      let sprite = labelCache.get(key);
      if (!sprite) {
        sprite = makeLabel(node.name) ?? undefined;
        if (sprite) {
          if (dim) sprite.material.opacity = 0.3;
          labelCache.set(key, sprite);
        }
      }
      if (sprite) {
        sprite.position.set(0, r + 2, 0);
        group.add(sprite);
      }
    }

    extrasById.set(node.id, group);
    return group;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /**
   * Cluster colour, always — selection and a traced path do NOT repaint the
   * node. The 2D view keeps the fill and rings the node in accent, so the
   * cluster stays readable while it is highlighted, and the halo below carries
   * the highlight. It also means a click never has to touch a material.
   */
  function nodeColour(node: Sim3DNode): string {
    return rgba(clusterColour(node.community), nodeAlpha(node));
  }

  function linkColour(edge: Sim3DEdge): string {
    const key = [endpointId(edge.source), endpointId(edge.target)].sort().join('|');
    if (pathEdgeKeys.has(key)) return palette.accent;
    // The literals the 2D view uses, so the same link is the same colour in both.
    return edge.crossCommunity ? 'rgba(196, 87, 10, 0.42)' : 'rgba(26, 16, 8, 0.16)';
  }

  function linkWidth(edge: Sim3DEdge): number {
    return edge.strength === 'strong' ? 2 : edge.strength === 'weak' ? 0.7 : 1.2;
  }

  /**
   * Sphere radius, as the volume the library wants.
   *
   * Quantised because the geometry cache is keyed on this value: 500 distinct
   * importances would otherwise mean 500 distinct sphere geometries.
   */
  function nodeVolume(node: Sim3DNode): number {
    return Math.round(radius(node) * 4) ** 3 / 64;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  /**
   * The 2D view's force configuration, unchanged.
   *
   * Its distances and strengths are in the same units as `radius()`, so keeping
   * the numbers keeps the character of the layout: well-connected pairs sit
   * close, peripheral ones get room, and communities pull apart into separate
   * regions rather than resolving into one ball. `SPAN` stands in for the 2D
   * view's canvas width, which is what its x/y forces were expressed against.
   */
  const SPAN = 900;

  function applyForces(fg: IntelGraph) {
    // Installed BEFORE the graph data, and with no links of its own.
    //
    // d3 initialises a force the moment it is installed, and `forceLink` throws
    // `node not found: <id>` if it holds a link whose endpoints are not among
    // the simulation's nodes. The library feeds it the nodes and links itself
    // during its own digest, which runs a frame later — so handing this force
    // the edges up front threw, and the throw took every force after it in this
    // function with it. The layout then ran on the library's defaults while
    // looking, from the outside, like it had been configured.
    fg.d3Force(
      'link',
      forceLink()
        .id((d: Sim3DNode) => d.id)
        .distance((l: { source: Sim3DNode }) => 40 + 60 / (1 + Math.min(l.source.degree ?? 1, 6)))
        .strength(0.35),
    );
    fg.d3Force('charge', forceManyBody().strength((d: Sim3DNode) => -120 - radius(d) * 12));
    fg.d3Force('center', forceCenter(0, 0, 0));
    fg.d3Force('collide', forceCollide().radius((d: Sim3DNode) => radius(d) + 4));
    // Pull clusters apart along x so communities read as separate regions — the
    // 2D view does the same, offset around the canvas centre instead of origin.
    fg.d3Force('x', forceX((d: Sim3DNode) => ((d.community % 5) - 2) * (SPAN / 7)).strength(0.045));
    fg.d3Force('y', forceY(0).strength(0.045));
    fg.d3Force('z', forceZ(0).strength(0.045));
  }

  async function build() {
    if (!container) return;
    const token = ++buildToken;
    teardown();

    readPalette(host ?? container);

    // Browser-only: the library builds a WebGL renderer at construction, so it
    // cannot be imported at module scope on a server-rendered page.
    const { default: ForceGraph3D } = await import('3d-force-graph');
    if (token !== buildToken || !container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Copies, because the force layout mutates the data it is given and the
    // props belong to the parent.
    simNodes = nodes.map((n) => {
      const prev = positions.get(n.id);
      return { ...n, x: prev?.x, y: prev?.y, z: prev?.z };
    });
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    simEdges = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e }));

    extrasById.clear();
    fitted = false;
    settledOnce = false;
    tickCount = 0;

    // Trackball rather than orbit. Orbit's controller tracks live pointers in a
    // map, and the library ends a node drag by dispatching a synthetic pointerup
    // that carries no pointer id; three's OrbitControls then looks that id up
    // and throws, on every single drag. Dragging is the whole point of the live
    // layout, so the controller that survives it wins.
    //
    // The library's instance type is generic but its constructor is not, so the
    // node/link shapes have to be reattached here. One cast, at the boundary —
    // everything downstream of it is typed against our own NetNode/NetEdge.
    const fg = new ForceGraph3D(container, { controlType: 'trackball' }) as unknown as IntelGraph;
    graph = fg;

    // Ambient-heavy so a sphere reads as close to the 2D view's flat fill as a
    // lit surface can, with just enough directional to keep it a sphere.
    fg.lights([
      new THREE.AmbientLight(0xffffff, 0.95 * Math.PI),
      new THREE.DirectionalLight(0xffffff, 0.35 * Math.PI),
    ]);

    fg
      .width(width)
      .height(height)
      // Transparent, so the wrapper's `background: var(--bg)` is what shows
      // through and the scene stays on the cream page like the 2D view.
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      // Our own tooltip, styled like the 2D one — not the library's.
      .nodeLabel(() => '')
      .linkLabel(() => '')
      .nodeRelSize(1)
      .nodeResolution(14)
      .nodeOpacity(1)
      .nodeVal(nodeVolume)
      .nodeColor(nodeColour)
      .nodeThreeObjectExtend(true)
      .nodeThreeObject(nodeExtras)
      .linkOpacity(1)
      .linkResolution(4)
      .linkColor(linkColour)
      .linkWidth(linkWidth)
      // d3's own stopping rule rather than a tick or time budget, so the layout
      // settles exactly as far as the 2D one does.
      .d3AlphaMin(0.001)
      .cooldownTicks(Infinity)
      .cooldownTime(Infinity)
      // A handful of ticks before the first frame. The 2D view starts from zero
      // too, but a 3D layout's opening moments — every node in one place, then
      // exploding outward — read as the page being broken rather than as
      // physics. This skips that and leaves the settle visible.
      .warmupTicks(simNodes.length && positions.size ? 0 : 25)
      .onNodeClick(onNodeClick)
      .onBackgroundClick(() => onSelect?.(null))
      .onNodeHover(onNodeHover)
      .onEngineTick(onTick)
      .onEngineStop(onSettled);

    applyForces(fg);
    fg.graphData({ nodes: simNodes, links: simEdges });

    // A layout at rest needs no camera move; a fresh one is framed as it settles.
    if (positions.size) {
      frameCamera(0);
      fitted = true;
    } else {
      // Off-axis on all three, so the first frame reads as a 3D scene rather
      // than a flat one seen head-on.
      fg.cameraPosition({ x: SPAN * 0.3, y: SPAN * 0.22, z: SPAN * 0.85 });
    }
  }

  /**
   * Fit once early, then again when the layout settles.
   *
   * A large graph takes seconds to come to rest and until it does it can spread
   * well outside the frustum, so the first thing anyone would see is an empty
   * scene with the graph off-camera. The 2D view fits at alpha 0.35 for the same
   * reason; with d3's default decay that is around the 45th tick, which is what
   * this counts. Halos and labels are children of their node's sphere, so they
   * follow it without any per-tick work.
   */
  const EARLY_FIT_TICK = 45;
  let tickCount = 0;

  function onTick() {
    if (!fitted && ++tickCount >= EARLY_FIT_TICK) {
      fitted = true;
      frameCamera(600);
    }
  }

  function onSettled() {
    for (const n of simNodes) {
      if (n.x != null && n.y != null && n.z != null) {
        positions.set(n.id, { x: n.x, y: n.y, z: n.z });
      }
    }
    // Frame ONCE per build. The engine also stops after every restyle and after
    // every node drag, and re-framing then would snatch away the camera the
    // user had just positioned.
    if (settledOnce) return;
    settledOnce = true;
    fitted = true;
    frameCamera(600);
  }

  /**
   * Move the camera so the BULK of the graph fills the view.
   *
   * Deliberately frames a percentile band of node positions rather than the
   * extremes, for the reason the 2D view gives: the real graph has ~184
   * disconnected fragments and ~162 isolated nodes that the layout flings to
   * the edges, and framing those shrinks the part anyone wants to read to a
   * cluster of dots. Outliers stay reachable by zooming out.
   *
   * Trimmed at 6–94% rather than the 2D view's 4–96%. That debris spreads over
   * a sphere here instead of a disc, so the same percentile buys a much larger
   * box; the tighter band is what makes the body fill the frame as it does in
   * 2D.
   *
   * Framed by hand rather than with the library's `zoomToFit`, which always
   * re-aims at the world origin and pads generously enough that this graph
   * ended up at roughly half the size the 2D view gives it.
   */
  /**
   * The nodes of the biggest connected component, or all of them if nothing is
   * joined up. Union-find over the edges — cheap at these sizes and recomputed
   * only when the camera is re-framed, which is twice per build.
   */
  function largestComponent(): Sim3DNode[] {
    if (!simEdges.length) return simNodes;

    const parent = new Map<string, string>(simNodes.map((n) => [n.id, n.id]));
    const find = (a: string): string => {
      // An endpoint we do not hold would spin the walk below forever.
      if (!parent.has(a)) return a;
      let root = a;
      while (parent.get(root) !== root) root = parent.get(root)!;
      // Path compression, so a long chain of fragments does not make this
      // quadratic on the next lookup.
      let walk = a;
      while (parent.get(walk) !== root) {
        const next = parent.get(walk)!;
        parent.set(walk, root);
        walk = next;
      }
      return root;
    };

    for (const e of simEdges) {
      const a = find(endpointId(e.source));
      const b = find(endpointId(e.target));
      if (parent.has(a) && parent.has(b) && a !== b) parent.set(a, b);
    }

    const groups = new Map<string, Sim3DNode[]>();
    for (const n of simNodes) {
      const root = find(n.id);
      const group = groups.get(root);
      if (group) group.push(n);
      else groups.set(root, [n]);
    }

    let best: Sim3DNode[] = [];
    for (const group of groups.values()) if (group.length > best.length) best = group;
    return best.length ? best : simNodes;
  }

  function frameCamera(durationMs: number) {
    const fg = graph;
    if (!fg || !simNodes.length) return;

    const camera = fg.camera() as THREE.PerspectiveCamera;
    if (!camera?.isPerspectiveCamera) return;

    // Frame the BODY: the largest connected component, not the whole point
    // cloud. This graph is ~184 fragments and ~162 isolated entities around one
    // dominant component, and every measure taken over ALL the nodes — a
    // bounding box, a per-axis percentile band, a radius holding 88% of them —
    // ends up measuring the debris rather than the thing worth reading. The 2D
    // view trims percentiles for the same reason; asking which entities are
    // actually joined to each other says it without a magic number, and keeps
    // holding when a filter cuts the graph to a fifth of its size. Fragments
    // stay reachable by zooming out.
    const body = largestComponent();

    const median = (get: (n: Sim3DNode) => number) => {
      const vals = body.map(get).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    };
    const centre = new THREE.Vector3(
      median((n) => n.x ?? 0),
      median((n) => n.y ?? 0),
      median((n) => n.z ?? 0),
    );

    // The 80th percentile within that body, not its full extent. Even the
    // connected part has long sparse arms — on the real graph its outermost
    // tenth reaches twice as far as the other nine — and framing their tips
    // shrinks the dense middle, which is the part anyone is reading, back to a
    // dot.
    const radii = body
      .map((n) => centre.distanceTo(new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0)))
      .sort((a, b) => a - b);
    // Floored against the biggest node rather than a bare constant. Pinning the
    // view to a single entity leaves a body with no spread at all, and fitting
    // THAT put the camera inside the sphere: the panel filled with flat colour
    // and the node stopped being clickable, because a ray cast from inside only
    // meets back faces. The 2D view has the same guard as its maximum zoom.
    const biggest = body.reduce((m, n) => Math.max(m, radius(n)), 0);
    const reach = Math.max(radii[Math.floor(radii.length * 0.8)] ?? 0, biggest * 5, 10);

    const halfFov = (camera.fov * Math.PI) / 360;
    // Whichever of the two apertures is narrower is the one that has to contain
    // the graph — on a wide canvas that is the vertical one.
    const half = Math.min(halfFov, Math.atan(Math.tan(halfFov) * (camera.aspect || 1)));
    // Margin covers the largest node's radius and leaves the body a little air.
    const distance = (reach / Math.sin(half)) * 1.15;

    // Keep whatever direction the camera is already looking from, so a re-fit
    // after a filter change does not also spin the scene.
    const target = (fg.controls() as { target?: THREE.Vector3 })?.target;
    const direction = camera.position.clone().sub(target ?? new THREE.Vector3());
    if (direction.lengthSq() < 1e-6) direction.set(0.35, 0.25, 1);
    direction.normalize().multiplyScalar(distance);

    fg.cameraPosition(
      { x: centre.x + direction.x, y: centre.y + direction.y, z: centre.z + direction.z },
      centre,
      durationMs,
    );
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  function onNodeClick(node: Sim3DNode) {
    const now = Date.now();
    // The library has no double-click hook, and the 2D view's click-to-inspect
    // plus double-click-to-open has to survive the port.
    if (lastClick.id === node.id && now - lastClick.at < 320) {
      lastClick = { id: '', at: 0 };
      onOpen?.(node.id);
      return;
    }
    lastClick = { id: node.id, at: now };
    onSelect?.(node.id);
  }

  function onNodeHover(node: Sim3DNode | null) {
    // The 2D view brightens a hovered node to full opacity via CSS. Materials
    // here are shared across every node of the same colour, so the hovered one
    // is given its own rather than mutating the shared instance.
    if (hoverRestore) {
      hoverRestore.mesh.material = hoverRestore.material;
      hoverRestore = null;
    }
    hovered = node ?? null;
    if (!node) return;
    tooltip = pointerAt;

    const mesh = extrasById.get(node.id)?.parent as THREE.Mesh | undefined;
    const current = mesh?.material as THREE.MeshLambertMaterial | undefined;
    if (!mesh || !current?.isMaterial) return;
    // Cached by the material being brightened, not cloned per hover: there are
    // only ten cluster colours × three opacities, and cloning on every pointer
    // move would strand a material on the GPU each time.
    let bright = brightCache.get(current.uuid);
    if (!bright) {
      bright = current.clone();
      bright.opacity = 1;
      brightCache.set(current.uuid, bright);
      owned.push(bright);
    }
    hoverRestore = { mesh, material: current };
    mesh.material = bright;
  }

  const brightCache = new Map<string, THREE.MeshLambertMaterial>();

  /**
   * Where the pointer is, tracked whether or not anything is hovered.
   *
   * A plain `let`, never $state — nothing reactive reads it, and writing $state
   * on every pointermove would be a reactive update per frame for a value the
   * template only needs at the moment a tooltip opens.
   *
   * It has to be tracked continuously because the library's hover callback
   * carries no event: without a position already on hand, the first tooltip of
   * a session opened in the panel's top-left corner instead of by the cursor.
   */
  let pointerAt = { x: 0, y: 0 };

  function onPointerMove(event: PointerEvent) {
    const rect = host?.getBoundingClientRect();
    pointerAt = {
      x: event.clientX - (rect?.left ?? 0) + 14,
      y: event.clientY - (rect?.top ?? 0) + 14,
    };
    if (hovered) tooltip = pointerAt;
  }

  /**
   * Add and remove selection halos in place.
   *
   * A plain click must not rebuild anything: the 2D view restyles its existing
   * circles rather than tearing down the SVG, and in 3D a rebuild would also
   * throw away the camera angle the user had just chosen and restart the layout
   * under them. Halos are children of their node's sphere, so once attached
   * they follow it with no further work.
   */
  let haloedIds = new Set<string>();

  function reconcileHalos() {
    const wanted = new Set<string>(pathSet);
    if (selectedId) wanted.add(selectedId);

    for (const id of haloedIds) {
      if (wanted.has(id)) continue;
      const group = extrasById.get(id);
      const halo = group?.children.find((c) => (c as THREE.Mesh).geometry === haloGeometry);
      if (halo && group) group.remove(halo);
    }
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    for (const id of wanted) {
      const group = extrasById.get(id);
      const node = byId.get(id);
      if (!group || !node) continue;
      if (group.children.some((c) => (c as THREE.Mesh).geometry === haloGeometry)) continue;
      group.add(makeHalo(radius(node)));
    }
    haloedIds = wanted;
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  function teardown() {
    hoverRestore = null;
    hovered = null;
    tickCount = 0;
    haloedIds = new Set();
    if (graph) {
      // three.js holds GPU resources garbage collection does not reclaim. The
      // library disposes its own scene here; the geometries, materials and
      // textures WE made are ours to release.
      graph._destructor();
      graph = null;
    }
    for (const res of owned.splice(0)) res.dispose();
    cageGeometry?.dispose();
    cageMaterial?.dispose();
    haloGeometry?.dispose();
    haloMaterial?.dispose();
    cageGeometry = cageMaterial = null;
    haloGeometry = haloMaterial = null;
    extrasById.clear();
    labelCache.clear();
    brightCache.clear();
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  // Rebuild only when the DATA changes. Everything build() does is untracked, so
  // the pointer handlers writing `hovered`/`tooltip` can never feed back here.
  $effect(() => {
    nodes;
    edges;
    container;
    untrack(() => void build());
  });

  // A traced path or a new keyword changes which nodes carry a label, so the
  // per-node extras have to be rebuilt. Colours change with them. The LAYOUT is
  // left alone: the library only re-heats the simulation when the graph data
  // itself changes, which is why the 2D view's full teardown is not needed here.
  //
  // Fresh function identities on purpose — passing the same reference back would
  // read as "no change" and skip the digest entirely.
  $effect(() => {
    pathKey;
    matchKey;
    const fg = graph;
    if (!fg) return;
    untrack(() => {
      // The digest hands every node a fresh material, so a material stashed by
      // the hover brightener is about to be stale — restoring it on the next
      // unhover would silently undo this restyle.
      hoverRestore = null;
      fg.nodeThreeObject((n: Sim3DNode) => nodeExtras(n));
      fg.nodeColor((n: Sim3DNode) => nodeColour(n));
      fg.linkColor((e: Sim3DEdge) => linkColour(e));
      haloedIds = new Set([...pathSet, ...(selectedId ? [selectedId] : [])]);
    });
  });

  // Selection: move the halo, and nothing else. No material is touched and no
  // digest is asked for — the 2D view restyles its circles in place for exactly
  // the same reason, and in 3D a rebuild would also throw away the camera angle
  // the user had just chosen.
  $effect(() => {
    selectedId;
    if (!graph) return;
    untrack(() => reconcileHalos());
  });

  $effect(() => {
    const el = container;
    if (!el || typeof ResizeObserver === 'undefined') return;

    // Resizing only needs the renderer and camera updated, not a relayout, so
    // unlike the 2D view this is cheap and needs no debounce.
    resizeObserver = new ResizeObserver(() => {
      if (!graph || !el) return;
      graph.width(el.clientWidth || 800).height(el.clientHeight || 600);
    });
    resizeObserver.observe(el);
    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  onDestroy(() => teardown());

  /** Matches the 2D view's export, so the parent can reset either the same way. */
  export function resetZoom() {
    frameCamera(400);
  }
</script>

<div
  class="graph-host"
  bind:this={host}
  onpointermove={onPointerMove}
  role="application"
  aria-label="Intel network, {nodes.length} entities, three-dimensional view"
>
  <div class="scene" bind:this={container}></div>

  {#if nodes.length === 0}
    <div class="empty">Nothing matches these filters.</div>
  {/if}

  {#if hovered}
    <div class="tip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
      <div class="tip-head">
        <span>{hovered.icon}</span>
        <strong>{hovered.name}</strong>
      </div>
      <div class="tip-meta">{hovered.type} · {hovered.degree} links</div>
      {#if hovered.summary}
        <p>{hovered.summary.slice(0, 160)}{hovered.summary.length > 160 ? '…' : ''}</p>
      {/if}
      {#if hovered.brokerage > 0.02}
        <div class="tip-flag">Connects separate clusters</div>
      {/if}
      <div class="tip-hint">Click to inspect · double-click to open · drag a node to disturb it</div>
    </div>
  {/if}
</div>

<style>
  /* Identical to the 2D view's host: this is the same panel on the same cream
     page, seen along one more axis. */
  .graph-host {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 420px;
    overflow: hidden;
    background: var(--bg);
    cursor: grab;
    touch-action: none;
  }
  .graph-host:active {
    cursor: grabbing;
  }

  /* The scene owns this element outright — see the note on `host` above. */
  .scene {
    position: absolute;
    inset: 0;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }

  .tip {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    max-width: 280px;
    /* Opaque — it floats over the graph. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 8px 10px;
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .tip-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  .tip-head strong {
    font-weight: 600;
  }
  .tip-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-transform: lowercase;
  }
  .tip p {
    margin: 5px 0 0;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .tip-flag {
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .tip-hint {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
