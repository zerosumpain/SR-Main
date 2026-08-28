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
  import type { NetNode, NetEdge } from '$lib/codegraph/types';
  import {
    recencyFade,
    clusterColour,
    clusterColourOf,
    clusterSlotOf,
    clusterSeedOf,
    nodeRelevance,
    relevanceScale,
    washOut,
    edgeWidth,
    edgeEmphasis,
    edgeDistanceScale,
    edgeForceStrength,
    relevancePhrase,
  } from './graph-visual';

  let {
    nodes = [],
    edges = [],
    highlightPath = null,
    matchedIds = [],
    selectedId = null,
    focusCommunities = [],
    explode = 1,
    communities = [],
    showShells = true,
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
    /**
     * The clusters to bring forward. Empty means all of them.
     *
     * Focus is a VIEW state, not a filter: everything stays on screen and keeps
     * its position, the rest simply recedes. Where clusters interpenetrate —
     * which is the whole problem in 3D — removing the others would answer a
     * different question ("what is in this cluster") from the one being asked
     * ("where does this cluster sit among the rest").
     *
     * A LIST rather than one id because the question that survives focusing a
     * single cluster is almost always about a second one: which of these two
     * regions does the overlap belong to, and what sits in it.
     */
    focusCommunities?: number[];
    /**
     * How far apart to push the communities. 1 is the natural layout; above
     * that they separate along their own directions.
     */
    explode?: number;
    /** Cluster ids with their names, so a shell can be labelled. */
    communities?: Array<{ id: number; size: number; label: string; colourIndex?: number | null; key?: string | null }>;
    /** Draw the translucent cluster shells. */
    showShells?: boolean;
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
  /**
   * Why the scene failed to start, or null.
   *
   * `build()` is fire-and-forget from an effect, so before this every way it
   * could fail — the dynamic import not arriving, WebGL refusing a context, a
   * driver-level three.js error — became an unhandled rejection and left a
   * blank panel with nothing to read. A 3D view that cannot start has to say
   * so and point at the 2D one, which always works.
   */
  let buildError = $state<string | null>(null);

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
  /** id → sim node, so an edge can ask about its endpoints' clusters. */
  let simById = new Map<string, Sim3DNode>();
  let resizeObserver: ResizeObserver | null = null;
  /** Node id → the extras group parented to that node's sphere. */
  const extrasById = new Map<string, THREE.Group>();
  /**
   * Cluster shells and their name labels, added to the SCENE rather than to a
   * node.
   *
   * Safe, and checked against the library: `three-render-objects` raycasts only
   * `[forceGraph]`, so scene children are never hit-tested and need no
   * `raycast` stub, and its teardown empties the whole scene and disposes what
   * it finds — so these are cleaned up with everything else.
   */
  const shells: THREE.Object3D[] = [];
  /** Which cluster each shell belongs to, so focus can dim the others. */
  const shellCommunity = new Map<THREE.Object3D, number>();
  /** Loaded with the graph library; three's addons cannot be imported on the server. */
  let ConvexGeometryCtor: (typeof import('three/addons/geometries/ConvexGeometry.js'))['ConvexGeometry'] | null = null;
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
    mono: 'ui-monospace, monospace',
  };

  function readPalette(el: HTMLElement) {
    const cs = getComputedStyle(el);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    palette = {
      bg: v('--bg', '#ede4d4'),
      accent: v('--accent', '#c4570a'),
      label: v('--text-secondary', '#3d2e1a'),
      font: v('--font-body', 'system-ui, sans-serif'),
      // Cluster names are a LABEL, so they take the mono face the design system
      // reserves for labels rather than the body face entity names use.
      mono: v('--font-mono', 'ui-monospace, monospace'),
    };
  }

  /** `#rrggbb` + alpha → the `rgba()` string the graph's colour accessors parse. */
  function rgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '').trim();
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = Number.parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  const communityLabels = $derived(new Map(communities.map((c) => [c.id, c.label])));
  const pathSet = $derived(new Set(highlightPath ?? []));
  const matchSet = $derived(new Set(matchedIds ?? []));
  const focusSet = $derived(new Set(focusCommunities ?? []));
  /** Only dim when there is something to dim AGAINST. */
  const dimming = $derived(matchSet.size > 0);
  /**
   * Stable dependency keys. The parent hands fresh arrays on every render, so
   * depending on the arrays themselves would restyle the scene continuously.
   */
  const pathKey = $derived((highlightPath ?? []).join('|'));
  const matchKey = $derived((matchedIds ?? []).join('|'));
  const focusKey = $derived((focusCommunities ?? []).join(','));

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
    // Modulated by how much the entity still counts, and floored so the least
    // relevant dot is still something you can aim at. Identical to the 2D view's.
    const base = Math.max(4, structuralRadius(n) * relevanceScale(nodeRelevance(n)));
    // Focused clusters keep their size; the rest shrink towards the background.
    // Shrinking as well as fading matters in 3D specifically: a distant node is
    // already small, so opacity alone leaves the context reading as foreground.
    return outOfFocus(n) ? base * 0.55 : base;
  }

  /** Size from importance alone — what decides which nodes are NAMED. See the
   *  2D view, which carries the reasoning. */
  function structuralRadius(n: NetNode): number {
    // sqrt so a 10× importance difference is a ~3× size difference.
    return 5 + Math.sqrt(Math.max(0, n.importance)) * 20;
  }

  /** True when a focus is set and this node is not part of it. */
  function outOfFocus(n: NetNode): boolean {
    return focusSet.size > 0 && !focusSet.has(n.community);
  }

  /**
   * The 2D view's fill-opacity rules, unchanged.
   *
   * Age is deliberately NOT here any more — it is carried by size and by the
   * colour wash in `nodeColour`, in both views. Opacity was already holding
   * `confirmed`, the keyword dimming and cluster focus, and a fourth meaning on
   * the same channel made all four unreadable.
   */
  function nodeAlpha(n: NetNode): number {
    const base = dimming && !matchSet.has(n.id) ? 0.14 : n.confirmed ? 0.85 : 0.4;
    return base * (outOfFocus(n) ? 0.18 : 1);
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
    if (pathSet.has(n.id) || matchSet.has(n.id)) return true;
    return !outOfFocus(n) && structuralRadius(n) > 10;
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
  function makeLabel(
    text: string,
    face: string = palette.font,
    height: number = 0.021,
  ): THREE.Sprite | null {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Same truncation as the 2D view, so a name reads identically in both.
    const label = text.length > 26 ? `${text.slice(0, 24)}…` : text;
    const fontSize = 48;
    const font = `500 ${fontSize}px ${face}`;
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
    // this panel. Cluster names pass a larger one: they name a region rather
    // than a node, so they should be readable when zoomed out far enough that
    // the entity labels are not.
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

    // Built for anything that STRUCTURALLY earns a name, then hidden if focus
    // says otherwise — rather than not built at all. Skipping construction while
    // a cluster was focused left those nodes with no sprite to bring back when
    // the focus was cleared, so a filter change mid-focus permanently un-named
    // most of the graph until the next rebuild.
    if (structuralRadius(node) > 10 || pathSet.has(node.id) || matchSet.has(node.id)) {
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
        // Explicit, because a cached sprite carries the flag it was last given.
        sprite.visible = earnsLabel(node);
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
    // Washed towards the page by staleness, using the LIVE background token
    // rather than the literal the 2D view can fall back to — the scene reads its
    // palette off the element so it follows the design system.
    return rgba(washOut(clusterColourOf(node), nodeRelevance(node), palette.bg), nodeAlpha(node));
  }

  function linkColour(edge: Sim3DEdge): string {
    const key = [endpointId(edge.source), endpointId(edge.target)].sort().join('|');
    if (pathEdgeKeys.has(key)) return palette.accent;
    // The literals the 2D view uses, so the same link is the same colour in both,
    // with the same age fade multiplied into their alpha.
    const a = simById.get(endpointId(edge.source));
    const b = simById.get(endpointId(edge.target));
    // An edge recedes unless BOTH ends are in focus — a half-faded edge leaving
    // the focused cluster is exactly the thing worth seeing, so it is drawn at
    // the context level rather than removed.
    const focusFade = (a && outOfFocus(a)) || (b && outOfFocus(b)) ? 0.2 : 1;
    const fade = recencyFade(edge.recency) * focusFade * edgeEmphasis(edge.weight);
    return edge.crossCommunity
      ? `rgba(196, 87, 10, ${(0.42 * fade).toFixed(3)})`
      : `rgba(26, 16, 8, ${(0.16 * fade).toFixed(3)})`;
  }

  /** Continuous in weight, not the three-value bucket — see graph-visual. */
  function linkWidth(edge: Sim3DEdge): number {
    return edgeWidth(edge.weight);
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
        // Weight-scaled exactly as in 2D, so proximity means how well
        // corroborated a relationship is and not merely that one exists.
        .distance(
          (l: { source: Sim3DNode; weight?: number }) =>
            (40 + 60 / (1 + Math.min(l.source.degree ?? 1, 6))) * edgeDistanceScale(l.weight),
        )
        .strength((l: { weight?: number }) => edgeForceStrength(l.weight)),
    );
    fg.d3Force('charge', forceManyBody().strength((d: Sim3DNode) => -120 - radius(d) * 12));
    fg.d3Force('center', forceCenter(0, 0, 0));
    fg.d3Force('collide', forceCollide().radius((d: Sim3DNode) => radius(d) + 4));
    applySeparation(fg);
  }

  /**
   * Where each community sits relative to the middle, as a unit vector.
   *
   * Golden-angle spiral over the sphere, so any number of communities spreads
   * evenly and — this is the part that matters — a given community index always
   * gets the SAME direction. A random or hash-ordered arrangement would send
   * clusters somewhere new every time the graph reloaded, and the layout would
   * stop being somewhere you can learn your way around.
   *
   * The 2D view spreads communities along x alone. Doing that in 3D wastes two
   * of the three axes, which is a large part of why clusters ended up meshed.
   */
  function communityDirection(c: number): { x: number; y: number; z: number } {
    const i = Math.abs(Math.floor(c));
    // Deterministic point on a Fibonacci sphere. The half-step offset keeps
    // index 0 off the pole, where neighbouring directions crowd together.
    //
    // The clamp is load-bearing, not defensive: with a whole-step offset the
    // last index drives the acos argument just past -1, which returns NaN — and
    // a NaN force target propagates into the node positions, out to the convex
    // hulls built from them, and surfaces as "computed radius is NaN" from
    // three's bounding-sphere maths, a long way from the cause.
    const n = 24;
    const k = (i % n) + 0.5;
    const phi = Math.acos(Math.max(-1, Math.min(1, 1 - (2 * k) / n)));
    const theta = Math.PI * (1 + Math.sqrt(5)) * k;
    return {
      x: Math.cos(theta) * Math.sin(phi),
      y: Math.sin(theta) * Math.sin(phi),
      z: Math.cos(phi),
    };
  }

  /**
   * The three positional forces that hold communities apart, scaled by
   * `explode`. Re-installable on its own: `forceX/Y/Z` resolve no ids, so unlike
   * `forceLink` they can be replaced after `graphData()` without throwing.
   */
  /**
   * Draw a translucent shell around each community, with its name floating at
   * the centroid.
   *
   * Rebuilt on demand, never per tick: twenty convex hulls at 60fps is ~120ms of
   * main thread per second plus a geometry upload per hull per frame, which is
   * the way to make this technique unusable. The layout is visibly moving while
   * the engine runs, so shells appear when it stops.
   */
  /**
   * The extent of a cluster, drawn as a translucent shell with its name on it.
   *
   * Two things this deliberately does NOT do, both learned by drawing it the
   * obvious way first and looking at the result:
   *
   *  1. It does not shell every cluster at once. Twenty-four translucent hulls
   *     over one another is not a legibility aid, it is a fog — it hid the graph
   *     more effectively than the meshing it was meant to solve. A shell answers
   *     "how far does THIS cluster reach", which is a question about one
   *     cluster, so it is drawn for the SELECTED ones only. Selecting several is
   *     supported and is the point: the hard question is where two clusters
   *     overlap, and that needs both outlines on screen at once. What is bounded
   *     is how many are drawn WITHOUT being asked for — which is none.
   *  2. It does not hull every member. A community owns outliers flung to the
   *     edge of the layout, and their convex hull is a huge spiky polygon that
   *     describes the debris rather than the body. Points are trimmed to those
   *     within the 80th percentile of distance from the centre, the same
   *     reasoning (and roughly the same percentile) as `frameCamera`.
   *
   * Cluster NAMES are cheap and useful everywhere, so those are drawn for every
   * cluster big enough to be worth naming, focused or not.
   */
  function rebuildShells() {
    const fg = graph;
    if (!fg) return;
    clearShells();
    if (!showShells) return;

    const byCommunity = new Map<number, Sim3DNode[]>();
    for (const n of simNodes) {
      if (n.x == null || n.y == null || n.z == null) continue;
      const list = byCommunity.get(n.community);
      if (list) list.push(n);
      else byCommunity.set(n.community, [n]);
    }

    // The clusters big enough to orient by when nothing is focused.
    const namedClusters = new Set(
      [...communities].sort((a, b) => b.size - a.size).slice(0, 8).map((c) => c.id),
    );

    const scene = fg.scene();
    for (const [community, members] of byCommunity) {
      // The cluster's DURABLE palette slot, taken from any member — every member
      // of a community carries the same one. Colouring a shell by the community
      // index would repaint it on every run, exactly as the nodes inside it used
      // to be repainted.
      const slot = clusterSlotOf(members[0]);
      const points = members.map((n) => new THREE.Vector3(n.x!, n.y!, n.z!));
      const centre = points
        .reduce((acc, p) => acc.add(p), new THREE.Vector3())
        .multiplyScalar(1 / points.length);

      // Named only where a name earns its space. Every cluster labelled at once
      // put two dozen names on top of each other in the middle of the scene,
      // because that is where most centroids are — the labels obscured the graph
      // they were annotating. With a cluster focused, its name is the only one
      // that is being asked about; otherwise the biggest few orient you and the
      // rest are a click away in the picker.
      //
      // Placed on the BODY rather than on the mean of body plus outliers, so the
      // name sits where the cluster looks like it is.
      const name = communityLabels.get(community);
      const worthNaming = focusSet.size ? focusSet.has(community) : namedClusters.has(community);
      if (name && worthNaming && members.length >= 4) {
        const core = trimmed(points, centre);
        const coreCentre = core
          .reduce((acc, p) => acc.add(p), new THREE.Vector3())
          .multiplyScalar(1 / core.length);
        const sprite = makeLabel(name, palette.mono, 0.03);
        if (sprite) {
          sprite.center.set(0.5, 0.5);
          sprite.position.copy(coreCentre);
          scene.add(sprite);
          shells.push(sprite);
          shellCommunity.set(sprite, community);
        }
      }

      if (!focusSet.has(community)) continue;
      if (members.length < 3) continue;

      const core = trimmed(points, centre);
      const coreCentre = core
        .reduce((acc, p) => acc.add(p), new THREE.Vector3())
        .multiplyScalar(1 / core.length);

      let geometry: THREE.BufferGeometry | null = null;
      // ConvexHull needs four points and silently produces an EMPTY hull below
      // that — and also for four or more coplanar ones, which a small cluster
      // laid out flat can easily be. An invisible mesh with a zero-radius
      // bounding sphere is much harder to diagnose than a sphere that is
      // obviously a fallback, so the degenerate cases get one deliberately.
      if (core.length >= 4 && ConvexGeometryCtor) {
        try {
          const hull = new ConvexGeometryCtor(core);
          const pos = hull.getAttribute('position');
          if (pos && pos.count > 0 && Number.isFinite(pos.array[0])) geometry = hull;
          else hull.dispose();
        } catch {
          geometry = null;
        }
      }
      if (!geometry) {
        const spread = Math.max(...core.map((p) => p.distanceTo(coreCentre)), 12);
        geometry = new THREE.SphereGeometry(spread * 1.1, 12, 8);
      }

      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(clusterColour(slot)),
        transparent: true,
        opacity: 0.1,
        // BackSide + no depth write, copying the selection halo: the shell has to
        // sit BEHIND the nodes it contains, and a front-facing translucent hull
        // over ~600 already-transparent node materials flickers as the camera
        // orbits and the depth sort flips.
        side: THREE.BackSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = -1;
      scene.add(mesh);
      shells.push(mesh);
      shellCommunity.set(mesh, community);

      // The BORDER, which is what actually makes two selected clusters legible.
      //
      // A translucent fill alone cannot answer "where does this one end and that
      // one begin": two washes over the same region blend into a third colour
      // and the boundary between them is exactly the information that
      // disappears. An edge is a line whether or not something else crosses it.
      //
      // `EdgesGeometry` at a 18° threshold merges the hull's coplanar triangles
      // back into its actual polygon faces — without it this is the wireframe of
      // a triangulation, which is noise. The 2D view draws the same outline as a
      // stroked polygon for the same reason.
      const outline = new THREE.EdgesGeometry(geometry, 18);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(clusterColour(slot)),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(outline, outlineMaterial);
      lines.renderOrder = -1;
      lines.raycast = () => {};
      scene.add(lines);
      shells.push(lines);
      shellCommunity.set(lines, community);
    }
  }

  /**
   * The dense part of a point cloud — everything inside the 80th percentile of
   * distance from its centre.
   */
  function trimmed(points: THREE.Vector3[], centre: THREE.Vector3): THREE.Vector3[] {
    if (points.length < 6) return points;
    const withDist = points
      .map((p) => ({ p, d: p.distanceTo(centre) }))
      .sort((a, b) => a.d - b.d);
    const keep = Math.max(4, Math.floor(withDist.length * 0.8));
    return withDist.slice(0, keep).map((x) => x.p);
  }

  function clearShells() {
    const fg = graph;
    for (const o of shells) {
      o.parent?.remove(o);
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material & { map?: THREE.Texture } }).material;
      if (mat) {
        mat.map?.dispose();
        mat.dispose();
      }
    }
    shells.length = 0;
    shellCommunity.clear();
    void fg;
  }

  function applySeparation(fg: IntelGraph) {
    const reach = (SPAN / 7) * Math.max(0, explode);
    fg.d3Force('x', forceX((d: Sim3DNode) => communityDirection(clusterSeedOf(d)).x * reach).strength(0.045));
    fg.d3Force('y', forceY((d: Sim3DNode) => communityDirection(clusterSeedOf(d)).y * reach).strength(0.045));
    fg.d3Force('z', forceZ((d: Sim3DNode) => communityDirection(clusterSeedOf(d)).z * reach).strength(0.045));
  }

  async function build() {
    if (!container) return;
    // Cleared on every attempt, or one transient failure would pin the banner
    // over a graph that has since built fine — this effect re-runs on every
    // filter change.
    buildError = null;
    try {
      await buildScene();
    } catch (err) {
      buildError = err instanceof Error ? err.message : 'the 3D view could not start';
      console.error('[intel:3d] build failed', err);
    }
  }

  async function buildScene() {
    if (!container) return;
    const token = ++buildToken;
    teardown();

    readPalette(host ?? container);

    // Browser-only: the library builds a WebGL renderer at construction, so it
    // cannot be imported at module scope on a server-rendered page.
    const [{ default: ForceGraph3D }, { ConvexGeometry }] = await Promise.all([
      import('3d-force-graph'),
      // three's addons are browser-only for the same reason the graph is, and
      // the repo already imports them by this path (see $lib/sim/federation).
      import('three/addons/geometries/ConvexGeometry.js'),
    ]);
    ConvexGeometryCtor = ConvexGeometry;
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
    simById = byId;
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
  /** d3's own default. Restored after an exploded-view reheat borrows a faster one. */
  const DEFAULT_ALPHA_DECAY = 0.0228;
  /** Cools in ~50 ticks instead of ~300, so the slider feels like a control. */
  const EXPLODE_ALPHA_DECAY = 0.08;
  let tickCount = 0;

  function onTick() {
    if (!fitted && ++tickCount >= EARLY_FIT_TICK) {
      fitted = true;
      frameCamera(600);
    }
  }

  function onSettled() {
    // The layout is at rest, so the hulls drawn now will still fit in a moment.
    // Rebuilding them while the engine runs would mean twenty convex hulls per
    // frame, which is what makes this technique unusable if wired naively.
    rebuildShells();
    // Restore the settling speed the exploded-view slider borrowed.
    graph?.d3AlphaDecay(DEFAULT_ALPHA_DECAY);
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
    clearShells();
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

  /**
   * Bring a cluster forward, or let them all back.
   *
   * Deliberately re-sets ONLY the colour and size accessors. `nodeThreeObject`
   * is left alone because changing it makes the library clear its node object
   * cache and rebuild all six hundred groups — every label sprite, halo and
   * broker cage — where a colour change swaps materials it already has. Fresh
   * function identities on purpose: kapsule compares accessors by reference and
   * an identical one is a no-op.
   *
   * The cluster shell is rebuilt here because focus decides which cluster has
   * one at all — see rebuildShells.
   */
  $effect(() => {
    // A stable key: the parent hands a fresh array each render, so depending on
    // the array itself would restyle the scene continuously.
    focusKey;
    const fg = graph;
    if (!fg) return;
    untrack(() => {
      hoverRestore = null;
      fg.nodeColor((n: Sim3DNode) => nodeColour(n));
      fg.nodeVal((n: Sim3DNode) => nodeVolume(n));
      fg.linkColor((e: Sim3DEdge) => linkColour(e));
      // The shells belong to whichever clusters are selected, so this is a
      // rebuild rather than a restyle. It is cheap: one hull per SELECTED
      // cluster, and nothing is selected by default.
      rebuildShells();
      reconcileLabels();
    });
  });

  /**
   * Show or hide the name sprites for the current focus.
   *
   * By TOGGLING rather than rebuilding: `nodeThreeObject` is deliberately left
   * alone here, because re-setting it makes the library drop its node-object
   * cache and rebuild all six hundred groups. Every sprite already exists and is
   * parented to its node, so this is a visibility flag per label.
   *
   * The 2D view hides its <text> on focus for the same reason: a dimmed cluster
   * that keeps shouting its names over the focused one defeats the focusing.
   */
  function reconcileLabels() {
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    for (const [id, group] of extrasById) {
      const node = byId.get(id);
      if (!node) continue;
      const wanted = earnsLabel(node);
      for (const child of group.children) {
        if ((child as THREE.Sprite).isSprite) child.visible = wanted;
      }
    }
  }

  /**
   * Push the communities apart, or let them settle back together.
   *
   * The separation is the layout's own x/y/z forces with a scalar on them, so
   * this is a physics change rather than a second arrangement of the same graph
   * — nodes travel to the new positions instead of jumping. The engine has to be
   * reheated for a force change to take effect at all (a settled simulation
   * never ticks), and the decay is raised first so it comes to rest in about a
   * second rather than the five a full reheat would take.
   */
  $effect(() => {
    explode;
    const fg = graph;
    if (!fg || !simNodes.length) return;
    untrack(() => {
      // The hulls are about to be wrong; drop them until the layout rests.
      clearShells();
      applySeparation(fg);
      fg.d3AlphaDecay(EXPLODE_ALPHA_DECAY);
      fg.d3ReheatSimulation();
    });
  });

  $effect(() => {
    showShells;
    if (!graph) return;
    untrack(() => rebuildShells());
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

  {#if buildError}
    <div class="empty">The 3D view could not start ({buildError}). Switch to 2D.</div>
  {:else if nodes.length === 0}
    <div class="empty">Nothing matches these filters.</div>
  {/if}

  {#if hovered}
    <div class="tip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
      <div class="tip-head">
        <span>{hovered.icon}</span>
        <strong>{hovered.name}</strong>
      </div>
      <div class="tip-meta">
        {hovered.type} · {hovered.degree} links · {relevancePhrase(nodeRelevance(hovered))}
      </div>
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
    border: 1px solid var(--line-strong);
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
