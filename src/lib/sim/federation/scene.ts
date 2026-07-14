// scene.ts — the Three.js rendering of the federated network. Plain TS on purpose:
// the render loop, pulse pool and picking live entirely outside Svelte reactivity
// (see svelte5-pitfalls: never $state an internal handle). The Svelte component
// mounts a container, forwards SimEvents here, and receives picks/ticks back.
// Aesthetic follows the field study: warm paper world, ink structures, pulses in
// the study's colour language. No shadows, no springs.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Topology, NetNode, ArchMode } from './topology';
import { routePath, sampleSchools, LAYERS_Y, RING_RADIUS, CENTRAL_ID, LEDGER_ID, RESOLVER_ID } from './topology';
import type { SimEvent, PulseColor } from './engine';

export interface PickResult {
  kind: 'node' | 'school';
  nodeId?: string;
  schoolIndex?: number;
}

export interface SceneHandle {
  applyEvent(e: SimEvent): void;
  setMode(mode: ArchMode): void;
  setEdtech(on: boolean): void;
  /** show/hide the MIS-broker (aggregator) ring layer */
  setAggregators(on: boolean): void;
  /** overlay indicative schools-reached figures on the visible ring layer */
  setReach(on: boolean): void;
  addTick(fn: (dtMs: number) => void): void;
  resetView(): void;
  zoom(factor: number): void;
  dispose(): void;
}

const PAPER = new THREE.Color('#efe7d5');
const INK = new THREE.Color('#2a2018');
const INK_SOFT = new THREE.Color('#5c5044');

const PULSE_COLORS: Record<PulseColor, THREE.Color> = {
  query: new THREE.Color('#0e5b66'),
  data: new THREE.Color('#c4570a'),
  ok: new THREE.Color('#2f7d4f'),
  refuse: new THREE.Color('#8a2d3a'),
  ambient: new THREE.Color('#8d7f6d'),
};

const NODE_BASE: Record<string, string> = {
  'con-dfe': '#0e5b66',
  'con-la': '#3d7683',
  'con-csc': '#b0892a',
  'con-tre': '#7a5aa6',
  'con-ofsted': '#4a4038',
  'con-xgov': '#6b5d50',
  [LEDGER_ID]: '#1c1611',
  [CENTRAL_ID]: '#8a2d3a',
};

interface ActivePulse {
  sprite: THREE.Sprite;
  trail: THREE.Sprite;
  curve: THREE.CatmullRomCurve3;
  t: number;
  durMs: number;
  color: THREE.Color;
}

interface SchoolHeat {
  index: number;
  color: THREE.Color;
  life: number; // ms remaining
  total: number;
}

interface GroundRing {
  mesh: THREE.Mesh;
  life: number;
  total: number;
  maxR: number;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** A soft round disc so the point field reads as thousands of tiny circles, not
 *  aliased squares — the single biggest lift in how "slick" the estate looks. */
function discTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(24, 24, 1, 24, 24, 22);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.98)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(24, 24, 23, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

export function createFederationScene(
  container: HTMLElement,
  topo: Topology,
  opts: {
    reduced: boolean;
    onPick?: (p: PickResult | null) => void;
  },
): SceneHandle {
  // --- renderer & layers -----------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.reduced ? 1.5 : 2));
  renderer.setClearColor(PAPER);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block;';
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PAPER, 90, 220);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
  const HOME_POS = new THREE.Vector3(76, 46, 76);
  const HOME_TARGET = new THREE.Vector3(0, 5, 0);
  camera.position.copy(HOME_POS);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 26;
  controls.maxDistance = 170;
  controls.maxPolarAngle = Math.PI * 0.49;
  // Plain wheel must scroll the PAGE, not zoom the canvas (the sim used to trap scroll).
  // Zoom is on the +/- buttons and ⌘/Ctrl-scroll; drag still orbits, pinch still zooms via manual dolly.
  controls.enableZoom = false;
  const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // Manual dolly (used by the zoom buttons and ⌘/Ctrl-scroll), clamped to the orbit range.
  const _zdir = new THREE.Vector3();
  function zoomBy(factor: number) {
    _zdir.copy(camera.position).sub(controls.target);
    const d = _zdir.length();
    const nd = Math.max(controls.minDistance, Math.min(controls.maxDistance, d * factor));
    camera.position.copy(controls.target).add(_zdir.setLength(nd));
    controls.update();
  }
  const onWheel = (e: WheelEvent) => {
    // only capture the wheel when the user explicitly asks to zoom — otherwise let the page scroll
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1.12 : 0.89);
    }
  };
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  const hemi = new THREE.HemisphereLight(0xfffaf0, 0x8a7a64, 1.15);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff4e0, 0.9);
  dir.position.set(40, 80, 20);
  scene.add(dir);

  const disc = discTexture();

  // --- school field ------------------------------------------------------
  const schoolGeo = new THREE.BufferGeometry();
  schoolGeo.setAttribute('position', new THREE.BufferAttribute(topo.schools.positions, 3));
  const baseColors = new Float32Array(topo.schools.count * 3);
  {
    // warm ink dots: each supplier gets its own hue+lightness signature so clusters
    // read as distinct estates (majors denser/cooler, the long tail warmer/lighter)
    const tone = new THREE.Color();
    for (let i = 0; i < topo.schools.count; i++) {
      const si = topo.schools.supplier[i];
      const spec = topo.byId.get(topo.supplierIds[si]);
      const hue = 0.055 + ((si * 0.61803) % 1) * 0.06;          // spread across the warm band
      const sat = spec?.tier === 'major' ? 0.26 : spec?.tier === 'mid' ? 0.2 : 0.16;
      const baseL = spec?.tier === 'major' ? 0.44 : spec?.tier === 'mid' ? 0.5 : 0.56;
      const l = baseL + (i % 9) * 0.006;
      tone.setHSL(hue, sat, l);
      baseColors[i * 3] = tone.r;
      baseColors[i * 3 + 1] = tone.g;
      baseColors[i * 3 + 2] = tone.b;
    }
  }
  const schoolColors = new Float32Array(baseColors);
  schoolGeo.setAttribute('color', new THREE.BufferAttribute(schoolColors, 3));
  const schoolMat = new THREE.PointsMaterial({ size: 0.5, map: disc, vertexColors: true, sizeAttenuation: true, transparent: true, alphaTest: 0.42, depthWrite: true });
  const schoolPoints = new THREE.Points(schoolGeo, schoolMat);
  scene.add(schoolPoints);

  // --- LA field: the 153 local authorities, a second context space in petrol ---
  const laGeo = new THREE.BufferGeometry();
  laGeo.setAttribute('position', new THREE.BufferAttribute(topo.las.positions, 3));
  const laMat = new THREE.PointsMaterial({ size: 0.95, map: disc, color: new THREE.Color('#2f6b73'), sizeAttenuation: true, transparent: true, opacity: 0.95, alphaTest: 0.42 });
  const laPoints = new THREE.Points(laGeo, laMat);
  scene.add(laPoints);

  // --- ground disc (paper shore) -----------------------------------------
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(120, 72),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9dfcb'), transparent: true, opacity: 0.55 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.4;
  scene.add(ground);

  // --- structural nodes ----------------------------------------------------
  const nodeMeshes = new Map<string, THREE.Mesh>();
  const nodeBaseColor = new Map<string, THREE.Color>();
  const pickables: THREE.Object3D[] = [];
  // the edtech ring is toggleable: its meshes, labels and tendril edges live here
  const edtechGroup = new THREE.Group();
  scene.add(edtechGroup);
  // the aggregator (MIS-broker) ring is a second, independently toggleable layer
  const aggregatorGroup = new THREE.Group();
  scene.add(aggregatorGroup);

  function nodeMaterial(hex: string): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
  }

  // reach overlay: the second line of ring-node labels, hidden until setReach(true)
  const reachEls: HTMLElement[] = [];
  let reachOn = false;
  function fmtReach(n: number): string {
    return n >= 1000 ? `${Math.round(n / 100) / 10}k`.replace('.0k', 'k') : String(n);
  }

  function labelFor(n: NetNode, cls: string): CSS2DObject {
    const el = document.createElement('div');
    el.className = `fed-label ${cls}`;
    if (n.reach != null) {
      const name = document.createElement('span');
      name.className = 'l-name';
      name.textContent = n.label;
      const reach = document.createElement('span');
      reach.className = 'l-reach';
      reach.textContent = `~${fmtReach(n.reach)} schools`;
      reach.style.display = reachOn ? 'block' : 'none';
      reachEls.push(reach);
      el.append(name, reach);
    } else {
      el.textContent = n.label;
    }
    const obj = new CSS2DObject(el);
    obj.position.set(0, n.size + 1.1, 0);
    return obj;
  }

  for (const n of topo.nodes) {
    let mesh: THREE.Mesh | null = null;
    if (n.kind === 'supplier') {
      const h = n.size * 1.7;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(n.size * 0.72, n.size * 0.95, h, 6), nodeMaterial('#3a2f24'));
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      // only the three majors carry a persistent label — the long tail declutters the
      // centre and is read by clicking a cluster (the inspector names it + its count)
      if (n.tier === 'major') mesh.add(labelFor(n, 'sup major'));
      // stem from gateway down toward its estate
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, n.pos[1], 4),
        new THREE.MeshBasicMaterial({ color: INK_SOFT, transparent: true, opacity: 0.35 }),
      );
      stem.position.y = -n.pos[1] / 2;
      mesh.add(stem);
    } else if (n.kind === 'consumer') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(n.size * 1.4, n.size * 1.4, n.size * 1.4), nodeMaterial(NODE_BASE[n.id] ?? '#4a4038'));
      mesh.rotation.y = Math.PI / 5;
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      mesh.add(labelFor(n, 'con'));
    } else if (n.kind === 'relay') {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(n.size), nodeMaterial('#584a3c'));
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
    } else if (n.kind === 'ledger') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, 4.6, 4), nodeMaterial('#1c1611'));
      mesh.position.set(n.pos[0], n.pos[1] - 0.6, n.pos[2]);
      const lbl = labelFor(n, 'ledger');
      lbl.position.y = 4.4; // above the collision band of far-side supplier labels
      mesh.add(lbl);
    } else if (n.kind === 'store') {
      // the DfE's existing satellite stores: mini central-store silhouettes
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(n.size * 0.55, n.size * 0.72, n.size * 2.1, 12), nodeMaterial('#8a5450'));
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      const lbl = labelFor(n, 'store');
      lbl.position.y = n.size * 1.5;
      mesh.add(lbl);
    } else if (n.kind === 'edtech') {
      mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(n.size * 1.15), nodeMaterial('#7d6e58'));
      mesh.rotation.set(Math.PI / 5, Math.PI / 7, 0);
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      const lbl = labelFor(n, 'edt');
      lbl.position.y = n.size + 0.9;
      mesh.add(lbl);
    } else if (n.kind === 'aggregator') {
      // MIS access broker: a squat hexagonal coupling with a collar — reads as "plumbing"
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(n.size * 0.92, n.size * 0.92, n.size * 0.8, 6), nodeMaterial('#67707a'));
      mesh.rotation.y = Math.PI / 6;
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(n.size * 1.16, 0.06, 6, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#67707a'), transparent: true, opacity: 0.6 }),
      );
      collar.rotation.x = Math.PI / 2;
      mesh.add(collar);
      const lbl = labelFor(n, 'agg');
      lbl.position.y = n.size + 1.0;
      mesh.add(lbl);
    } else if (n.kind === 'la') {
      // second-world data holders: LA case systems (teal) + cross-sector worlds (amber)
      const hex = n.sector === 'cross' ? '#9a6a2f' : '#356b74';
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(n.size * 0.6, n.size * 0.82, n.size * 2.0, 6), nodeMaterial(hex));
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      const lbl = labelFor(n, n.sector === 'cross' ? 'la cross' : 'la');
      lbl.position.y = n.size * 1.6;
      mesh.add(lbl);
      // a thin stem down to the LA ground field
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, n.pos[1], 4),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 0.3 }),
      );
      stem.position.y = -n.pos[1] / 2;
      mesh.add(stem);
    } else if (n.kind === 'resolver') {
      // the identity resolver: a faceted knot at the heart of the spine — where UPN meets LA case ID
      mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(n.size * 0.62, n.size * 0.2, 72, 10), nodeMaterial('#a85a2a'));
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      const lbl = labelFor(n, 'resolver');
      lbl.position.y = n.size * 1.9;
      mesh.add(lbl);
    } else if (n.kind === 'registry') {
      // a spine registry primitive — a slim trust-teal monument in the central hub
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(n.size * 0.32, n.size * 0.5, n.size * 3.0, 6), nodeMaterial('#1d6f78'));
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      const lbl = labelFor(n, 'registry');
      lbl.position.y = n.size * 2.0;
      mesh.add(lbl);
    } else if (n.kind === 'central') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(n.size, n.size, 7.5, 24), nodeMaterial(NODE_BASE[CENTRAL_ID]));
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      mesh.scale.setScalar(0.0001); // hidden until central mode
      const el = document.createElement('div');
      el.className = 'fed-label central';
      el.textContent = 'CENTRAL STORE';
      const lbl = new CSS2DObject(el);
      lbl.position.set(0, 7.6, 0);
      lbl.visible = false;
      mesh.add(lbl);
    }
    if (mesh) {
      mesh.userData.nodeId = n.id;
      nodeMeshes.set(n.id, mesh);
      nodeBaseColor.set(n.id, (mesh.material as THREE.MeshLambertMaterial).color.clone());
      (n.kind === 'edtech' ? edtechGroup : n.kind === 'aggregator' ? aggregatorGroup : scene).add(mesh);
      if (n.kind !== 'relay') pickables.push(mesh);
    }
  }

  // --- exchange ring decoration -------------------------------------------
  const ringGroup = new THREE.Group();
  const ringTorus = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, 0.06, 8, 128),
    new THREE.MeshBasicMaterial({ color: INK_SOFT, transparent: true, opacity: 0.5 }),
  );
  ringTorus.rotation.x = Math.PI / 2;
  ringTorus.position.y = LAYERS_Y.ring;
  ringGroup.add(ringTorus);
  const ringSpin = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS + 1.1, 0.025, 6, 96),
    new THREE.MeshBasicMaterial({ color: PULSE_COLORS.query, transparent: true, opacity: 0.3 }),
  );
  ringSpin.rotation.x = Math.PI / 2;
  ringSpin.position.y = LAYERS_Y.ring;
  ringGroup.add(ringSpin);
  {
    const el = document.createElement('div');
    el.className = 'fed-label ring';
    el.textContent = 'EXCHANGE LAYER';
    const lbl = new CSS2DObject(el);
    lbl.position.set(0, LAYERS_Y.ring + 2.4, -RING_RADIUS);
    ringGroup.add(lbl);
  }
  scene.add(ringGroup);

  // --- spine hub platform: a faint trust-teal disc + ring grouping the central
  //     registries so they read as one thing — "the spine" ---
  {
    const hubY = LAYERS_Y.suppliers + 1;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(8.4, 44),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#1d6f78'), transparent: true, opacity: 0.07, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = hubY;
    scene.add(disc);
    const hubRing = new THREE.Mesh(
      new THREE.TorusGeometry(8.2, 0.05, 6, 72),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#1d6f78'), transparent: true, opacity: 0.42 }),
    );
    hubRing.rotation.x = Math.PI / 2;
    hubRing.position.y = hubY;
    scene.add(hubRing);
    const el = document.createElement('div');
    el.className = 'fed-label spine-lab';
    el.textContent = 'THE SPINE · shared registries';
    const lbl = new CSS2DObject(el);
    lbl.position.set(0, hubY - 0.4, 8.6);
    scene.add(lbl);
  }

  // --- edges ---------------------------------------------------------------
  function edgeLines(kinds: string[], color: THREE.Color, opacity: number): THREE.LineSegments {
    const pts: number[] = [];
    for (const e of topo.edges) {
      if (!kinds.includes(e.kind)) continue;
      const a = topo.byId.get(e.from)!.pos;
      const b = topo.byId.get(e.to)!.pos;
      pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.LineSegments(geo, mat);
  }
  const memberEdges = edgeLines(['member', 'ring', 'satellite'], INK_SOFT, 0.28);
  scene.add(memberEdges);
  const centralEdges = edgeLines(['central'], PULSE_COLORS.refuse, 0);
  scene.add(centralEdges);
  const tendrilEdges = edgeLines(['tendril'], INK_SOFT, 0.22);
  edtechGroup.add(tendrilEdges);
  const brokerEdges = edgeLines(['broker'], new THREE.Color('#67707a'), 0.32);
  aggregatorGroup.add(brokerEdges);

  // hidden until toggled on — CSS2D labels need their own visible flags flipped,
  // so the toggle traverses (which includes the group itself) rather than
  // relying on group visibility alone
  let edtechOn = false;
  let aggOn = false;
  const isEdtech = (id: string) => id.startsWith('edt-');
  const isAgg = (id: string) => id.startsWith('agg-');
  function setEdtech(on: boolean) {
    edtechOn = on;
    edtechGroup.traverse((o) => { o.visible = on; });
    // strip any highlight rings left around tendrils that just vanished
    if (!on) highlight(Array.from(highlightRings.keys()).filter(isEdtech), false);
  }

  // the aggregator (broker) layer — an independent toggle; carries only the ambient
  // broker plumbing (direct off-ring pulses), no scenario traffic
  function setAggregators(on: boolean) {
    aggOn = on;
    aggregatorGroup.traverse((o) => { o.visible = on; });
  }

  // reach overlay — flip every ring-node's second label line; hidden lines inside
  // a hidden layer stay hidden regardless, so this is a single global flag
  function setReach(on: boolean) {
    reachOn = on;
    for (const el of reachEls) el.style.display = on ? 'block' : 'none';
  }

  // --- pulse pool ------------------------------------------------------------
  const glow = glowTexture();
  const pulsePool: THREE.Sprite[] = [];
  const active: ActivePulse[] = [];
  function acquireSprite(): THREE.Sprite {
    const s = pulsePool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false }));
    s.visible = true;
    scene.add(s);
    return s;
  }
  function releaseSprite(s: THREE.Sprite) {
    s.visible = false;
    scene.remove(s);
    pulsePool.push(s);
  }

  let mode: ArchMode = 'federated';

  function spawnPulse(fromId: string, toId: string, color: PulseColor, durMs: number, direct = false) {
    if (active.length > 140) return; // saturation guard
    if (!edtechOn && (isEdtech(fromId) || isEdtech(toId))) return; // no pulses to hidden tendrils
    if (!aggOn && (isAgg(fromId) || isAgg(toId))) return; // no broker plumbing while the layer is hidden
    // direct = a straight spur between the two nodes (broker plumbing bypasses the ring);
    // otherwise route through the federation exchange as usual
    let way: [number, number, number][];
    if (direct) {
      const a = topo.byId.get(fromId);
      const b = topo.byId.get(toId);
      if (!a || !b) return;
      way = [a.pos, b.pos];
    } else {
      way = routePath(topo, fromId, toId, mode);
    }
    if (way.length < 2) return;
    const pts: THREE.Vector3[] = [];
    for (const p of way) {
      const v = new THREE.Vector3(p[0], p[1], p[2]);
      if (!pts.length || pts[pts.length - 1].distanceToSquared(v) > 1e-6) pts.push(v);
    }
    if (pts.length < 2) return;
    // gentle lift between waypoints so long hops arc instead of skewer
    if (pts.length === 2) {
      const mid = pts[0].clone().lerp(pts[1], 0.5);
      mid.y += pts[0].distanceTo(pts[1]) * 0.14;
      pts.splice(1, 0, mid);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
    const c = PULSE_COLORS[color];
    const sprite = acquireSprite();
    const trail = acquireSprite();
    const scale = color === 'ambient' ? 0.85 : 1.5;
    sprite.material.color = c.clone();
    sprite.material.opacity = color === 'ambient' ? 0.5 : 0.95;
    sprite.scale.setScalar(scale);
    trail.material.color = c.clone();
    trail.material.opacity = color === 'ambient' ? 0.2 : 0.4;
    trail.scale.setScalar(scale * 0.62);
    active.push({ sprite, trail, curve, t: 0, durMs, color: c });
  }

  // --- school heat + ground rings -------------------------------------------
  const heats: SchoolHeat[] = [];
  const rings: GroundRing[] = [];
  let fanoutSeed = 1;

  function fanout(supplierId: string, count: number, color: PulseColor) {
    fanoutSeed++;
    const picks = sampleSchools(topo, supplierId, Math.min(count, opts.reduced ? 120 : 320), fanoutSeed);
    const c = PULSE_COLORS[color];
    for (const idx of picks) heats.push({ index: idx, color: c, life: 1600, total: 1600 });
    const sup = topo.byId.get(supplierId);
    if (sup) {
      const geo = new THREE.RingGeometry(0.4, 0.75, 48);
      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(sup.pos[0], 0.15, sup.pos[2]);
      scene.add(mesh);
      const est = Math.sqrt((sup.schools ?? 500)) * 0.28 + 2.5;
      rings.push({ mesh, life: 1400, total: 1400, maxR: est });
    }
  }

  // --- flashes + highlights ---------------------------------------------------
  interface Flash { id: string; color: THREE.Color; life: number; total: number }
  const flashes: Flash[] = [];
  const highlightRings = new Map<string, THREE.Mesh>();

  function flash(nodeId: string, color: PulseColor) {
    const mesh = nodeMeshes.get(nodeId);
    if (!mesh) return;
    if (!edtechOn && isEdtech(nodeId)) return; // no flashes on hidden tendrils
    flashes.push({ id: nodeId, color: PULSE_COLORS[color], life: 900, total: 900 });
  }

  function highlight(nodeIds: string[], on: boolean) {
    for (const id of nodeIds) {
      if (on && !edtechOn && isEdtech(id)) continue; // no rings around hidden tendrils
      const existing = highlightRings.get(id);
      if (!on) {
        if (existing) {
          scene.remove(existing);
          (existing.material as THREE.Material).dispose();
          existing.geometry.dispose();
          highlightRings.delete(id);
        }
        continue;
      }
      if (existing) continue;
      const n = topo.byId.get(id);
      if (!n) continue;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(n.size * 1.9, 0.07, 8, 48),
        new THREE.MeshBasicMaterial({ color: PULSE_COLORS.query, transparent: true, opacity: 0.8 }),
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(n.pos[0], n.pos[1], n.pos[2]);
      scene.add(mesh);
      highlightRings.set(id, mesh);
    }
  }

  // both ring layers start hidden (call sits below highlightRings' declaration on purpose)
  setEdtech(false);
  setAggregators(false);

  function clearTransients() {
    for (const p of active.splice(0)) { releaseSprite(p.sprite); releaseSprite(p.trail); }
    for (const h of heats.splice(0)) {
      schoolColors[h.index * 3] = baseColors[h.index * 3];
      schoolColors[h.index * 3 + 1] = baseColors[h.index * 3 + 1];
      schoolColors[h.index * 3 + 2] = baseColors[h.index * 3 + 2];
    }
    const colorAttr = schoolGeo.attributes.color as THREE.BufferAttribute;
    colorAttr.clearUpdateRanges(); // empty ranges → full upload, once
    colorAttr.needsUpdate = true;
    for (const r of rings.splice(0)) { scene.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); }
    flashes.length = 0;
    highlight(Array.from(highlightRings.keys()), false);
  }

  // --- architecture mode morph ---------------------------------------------
  let modeAnim = 0; // 0 = federated, 1 = central (animated)
  let modeTarget = 0;

  function setMode(m: ArchMode) {
    mode = m;
    modeTarget = m === 'central' ? 1 : 0;
    const lbl = nodeMeshes.get(CENTRAL_ID)?.children.find((c) => c instanceof CSS2DObject);
    if (lbl) lbl.visible = m === 'central';
  }

  let bulkTimer = 0; // central-mode ambient: the nightly bulk upload, forever

  // --- picking -----------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.7 };
  const pointer = new THREE.Vector2();
  let downAt = 0;
  let downX = 0;
  let downY = 0;

  function pick(ev: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // setEdtech flips every tendril mesh's own .visible flag, so this one check
    // keeps hidden tendrils unpickable without a parallel bookkeeping flag
    const meshHits = raycaster.intersectObjects(pickables, false)
      .filter((h) => h.object.visible);
    if (meshHits.length) {
      opts.onPick?.({ kind: 'node', nodeId: meshHits[0].object.userData.nodeId as string });
      return;
    }
    const ptHits = raycaster.intersectObject(schoolPoints, false);
    if (ptHits.length && ptHits[0].index !== undefined) {
      opts.onPick?.({ kind: 'school', schoolIndex: ptHits[0].index });
      return;
    }
    opts.onPick?.(null);
  }
  const onDown = (ev: PointerEvent) => {
    downAt = performance.now();
    downX = ev.clientX;
    downY = ev.clientY;
  };
  const onUp = (ev: PointerEvent) => {
    // only treat quick, non-drag releases as picks — a fast orbit flick is not a click
    const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
    if (performance.now() - downAt < 260 && moved < 6) pick(ev);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  // --- resize --------------------------------------------------------------------
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // --- loop -------------------------------------------------------------------------
  const tickFns: Array<(dt: number) => void> = [];
  let last = performance.now();
  let raf = 0;
  const tmpColor = new THREE.Color();
  const tmpVec = new THREE.Vector3();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(now - last, 100);
    last = now;

    controls.update();
    ringSpin.rotation.z += dt * 0.00012;
    const resolverMesh = nodeMeshes.get(RESOLVER_ID);
    if (resolverMesh) resolverMesh.rotation.y += dt * 0.0007;

    // pulses
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      p.t += dt / p.durMs;
      if (p.t >= 1) {
        releaseSprite(p.sprite);
        releaseSprite(p.trail);
        active.splice(i, 1);
        continue;
      }
      p.curve.getPoint(Math.min(p.t, 1), tmpVec);
      p.sprite.position.copy(tmpVec);
      p.curve.getPoint(Math.max(p.t - 0.05, 0), tmpVec);
      p.trail.position.copy(tmpVec);
    }

    // school heat decay — upload only the touched slice of the 24k color buffer
    if (heats.length) {
      let minIdx = Infinity;
      let maxIdx = -1;
      for (let i = heats.length - 1; i >= 0; i--) {
        const h = heats[i];
        h.life -= dt;
        const k = Math.max(h.life / h.total, 0);
        const j = h.index * 3;
        tmpColor.setRGB(baseColors[j], baseColors[j + 1], baseColors[j + 2]).lerp(h.color, k);
        schoolColors[j] = tmpColor.r;
        schoolColors[j + 1] = tmpColor.g;
        schoolColors[j + 2] = tmpColor.b;
        if (h.index < minIdx) minIdx = h.index;
        if (h.index > maxIdx) maxIdx = h.index;
        if (h.life <= 0) heats.splice(i, 1);
      }
      const attr = schoolGeo.attributes.color as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(minIdx * 3, (maxIdx - minIdx + 1) * 3);
      attr.needsUpdate = true;
    }

    // ground rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt;
      const k = 1 - Math.max(r.life / r.total, 0);
      r.mesh.scale.setScalar(1 + k * r.maxR);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
      if (r.life <= 0) {
        scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        rings.splice(i, 1);
      }
    }

    // node flashes
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= dt;
      const mesh = nodeMeshes.get(f.id);
      if (mesh) {
        const k = Math.max(f.life / f.total, 0);
        const wave = Math.sin(k * Math.PI);
        (mesh.material as THREE.MeshLambertMaterial).color.copy(nodeBaseColor.get(f.id)!).lerp(f.color, wave);
        const s = 1 + wave * 0.22;
        if (f.id !== CENTRAL_ID) mesh.scale.setScalar(s);
      }
      if (f.life <= 0) {
        if (mesh) {
          (mesh.material as THREE.MeshLambertMaterial).color.copy(nodeBaseColor.get(f.id)!);
          if (f.id !== CENTRAL_ID) mesh.scale.setScalar(1);
        }
        flashes.splice(i, 1);
      }
    }

    // highlight ring pulse
    if (highlightRings.size) {
      const o = 0.55 + Math.sin(now * 0.004) * 0.3;
      for (const m of highlightRings.values()) (m.material as THREE.MeshBasicMaterial).opacity = o;
    }

    // mode morph
    if (modeAnim !== modeTarget) {
      const step = dt / 900;
      modeAnim = modeTarget > modeAnim ? Math.min(modeAnim + step, modeTarget) : Math.max(modeAnim - step, modeTarget);
      const k = modeAnim;
      const store = nodeMeshes.get(CENTRAL_ID);
      if (store) store.scale.setScalar(Math.max(k, 0.0001));
      (memberEdges.material as THREE.LineBasicMaterial).opacity = 0.28 * (1 - k * 0.75);
      (centralEdges.material as THREE.LineBasicMaterial).opacity = 0.3 * k;
      (ringTorus.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k * 0.8);
      (ringSpin.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - k);
      const ledger = nodeMeshes.get(LEDGER_ID);
      if (ledger) {
        const lm = ledger.material as THREE.MeshLambertMaterial;
        lm.transparent = true;
        lm.opacity = 1 - k * 0.75;
      }
      for (const id of topo.relayIds) {
        const rm = nodeMeshes.get(id);
        if (rm) {
          const m = rm.material as THREE.MeshLambertMaterial;
          m.transparent = true;
          m.opacity = 1 - k * 0.85;
        }
      }
    }

    // central-mode ambient: bulk uploads never stop
    if (mode === 'central' && modeAnim > 0.9) {
      bulkTimer -= dt;
      if (bulkTimer <= 0) {
        bulkTimer = 900 + Math.random() * 900;
        const sup = topo.supplierIds[Math.floor(Math.random() * topo.supplierIds.length)];
        spawnPulse(sup, CENTRAL_ID, 'data', 2400);
      }
    }

    for (const fn of tickFns) fn(dt);

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  // --- event application --------------------------------------------------------
  function applyEvent(e: SimEvent) {
    switch (e.type) {
      case 'pulse': spawnPulse(e.from, e.to, e.color, e.durMs, e.direct); break;
      case 'fanout': fanout(e.supplier, e.count, e.color); break;
      case 'flash': flash(e.node, e.color); break;
      case 'highlight': highlight(e.nodes, e.on); break;
      case 'clear': clearTransients(); break;
      default: break; // log/counter/narrate belong to the HUD
    }
  }

  function resetView() {
    camera.position.copy(HOME_POS);
    controls.target.copy(HOME_TARGET);
    controls.update();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.domElement.removeEventListener('pointerdown', onDown);
    renderer.domElement.removeEventListener('pointerup', onUp);
    renderer.domElement.removeEventListener('wheel', onWheel);
    controls.dispose();
    clearTransients();
    for (const s of pulsePool) s.material.dispose(); // parked sprites left the scene graph
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.LineSegments) {
        o.geometry?.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
    glow.dispose();
    disc.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    labelRenderer.domElement.remove();
  }

  return {
    applyEvent,
    setMode,
    setEdtech,
    setAggregators,
    setReach,
    addTick: (fn) => tickFns.push(fn),
    resetView,
    zoom: (factor) => zoomBy(factor),
    dispose,
  };
}
