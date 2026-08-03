<script lang="ts">
  // The intel network as a 3D spatial graph, in the shape Obsidian popularised.
  //
  // Same data and the same encodings as the 2D NetworkGraph — this is a second
  // VIEW, not a second model, and the two must never disagree about what the
  // graph says:
  //
  //   size    PageRank importance (sqrt, so a mega-hub does not flatten the rest)
  //   colour  detected community
  //   opacity staleness — old evidence fades rather than disappearing
  //   edges   width and alpha from the continuous `weight`; accent for the
  //           cross-community ones, because those are the interesting links
  //
  // Why a third dimension is worth the complexity: a force layout in 2D has to
  // resolve every cluster onto one plane, so dense graphs settle into a hairball
  // where unrelated communities overlap simply because there is nowhere else to
  // put them. In 3D they separate, and rotating the view disambiguates depth in
  // a way no amount of 2D panning can.
  //
  // PERFORMANCE. Nodes are ONE InstancedMesh and edges ONE LineSegments, so a
  // 600-node graph is two draw calls rather than twelve hundred. Labels are the
  // expensive part (a canvas texture each) and are therefore limited to the most
  // important handful plus whatever is hovered or on a path.
  //
  // REACTIVITY. Every three.js and d3 handle below is a plain `let`, never
  // $state. Nothing reactive reads them, and a render loop that both reads and
  // writes reactive state is the documented route to effect_update_depth_exceeded
  // (see the svelte5-pitfalls skill). Only `hovered` and `tooltip` — which the
  // template reads — are reactive.

  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import {
    forceSimulation,
    forceLink,
    forceManyBody,
    forceCenter,
    forceCollide,
  } from 'd3-force-3d';
  import { untrack, onDestroy } from 'svelte';

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
    highlightPath?: string[] | null;
    matchedIds?: string[];
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
    onOpen?: (id: string) => void;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let hovered = $state<NetNode | null>(null);
  let tooltip = $state({ x: 0, y: 0 });

  // ── Non-reactive handles ───────────────────────────────────────────────────
  interface Sim3DNode extends NetNode {
    x?: number; y?: number; z?: number;
    fx?: number | null; fy?: number | null; fz?: number | null;
  }

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let nodeMesh: THREE.InstancedMesh | null = null;
  let edgeLines: THREE.LineSegments | null = null;
  let ringMesh: THREE.InstancedMesh | null = null;
  let labelGroup: THREE.Group | null = null;
  let simulation: ReturnType<typeof forceSimulation> | null = null;
  let raycaster: THREE.Raycaster | null = null;
  let frameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let simNodes: Sim3DNode[] = [];
  /**
   * `forceLink().id()` REPLACES `source`/`target` with the node objects once the
   * simulation is built, so after that point they are no longer the id strings
   * `NetEdge` declares. Omitted and re-declared rather than cast at each use, so
   * the two forms are visible in the type instead of being a surprise.
   */
  type Sim3DEdge = Omit<NetEdge, 'source' | 'target'> & {
    source: string | Sim3DNode;
    target: string | Sim3DNode;
  };
  let simEdges: Sim3DEdge[] = [];
  /** instance index → node, for raycast hit resolution. */
  let indexToNode: Sim3DNode[] = [];
  /** Positions survive a filter change so the layout does not jump. */
  const positions = new Map<string, { x: number; y: number; z: number }>();
  const pointer = new THREE.Vector2();
  let hoveredInstance = -1;
  /** Set while the pointer is down, so a drag-to-orbit is not read as a click. */
  let dragged = false;

  /** Matches the 2D view's palette exactly — the same cluster must be the same
   *  colour in both, or switching views looks like switching graphs. */
  const CLUSTER_COLOURS = [
    '#0e5b66', '#c4570a', '#2d7a3a', '#7a3a8a', '#b0892a',
    '#3a6ea5', '#a53a3a', '#4a7a6a', '#8a5a2a', '#5a4a8a',
  ];
  const clusterColour = (c: number) => CLUSTER_COLOURS[c % CLUSTER_COLOURS.length];

  const pathSet = $derived(new Set(highlightPath ?? []));
  const matchSet = $derived(new Set(matchedIds ?? []));
  const dimming = $derived(matchSet.size > 0);

  const pathEdgeKeys = $derived.by(() => {
    const set = new Set<string>();
    const p = highlightPath ?? [];
    for (let i = 0; i < p.length - 1; i++) set.add([p[i], p[i + 1]].sort().join('|'));
    return set;
  });

  /**
   * Same sqrt curve as the 2D view, in the normalised world (see WORLD_EXTENT).
   *
   * The floor matters more here than in 2D: importance is PageRank divided by
   * the graph's maximum, so on a graph with one dominant hub almost every other
   * node scores near zero. A floor proportional to the world keeps the long
   * tail visible instead of rendering it sub-pixel.
   */
  function radius(n: NetNode): number {
    return 1.1 + Math.sqrt(Math.max(0, n.importance)) * 6.5;
  }

  /**
   * How solid a node is drawn.
   *
   * Staleness is folded in here rather than into size: shrinking an old node
   * would misreport its importance, which is a claim about structure, not age.
   * Fading says "still there, less current", which is what decay actually means.
   */
  function nodeAlpha(n: NetNode): number {
    if (dimming && !matchSet.has(n.id)) return 0.14;
    const base = n.confirmed ? 1 : 0.78;
    const recency = Number.isFinite(n.recency) ? n.recency : 1;
    // Floored well above zero: this drives a lerp toward the near-black
    // background, so a low value does not dim a node, it erases it.
    return Math.max(0.45, base * (0.7 + 0.3 * recency));
  }

  function endpointId(v: unknown): string {
    return typeof v === 'string' ? v : ((v as { id?: string })?.id ?? '');
  }

  function disposeScene() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    simulation?.stop();
    simulation = null;
    controls?.dispose();
    controls = null;

    // three.js holds GPU resources that garbage collection does not reclaim.
    // Without this, every filter change leaks a full set of buffers and
    // textures and the tab's memory climbs until the context is lost.
    scene?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
      const sprite = obj as THREE.Sprite;
      if (sprite.isSprite) sprite.material?.map?.dispose();
    });
    scene = null;
    nodeMesh = null;
    ringMesh = null;
    edgeLines = null;
    labelGroup = null;
    camera = null;

    renderer?.dispose();
    if (renderer?.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  /** A text label as a camera-facing sprite. */
  function makeLabel(text: string, colour: string): THREE.Sprite | null {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const label = text.length > 26 ? `${text.slice(0, 24)}…` : text;
    const fontSize = 44;
    ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
    const width = Math.ceil(ctx.measureText(label).width) + 24;
    canvas.width = width;
    canvas.height = fontSize + 20;

    // Re-set after resizing the canvas — changing width/height resets context state.
    ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    // Outlined so a label stays readable over both a bright node and the void.
    ctx.strokeStyle = 'rgba(12, 10, 9, 0.85)';
    ctx.lineWidth = 6;
    ctx.strokeText(label, 12, canvas.height / 2);
    ctx.fillStyle = colour;
    ctx.fillText(label, 12, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    sprite.scale.set((canvas.width / canvas.height) * 4.5, 4.5, 1);
    return sprite;
  }

  function build() {
    if (!container) return;
    disposeScene();

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(58, width / height, 0.5, 6000);
    camera.position.set(0, 0, 320);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.outline = 'none';
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.minDistance = 20;
    controls.maxDistance = 2200;

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 1, 1);
    scene.add(key);

    // Copies — the force layout mutates what it is given, and the props belong
    // to the parent.
    simNodes = nodes.map((n) => {
      const prev = positions.get(n.id);
      return { ...n, x: prev?.x, y: prev?.y, z: prev?.z };
    });
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    simEdges = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e }));

    if (!simNodes.length) {
      // Nothing to lay out, but the renderer still needs to paint the empty
      // scene or the canvas keeps whatever was on it before the filter.
      renderer.render(scene, camera);
      return;
    }

    simulation = forceSimulation(simNodes, 3)
      .force(
        'link',
        forceLink(simEdges)
          .id((d: Sim3DNode) => d.id)
          .distance((l: { source: Sim3DNode }) => 26 + 34 / (1 + Math.min(l.source.degree ?? 1, 6)))
          .strength(0.32),
      )
      .force('charge', forceManyBody().strength((d: Sim3DNode) => -95 - radius(d) * 9))
      .force('center', forceCenter(0, 0, 0))
      .force('collide', forceCollide().radius((d: Sim3DNode) => radius(d) + 2.5))
      .stop();

    // Run the layout to completion up front rather than animating it.
    //
    // A visibly settling 3D layout reads as the page being broken — nodes fly
    // through each other for several seconds — and the camera cannot be framed
    // until the extent is known. Ticking synchronously costs a fraction of a
    // second at these sizes and the graph appears already composed.
    const ticks = Math.min(300, Math.max(90, Math.round(1400 / Math.sqrt(simNodes.length))));
    for (let i = 0; i < ticks; i++) simulation.tick();

    normaliseLayout();

    for (const n of simNodes) {
      if (n.x != null && n.y != null && n.z != null) {
        positions.set(n.id, { x: n.x, y: n.y, z: n.z });
      }
    }

    buildNodes();
    buildEdges();
    buildLabels();
    frameCamera(width, height);
    animate();
  }

  /** The world-space size the graph body is scaled to fill. */
  const WORLD_EXTENT = 220;

  /**
   * Rescale the settled layout to a FIXED world size.
   *
   * Without this the layout's extent depends on node count and connectivity —
   * a 500-node graph settles across many hundreds of units, a 20-node one
   * across a few dozen. Node radii are in absolute units, so on the large graph
   * every sphere was sub-pixel and the first render showed edges floating in an
   * empty void. Normalising means one node-size curve and one camera distance
   * work for every graph.
   *
   * Scaled on the 5th–95th percentile rather than the extremes: with 184
   * components and 162 isolated nodes, the layout flings fragments a long way
   * out, and fitting those compresses the part worth reading into a dot.
   */
  function normaliseLayout() {
    if (!simNodes.length) return;

    const spread = (get: (n: Sim3DNode) => number) => {
      const vals = simNodes.map(get).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      if (vals.length < 3) return 1;
      const lo = vals[Math.floor(vals.length * 0.05)];
      const hi = vals[Math.min(vals.length - 1, Math.ceil(vals.length * 0.95))];
      return Math.max(1e-6, hi - lo);
    };

    const extent = Math.max(
      spread((n) => n.x ?? 0),
      spread((n) => n.y ?? 0),
      spread((n) => n.z ?? 0),
    );
    const scale = WORLD_EXTENT / extent;

    // Centre on the MEDIAN, not the mean: a handful of far-flung fragments drag
    // a mean well outside the body of the graph.
    const mid = (get: (n: Sim3DNode) => number) => {
      const vals = simNodes.map(get).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    };
    const cx = mid((n) => n.x ?? 0);
    const cy = mid((n) => n.y ?? 0);
    const cz = mid((n) => n.z ?? 0);

    for (const n of simNodes) {
      n.x = ((n.x ?? 0) - cx) * scale;
      n.y = ((n.y ?? 0) - cy) * scale;
      n.z = ((n.z ?? 0) - cz) * scale;
    }
  }

  function buildNodes() {
    if (!scene) return;
    const geometry = new THREE.SphereGeometry(1, 16, 12);
    const material = new THREE.MeshLambertMaterial({ transparent: true, opacity: 1 });

    nodeMesh = new THREE.InstancedMesh(geometry, material, simNodes.length);
    nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(simNodes.length * 3),
      3,
    );

    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    indexToNode = [];

    simNodes.forEach((n, i) => {
      const r = radius(n);
      matrix.makeScale(r, r, r);
      matrix.setPosition(n.x ?? 0, n.y ?? 0, n.z ?? 0);
      nodeMesh!.setMatrixAt(i, matrix);

      // Per-instance alpha is not available on a shared material, so staleness
      // and dimming are baked into the COLOUR — mixed toward the background
      // rather than made transparent. Visually equivalent here and it keeps the
      // whole graph in one draw call.
      colour.set(clusterColour(n.community));
      colour.lerp(new THREE.Color('#12100e'), 1 - nodeAlpha(n));
      nodeMesh!.setColorAt(i, colour);
      indexToNode[i] = n;
    });

    nodeMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
    scene.add(nodeMesh);

    // Brokers — entities holding otherwise separate clusters together — get a
    // halo, the 3D equivalent of the 2D dashed ring.
    const brokers = simNodes.filter((n) => n.brokerage > 0.02);
    if (brokers.length) {
      ringMesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 14, 10),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color('#c4570a'),
          transparent: true,
          opacity: 0.16,
          side: THREE.BackSide,
        }),
        brokers.length,
      );
      brokers.forEach((n, i) => {
        const r = radius(n) * 1.6;
        matrix.makeScale(r, r, r);
        matrix.setPosition(n.x ?? 0, n.y ?? 0, n.z ?? 0);
        ringMesh!.setMatrixAt(i, matrix);
      });
      ringMesh.instanceMatrix.needsUpdate = true;
      scene.add(ringMesh);
    }
  }

  function buildEdges() {
    if (!scene || !simEdges.length) return;

    const positionsArr = new Float32Array(simEdges.length * 6);
    const colours = new Float32Array(simEdges.length * 6);
    const colour = new THREE.Color();
    const base = new THREE.Color('#12100e');

    simEdges.forEach((e, i) => {
      // Node objects by now — the simulation has been built and ticked.
      const a = e.source as Sim3DNode;
      const b = e.target as Sim3DNode;
      if (!a || typeof a === 'string' || !b || typeof b === 'string') return;
      const o = i * 6;
      positionsArr[o] = a.x ?? 0;
      positionsArr[o + 1] = a.y ?? 0;
      positionsArr[o + 2] = a.z ?? 0;
      positionsArr[o + 3] = b.x ?? 0;
      positionsArr[o + 4] = b.y ?? 0;
      positionsArr[o + 5] = b.z ?? 0;

      const onPath = pathEdgeKeys.has([endpointId(e.source), endpointId(e.target)].sort().join('|'));
      colour.set(onPath ? '#e07a1f' : e.crossCommunity ? '#c4570a' : '#8a9199');

      // Weight and staleness both read as how strongly the line is drawn — the
      // same two things the 2D view encodes as stroke width and opacity.
      const weight = Number.isFinite(e.weight) ? e.weight : 0.5;
      const recency = Number.isFinite(e.recency) ? e.recency : 1;
      const strength = onPath ? 1 : Math.max(0.08, weight * (0.4 + 0.6 * recency)) * (dimming ? 0.35 : 1);
      colour.lerp(base, 1 - strength);

      for (let v = 0; v < 2; v++) {
        colours[o + v * 3] = colour.r;
        colours[o + v * 3 + 1] = colour.g;
        colours[o + v * 3 + 2] = colour.b;
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positionsArr, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    edgeLines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }),
    );
    scene.add(edgeLines);
  }

  function buildLabels() {
    if (!scene) return;
    labelGroup = new THREE.Group();

    // Only what has earned a label. Every sprite is its own texture and draw
    // call, so labelling 600 nodes would cost more than the rest of the scene
    // and be unreadable anyway.
    const ranked = [...simNodes].sort((a, b) => b.importance - a.importance);
    const wanted = new Set(ranked.slice(0, 28).map((n) => n.id));
    for (const n of simNodes) {
      if (pathSet.has(n.id) || matchSet.has(n.id) || n.id === selectedId) wanted.add(n.id);
    }

    for (const n of simNodes) {
      if (!wanted.has(n.id)) continue;
      const sprite = makeLabel(n.name, dimming && !matchSet.has(n.id) ? '#6b6560' : '#ede4d4');
      if (!sprite) continue;
      sprite.position.set(n.x ?? 0, (n.y ?? 0) + radius(n) + 3.4, n.z ?? 0);
      labelGroup.add(sprite);
    }
    scene.add(labelGroup);
  }

  /** Point the camera so the bulk of the graph fills the view. */
  function frameCamera(width: number, height: number) {
    if (!camera || !controls || !simNodes.length) return;

    // The 4th–96th percentile, matching the 2D view: the layout flings
    // disconnected fragments far out, and framing those shrinks the part anyone
    // wants to read into a dot in the middle.
    const axis = (get: (n: Sim3DNode) => number) => {
      const vals = simNodes.map(get).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      if (!vals.length) return { lo: -1, hi: 1 };
      // Tighter than the 2D view's 4–96%. A graph with 180-odd components and
      // 160-odd isolated nodes has a long tail of debris in every direction,
      // and framing even the 4th percentile of it leaves the main body a
      // cluster of dots in the middle of an empty scene.
      return {
        lo: vals[Math.floor(vals.length * 0.06)],
        hi: vals[Math.min(vals.length - 1, Math.ceil(vals.length * 0.94))],
      };
    };

    const xs = axis((n) => n.x ?? 0);
    const ys = axis((n) => n.y ?? 0);
    const zs = axis((n) => n.z ?? 0);

    const centre = new THREE.Vector3((xs.lo + xs.hi) / 2, (ys.lo + ys.hi) / 2, (zs.lo + zs.hi) / 2);
    const extent = Math.max(xs.hi - xs.lo, ys.hi - ys.lo, zs.hi - zs.lo, 10);
    const fov = (camera.fov * Math.PI) / 180;
    // The layout is already normalised to a known extent and the percentile
    // trim has removed the outliers, so this margin only has to clear the
    // largest node and leave the body a little air.
    const distance = (extent / 2 / Math.tan(fov / 2)) * 1.3;

    controls.target.copy(centre);
    // Offset on all three axes so the first frame reads as a 3D scene rather
    // than a flat one seen head-on.
    camera.position.set(centre.x + distance * 0.35, centre.y + distance * 0.25, centre.z + distance);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function animate() {
    frameId = requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;
    controls?.update();
    // Sprites are camera-facing by nature; nothing else needs per-frame work,
    // so this is a cheap loop that exists for orbit damping.
    renderer.render(scene, camera);
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  function nodeAtPointer(event: PointerEvent | MouseEvent): { node: Sim3DNode; index: number } | null {
    if (!renderer || !camera || !nodeMesh) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster ??= new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(nodeMesh, false);
    const hit = hits.find((h) => h.instanceId != null);
    if (!hit || hit.instanceId == null) return null;
    const node = indexToNode[hit.instanceId];
    return node ? { node, index: hit.instanceId } : null;
  }

  function onPointerMove(event: PointerEvent) {
    const hit = nodeAtPointer(event);
    if (hit) {
      hoveredInstance = hit.index;
      hovered = hit.node;
      const rect = container?.getBoundingClientRect();
      tooltip = {
        x: event.clientX - (rect?.left ?? 0) + 14,
        y: event.clientY - (rect?.top ?? 0) + 14,
      };
    } else if (hoveredInstance !== -1) {
      hoveredInstance = -1;
      hovered = null;
    }
  }

  function onPointerDown() {
    dragged = false;
  }

  /** Orbiting moves the pointer a long way; only a still pointer is a click. */
  function onPointerMoveDrag(event: PointerEvent) {
    if (event.buttons !== 0) dragged = true;
    onPointerMove(event);
  }

  function onClick(event: MouseEvent) {
    if (dragged) return;
    const hit = nodeAtPointer(event);
    onSelect?.(hit ? hit.node.id : null);
  }

  function onDoubleClick(event: MouseEvent) {
    const hit = nodeAtPointer(event);
    if (hit) onOpen?.(hit.node.id);
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  // Rebuild only when the DATA or the highlighting changes. Everything build()
  // touches is untracked, so the pointer handlers writing `hovered`/`tooltip`
  // can never feed back into this effect.
  //
  // `selectedId` is deliberately absent: a click would otherwise tear down the
  // scene and re-run the whole layout to move one highlight, which in 3D also
  // resets the camera the user had just positioned. Selection repaints below.
  $effect(() => {
    nodes;
    edges;
    highlightPath;
    matchedIds;
    container;
    untrack(() => build());
  });

  // Selection repaint: recolour in place rather than rebuilding.
  $effect(() => {
    const id = selectedId;
    if (!nodeMesh) return;
    untrack(() => {
      const colour = new THREE.Color();
      const dark = new THREE.Color('#12100e');
      const accent = new THREE.Color('#e07a1f');
      simNodes.forEach((n, i) => {
        if (n.id === id || pathSet.has(n.id)) {
          colour.copy(accent);
        } else {
          colour.set(clusterColour(n.community));
          colour.lerp(dark, 1 - nodeAlpha(n));
        }
        nodeMesh!.setColorAt(i, colour);
      });
      if (nodeMesh!.instanceColor) nodeMesh!.instanceColor.needsUpdate = true;
    });
  });

  $effect(() => {
    const el = container;
    if (!el || typeof ResizeObserver === 'undefined') return;

    // Resizing only needs the camera and drawing buffer updated — not a
    // relayout — so unlike the 2D view this is cheap and needs no debounce.
    resizeObserver = new ResizeObserver(() => {
      if (!renderer || !camera || !el) return;
      const w = el.clientWidth || 800;
      const h = el.clientHeight || 600;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(el);
    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  onDestroy(() => disposeScene());
</script>

<div
  class="wrap"
  bind:this={container}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMoveDrag}
  onclick={onClick}
  ondblclick={onDoubleClick}
  role="application"
  aria-label="Intel network, {nodes.length} entities, three-dimensional view"
>
  {#if hovered}
    <div class="tip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
      <strong>{hovered.name}</strong>
      <span class="meta">{hovered.type} · {hovered.degree} links · {hovered.noteCount} sources</span>
      {#if hovered.sources?.length}
        <span class="meta">from {hovered.sources.join(', ')}</span>
      {/if}
      {#if hovered.recency < 0.5}
        <span class="stale">going stale</span>
      {/if}
      {#if hovered.summary}<span class="sum">{hovered.summary}</span>{/if}
    </div>
  {/if}

  {#if !nodes.length}
    <p class="empty">Nothing to draw with these filters.</p>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    height: 100%;
    /* Dark, because a 3D scene reads as a volume rather than a page. The 2D
       view keeps the cream page background; this one is deliberately a window
       into something else. */
    background: radial-gradient(circle at 50% 40%, #1c1917 0%, #0c0a09 100%);
    border-radius: var(--radius-round);
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }
  .wrap:active {
    cursor: grabbing;
  }

  .tip {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    max-width: 280px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
    background: rgba(12, 10, 9, 0.94);
    border: 1px solid rgba(237, 228, 212, 0.18);
    border-radius: var(--radius-sharp);
    color: #ede4d4;
    font-size: var(--fs-label);
    line-height: 1.35;
  }
  .tip strong {
    font-family: var(--font-body);
    font-weight: 600;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(237, 228, 212, 0.6);
  }
  .stale {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: #c4570a;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sum {
    color: rgba(237, 228, 212, 0.82);
  }

  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: rgba(237, 228, 212, 0.5);
    font-size: var(--fs-body-sm);
  }
</style>
