// Background effect simulations — one builder per background-role effect in
// effects.ts (heartbeat excepted: it's the shared Ecg component). Kept out of
// Effect.svelte so the component stays a thin host and the sim data lives in
// a plain module (nested arrays in component scripts break under runes).
// Everything uses stock Points/LineSegments/Sprite materials — no shaders —
// so they hold up on integrated GPUs; counts are sized for that.

import type * as THREE_NS from 'three';

type Three = typeof THREE_NS;

export interface SimCtx {
  THREE: Three;
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  w: number;
  h: number;
  /** Resolved tint hex. */
  tint: string;
  /** 0.1–1. */
  intensity: number;
}

export interface Sim {
  tick(now: number, dt: number): void;
  dispose(): void;
}

type Builder = (ctx: SimCtx) => Sim;

/* ------------------------------------------------------------------ drift */

function drift({ THREE, scene, tint, intensity }: SimCtx): Sim {
  const count = 260;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
    speeds[i] = 0.2 + Math.random() * 0.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.11,
    transparent: true,
    opacity: 0.35 + intensity * 0.4,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
  const pos = geo.getAttribute('position') as THREE_NS.BufferAttribute;
  return {
    tick(now, dt) {
      for (let i = 0; i < count; i++) {
        // paper dust: drift up-right with a lazy sine sway
        let x = pos.getX(i) + dt * speeds[i] * 0.5 * intensity;
        let y = pos.getY(i) + dt * speeds[i] * 0.22 * intensity + Math.sin(now / 2400 + i) * 0.0016;
        if (x > 13) x = -13;
        if (y > 8) y = -8;
        pos.setX(i, x);
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* -------------------------------------------------------------- starfield */

function starfield({ THREE, scene, tint, intensity }: SimCtx): Sim {
  const count = 700;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
    positions[i * 3 + 2] = Math.random() * -40;
    speeds[i] = 0.2 + Math.random() * 0.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.075,
    transparent: true,
    opacity: 0.35 + intensity * 0.4,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
  const pos = geo.getAttribute('position') as THREE_NS.BufferAttribute;
  return {
    tick(_now, dt) {
      for (let i = 0; i < count; i++) {
        // slow push forward; recycle behind the camera
        let z = pos.getZ(i) + dt * speeds[i] * 2.2 * intensity;
        if (z > 8) z = -40;
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ----------------------------------------------------------------- plexus */

function plexus({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Drifting points; hairlines join pairs closer than LINK. Link positions are
  // rebuilt each frame into a pre-allocated buffer (draw range trims it).
  const count = 64;
  const LINK = 3.4;
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    px[i] = (Math.random() - 0.5) * 24;
    py[i] = (Math.random() - 0.5) * 14;
    const a = Math.random() * Math.PI * 2;
    const s = 0.14 + Math.random() * 0.3;
    vx[i] = Math.cos(a) * s;
    vy[i] = Math.sin(a) * s;
  }
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(count * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.16,
    transparent: true,
    opacity: 0.45 + intensity * 0.35,
    depthWrite: false,
  });
  scene.add(new THREE.Points(pGeo, pMat));

  const maxLinks = (count * (count - 1)) / 2;
  const lGeo = new THREE.BufferGeometry();
  const lPos = new Float32Array(maxLinks * 6);
  lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
  const lMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tint),
    transparent: true,
    opacity: 0.1 + intensity * 0.14,
    depthWrite: false,
  });
  scene.add(new THREE.LineSegments(lGeo, lMat));
  const lAttr = lGeo.getAttribute('position') as THREE_NS.BufferAttribute;
  const pAttr = pGeo.getAttribute('position') as THREE_NS.BufferAttribute;

  return {
    tick(_now, dt) {
      for (let i = 0; i < count; i++) {
        px[i] += vx[i] * dt * intensity * 2;
        py[i] += vy[i] * dt * intensity * 2;
        if (px[i] > 13 || px[i] < -13) vx[i] *= -1;
        if (py[i] > 8 || py[i] < -8) vy[i] *= -1;
        pPos[i * 3] = px[i];
        pPos[i * 3 + 1] = py[i];
      }
      let li = 0;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = px[i] - px[j];
          const dy = py[i] - py[j];
          if (dx * dx + dy * dy < LINK * LINK) {
            lPos[li * 6] = px[i];
            lPos[li * 6 + 1] = py[i];
            lPos[li * 6 + 3] = px[j];
            lPos[li * 6 + 4] = py[j];
            li++;
          }
        }
      }
      lGeo.setDrawRange(0, li * 2);
      pAttr.needsUpdate = true;
      lAttr.needsUpdate = true;
    },
    dispose() {
      pGeo.dispose();
      pMat.dispose();
      lGeo.dispose();
      lMat.dispose();
    },
  };
}

/* --------------------------------------------------------------- currents */

/** Pseudo flow field: layered sines give a smooth divergence-free-ish angle. */
function flowAngle(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 0.32 + t * 0.18) + Math.cos(y * 0.41 - t * 0.12) + Math.sin((x + y) * 0.19 + t * 0.07)
  );
}

function currents({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Short strokes advected along the field — each is one line segment whose
  // tail trails its velocity.
  const count = 340;
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    px[i] = (Math.random() - 0.5) * 26;
    py[i] = (Math.random() - 0.5) * 16;
  }
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(count * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tint),
    transparent: true,
    opacity: 0.22 + intensity * 0.3,
    depthWrite: false,
  });
  scene.add(new THREE.LineSegments(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;

  return {
    tick(now, dt) {
      const t = now / 1000;
      const speed = (0.9 + intensity * 1.6) * dt;
      for (let i = 0; i < count; i++) {
        const a = flowAngle(px[i], py[i], t) * Math.PI * 0.75;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        px[i] += cx * speed;
        py[i] += cy * speed;
        if (px[i] > 13) px[i] = -13;
        if (px[i] < -13) px[i] = 13;
        if (py[i] > 8) py[i] = -8;
        if (py[i] < -8) py[i] = 8;
        const len = 0.5 + intensity * 0.5;
        posArr[i * 6] = px[i];
        posArr[i * 6 + 1] = py[i];
        posArr[i * 6 + 3] = px[i] - cx * len;
        posArr[i * 6 + 4] = py[i] - cy * len;
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ----------------------------------------------------------------- orbits */

function orbits({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Star chart: particles on squashed elliptical rings (inner = faster), plus
  // a few faint guide rings.
  const count = 300;
  const SQUASH = 0.58;
  const radius = new Float32Array(count);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    radius[i] = 1.6 + Math.pow(Math.random(), 0.7) * 9;
    phase[i] = Math.random() * Math.PI * 2;
    speed[i] = (0.5 + Math.random() * 0.2) / Math.sqrt(radius[i]); // kepler-ish
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.13,
    transparent: true,
    opacity: 0.4 + intensity * 0.35,
    depthWrite: false,
  });
  scene.add(new THREE.Points(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;

  const ringGeos: THREE_NS.BufferGeometry[] = [];
  const ringMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tint),
    transparent: true,
    opacity: 0.07 + intensity * 0.08,
    depthWrite: false,
  });
  for (const r of [3.2, 5.6, 8.2, 10.4]) {
    const pts: THREE_NS.Vector3[] = [];
    for (let a = 0; a <= 96; a++) {
      const th = (a / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r * SQUASH, 0));
    }
    const rg = new THREE.BufferGeometry().setFromPoints(pts);
    ringGeos.push(rg);
    scene.add(new THREE.Line(rg, ringMat));
  }

  return {
    tick(_now, dt) {
      for (let i = 0; i < count; i++) {
        phase[i] += dt * speed[i] * intensity * 1.6;
        attr.setXYZ(i, Math.cos(phase[i]) * radius[i], Math.sin(phase[i]) * radius[i] * SQUASH, 0);
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      ringMat.dispose();
      for (const rg of ringGeos) rg.dispose();
    },
  };
}

/* -------------------------------------------------------------------- sea */

function sea({ THREE, scene, camera, tint, intensity }: SimCtx): Sim {
  // A dot plane receding to the horizon, swelling in crossing waves.
  const COLS = 88;
  const ROWS = 30;
  const count = COLS * ROWS;
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(count * 3);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      posArr[i * 3] = ((c / (COLS - 1)) - 0.5) * 44;
      posArr[i * 3 + 1] = -4.5;
      posArr[i * 3 + 2] = -r * 1.35;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.14,
    transparent: true,
    opacity: 0.3 + intensity * 0.35,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
  camera.position.y = 1.4;
  camera.lookAt(0, -2.5, -18);
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;

  return {
    tick(now) {
      const t = (now / 1000) * (0.5 + intensity * 0.7);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const x = posArr[i * 3];
          const z = posArr[i * 3 + 2];
          attr.setY(i, -4.5 + Math.sin(x * 0.24 + t) * 0.55 + Math.cos(z * 0.31 + t * 0.8) * 0.7);
        }
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* --------------------------------------------------------------- halftone */

function halftone({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // A screen-facing dot grid; a travelling wave pushes dots toward the camera
  // and sizeAttenuation makes them swell — a breathing print screen with no
  // custom shader.
  const COLS = 46;
  const ROWS = 28;
  const count = COLS * ROWS;
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(count * 3);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      posArr[i * 3] = ((c / (COLS - 1)) - 0.5) * 26;
      posArr[i * 3 + 1] = ((r / (ROWS - 1)) - 0.5) * 15;
      posArr[i * 3 + 2] = 0;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.17,
    transparent: true,
    opacity: 0.22 + intensity * 0.28,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;

  return {
    tick(now) {
      const t = (now / 1000) * (0.4 + intensity * 0.5);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const x = posArr[i * 3];
          const y = posArr[i * 3 + 1];
          // two crossing waves; z ∈ [0, ~4] swells the dot as it nears the camera
          attr.setZ(i, (Math.sin(x * 0.42 + t * 1.6) + Math.sin(y * 0.55 - t) + 2) * 1.05);
        }
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------ letterpress */

const GLYPHS = ['a', 'e', 'g', 'n', 'r', 's', '&', '?', '.', ';', '!', 'k'];

function letterpress({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Spilled type: serif glyphs as sprites, tumbling slowly downward. Textures
  // come from a tiny canvas per glyph; sprites share them.
  const textures: THREE_NS.CanvasTexture[] = GLYPHS.map((g) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d')!;
    c.font = 'italic 600 104px Fraunces, Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = tint;
    c.fillText(g, 64, 72);
    return new THREE.CanvasTexture(cv);
  });
  const N = 34;
  const sprites: { s: THREE_NS.Sprite; m: THREE_NS.SpriteMaterial; vy: number; vr: number }[] = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.SpriteMaterial({
      map: textures[i % textures.length],
      transparent: true,
      opacity: (0.1 + Math.random() * 0.16) * (0.6 + intensity),
      rotation: Math.random() * Math.PI * 2,
      depthWrite: false,
    });
    const s = new THREE.Sprite(m);
    const sc = 0.9 + Math.random() * 2.4;
    s.scale.set(sc, sc, 1);
    s.position.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 4);
    scene.add(s);
    sprites.push({ s, m, vy: 0.12 + Math.random() * 0.3, vr: (Math.random() - 0.5) * 0.25 });
  }
  return {
    tick(_now, dt) {
      for (const sp of sprites) {
        sp.s.position.y -= sp.vy * dt * intensity * 2;
        sp.m.rotation += sp.vr * dt;
        if (sp.s.position.y < -9) {
          sp.s.position.y = 9;
          sp.s.position.x = (Math.random() - 0.5) * 24;
        }
      }
    },
    dispose() {
      for (const sp of sprites) sp.m.dispose();
      for (const tx of textures) tx.dispose();
    },
  };
}

/* ------------------------------------------------------------ murmuration */

function murmuration({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Boids rendered as short dashes along their velocity — a starling flock
  // billowing after a slowly wandering target so it never leaves the page.
  const N = 110;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = (Math.random() - 0.5) * 10;
    py[i] = (Math.random() - 0.5) * 6;
    const a = Math.random() * Math.PI * 2;
    vx[i] = Math.cos(a) * 2;
    vy[i] = Math.sin(a) * 2;
  }
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(N * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tint),
    transparent: true,
    opacity: 0.4 + intensity * 0.35,
    depthWrite: false,
  });
  scene.add(new THREE.LineSegments(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;

  const SEP = 0.9;
  const NEAR = 2.4;
  return {
    tick(now, dt) {
      const t = now / 1000;
      // wandering attractor keeps the flock on stage and shapes the billow
      const tx = Math.sin(t * 0.21) * 7 + Math.sin(t * 0.083) * 3;
      const ty = Math.cos(t * 0.17) * 4;
      for (let i = 0; i < N; i++) {
        let ax = 0;
        let ay = 0;
        let cx = 0;
        let cy = 0;
        let alx = 0;
        let aly = 0;
        let n = 0;
        for (let j = 0; j < N; j++) {
          if (j === i) continue;
          const dx = px[j] - px[i];
          const dy = py[j] - py[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < NEAR * NEAR) {
            cx += px[j];
            cy += py[j];
            alx += vx[j];
            aly += vy[j];
            n++;
            if (d2 < SEP * SEP && d2 > 0.0001) {
              ax -= dx / d2;
              ay -= dy / d2;
            }
          }
        }
        if (n) {
          ax += (cx / n - px[i]) * 0.55 + (alx / n - vx[i]) * 0.9;
          ay += (cy / n - py[i]) * 0.55 + (aly / n - vy[i]) * 0.9;
        }
        ax += (tx - px[i]) * 0.14;
        ay += (ty - py[i]) * 0.14;
        vx[i] += ax * dt * (0.8 + intensity);
        vy[i] += ay * dt * (0.8 + intensity);
        const sp = Math.hypot(vx[i], vy[i]) || 1;
        const cl = Math.min(3.4, Math.max(1.6, sp));
        vx[i] = (vx[i] / sp) * cl;
        vy[i] = (vy[i] / sp) * cl;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        const len = 0.13;
        posArr[i * 6] = px[i];
        posArr[i * 6 + 1] = py[i];
        posArr[i * 6 + 3] = px[i] - (vx[i] / cl) * len * 2.2;
        posArr[i * 6 + 4] = py[i] - (vy[i] / cl) * len * 2.2;
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------------- rain */

function rain({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Slender streaks falling with a constant wind slant; faster = longer.
  const N = 210;
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  const v = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = (Math.random() - 0.5) * 30;
    y[i] = (Math.random() - 0.5) * 18;
    v[i] = 3 + Math.random() * 5;
  }
  const WIND = -0.16;
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(N * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tint),
    transparent: true,
    opacity: 0.2 + intensity * 0.3,
    depthWrite: false,
  });
  scene.add(new THREE.LineSegments(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;
  return {
    tick(_now, dt) {
      const s = dt * (0.5 + intensity);
      for (let i = 0; i < N; i++) {
        y[i] -= v[i] * s;
        x[i] += v[i] * WIND * s;
        if (y[i] < -9) {
          y[i] = 9;
          x[i] = (Math.random() - 0.5) * 30;
        }
        const len = 0.09 * v[i];
        posArr[i * 6] = x[i];
        posArr[i * 6 + 1] = y[i];
        posArr[i * 6 + 3] = x[i] - WIND * len;
        posArr[i * 6 + 4] = y[i] + len;
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ---------------------------------------------------------------- meteors */

function meteors({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // A few streaks arcing across a still field, each with a fading trail
  // (vertex colors run tint → paper along the tail).
  const M = 6;
  const TRAIL = 16;
  const paper = new THREE.Color('#ede4d4');
  const head = new THREE.Color(tint);
  const lines: { geo: THREE_NS.BufferGeometry; pts: Float32Array; life: number; wait: number; x: number; y: number; dx: number; dy: number; sp: number }[] = [];
  const mats: THREE_NS.LineBasicMaterial[] = [];
  for (let m = 0; m < M; m++) {
    const geo = new THREE.BufferGeometry();
    const pts = new Float32Array(TRAIL * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const cols = new Float32Array(TRAIL * 3);
    for (let k = 0; k < TRAIL; k++) {
      const c = paper.clone().lerp(head, k / (TRAIL - 1));
      cols[k * 3] = c.r;
      cols[k * 3 + 1] = c.g;
      cols[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45 + intensity * 0.35,
      depthWrite: false,
    });
    mats.push(mat);
    scene.add(new THREE.Line(geo, mat));
    lines.push({ geo, pts, life: 0, wait: Math.random() * 3, x: 0, y: 0, dx: 0, dy: 0, sp: 0 });
  }
  const spawn = (l: (typeof lines)[number]) => {
    const a = Math.PI * (1.05 + Math.random() * 0.35); // down-left-ish arcs
    l.dx = Math.cos(a);
    l.dy = Math.sin(a) * 0.6;
    l.x = 6 + Math.random() * 8;
    l.y = 3 + Math.random() * 6;
    l.sp = 9 + Math.random() * 7;
    l.life = 1;
    for (let k = 0; k < TRAIL; k++) {
      l.pts[k * 3] = l.x;
      l.pts[k * 3 + 1] = l.y;
    }
  };
  return {
    tick(_now, dt) {
      for (const l of lines) {
        if (!l.life) {
          l.wait -= dt;
          if (l.wait <= 0) spawn(l);
          continue;
        }
        l.x += l.dx * l.sp * dt * (0.6 + intensity);
        l.y += l.dy * l.sp * dt * (0.6 + intensity);
        // shift the trail down one slot, head at the end
        l.pts.copyWithin(0, 3);
        l.pts[(TRAIL - 1) * 3] = l.x;
        l.pts[(TRAIL - 1) * 3 + 1] = l.y;
        (l.geo.getAttribute('position') as THREE_NS.BufferAttribute).needsUpdate = true;
        if (l.x < -16 || l.y < -10) {
          l.life = 0;
          l.wait = 1.5 + Math.random() * 4;
        }
      }
    },
    dispose() {
      for (const l of lines) l.geo.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

/* ------------------------------------------------------------ phyllotaxis */

function phyllotaxis({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Sunflower-spiral bloom: points at the golden angle, slowly turning, each
  // breathing in z so sizeAttenuation pulses them.
  const N = 440;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.16,
    transparent: true,
    opacity: 0.35 + intensity * 0.35,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;
  return {
    tick(now) {
      const t = now / 1000;
      const rot = t * 0.05 * (0.5 + intensity);
      for (let i = 0; i < N; i++) {
        const r = 0.36 * Math.sqrt(i);
        const a = i * GOLDEN + rot;
        attr.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r * 0.94, Math.sin(t * 0.8 + r * 1.4) * 1.1);
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ----------------------------------------------------------------- scribe */

function scribe({ THREE, scene, w, h, tint, intensity }: SimCtx): Sim {
  // One pen line wandering the page: a ring of trailing points steered by
  // layered sines, vertex colors fading paper → tint toward the nib.
  const M = 300;
  const pts = new Float32Array(M * 3);
  const paper = new THREE.Color('#ede4d4');
  const ink = new THREE.Color(tint);
  const cols = new Float32Array(M * 3);
  for (let k = 0; k < M; k++) {
    const c = paper.clone().lerp(ink, Math.pow(k / (M - 1), 0.6));
    cols[k * 3] = c.r;
    cols[k * 3 + 1] = c.g;
    cols[k * 3 + 2] = c.b;
  }
  let x = 0;
  let y = 0;
  let heading = 0;
  for (let k = 0; k < M; k++) {
    pts[k * 3] = x;
    pts[k * 3 + 1] = y;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5 + intensity * 0.3,
    depthWrite: false,
  });
  scene.add(new THREE.Line(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;
  const BX = ((w / h) * 8.2) || 11;
  return {
    tick(now, dt) {
      const t = now / 1000;
      // steer: layered sines wobble the heading; drift home when out of bounds
      heading += (Math.sin(t * 1.7) * 0.9 + Math.sin(t * 0.43 + 2) * 1.3 + Math.sin(t * 3.1) * 0.35) * dt * 2.2;
      if (Math.abs(x) > BX || Math.abs(y) > 7) {
        const home = Math.atan2(-y, -x);
        let d = home - heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        heading += d * dt * 3;
      }
      const sp = 3.4 * (0.5 + intensity);
      x += Math.cos(heading) * sp * dt;
      y += Math.sin(heading) * sp * dt * 0.8;
      pts.copyWithin(0, 3);
      pts[(M - 1) * 3] = x;
      pts[(M - 1) * 3 + 1] = y;
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* -------------------------------------------------------------- ridgeline */

function ridgeline({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Stacked horizon lines, each displaced by travelling waves under a centre
  // envelope — the pulsar-chart print.
  const ROWS = 16;
  const COLS = 96;
  const geos: THREE_NS.BufferGeometry[] = [];
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tint),
    transparent: true,
    opacity: 0.3 + intensity * 0.3,
    depthWrite: false,
  });
  const phases: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(COLS * 3);
    for (let c = 0; c < COLS; c++) arr[c * 3] = ((c / (COLS - 1)) - 0.5) * 22;
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geos.push(geo);
    phases.push(Math.random() * 10);
    scene.add(new THREE.Line(geo, mat));
  }
  return {
    tick(now) {
      const t = (now / 1000) * (0.5 + intensity * 0.6);
      for (let r = 0; r < ROWS; r++) {
        const attr = geos[r].getAttribute('position') as THREE_NS.BufferAttribute;
        const baseY = ((r / (ROWS - 1)) - 0.5) * 11;
        const ph = phases[r];
        for (let c = 0; c < COLS; c++) {
          const nx = ((c / (COLS - 1)) - 0.5) * 2; // -1..1
          const env = Math.exp(-nx * nx * 3.2);
          const wave =
            Math.sin(nx * 6 + t * 1.4 + ph) * 0.5 +
            Math.sin(nx * 13 - t * 0.9 + ph * 2) * 0.3 +
            Math.sin(nx * 23 + t * 2.2 + ph * 3) * 0.14;
          attr.setY(c, baseY + env * wave * 1.5);
        }
        attr.needsUpdate = true;
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ grain */

function grain({ THREE, scene, tint, intensity }: SimCtx): Sim {
  // Film grain: a field of specks, a slice of which re-scatters every frame.
  const N = 850;
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posArr[i * 3] = (Math.random() - 0.5) * 26;
    posArr[i * 3 + 1] = (Math.random() - 0.5) * 16;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(tint),
    size: 0.055,
    transparent: true,
    opacity: 0.1 + intensity * 0.16,
    depthWrite: false,
  });
  scene.add(new THREE.Points(geo, mat));
  const attr = geo.getAttribute('position') as THREE_NS.BufferAttribute;
  let cursor = 0;
  return {
    tick() {
      const churn = Math.round(N * 0.12);
      for (let k = 0; k < churn; k++) {
        const i = (cursor + k) % N;
        posArr[i * 3] = (Math.random() - 0.5) * 26;
        posArr[i * 3 + 1] = (Math.random() - 0.5) * 16;
      }
      cursor = (cursor + churn) % N;
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export const SIM_BUILDERS: Record<string, Builder> = {
  drift,
  starfield,
  plexus,
  currents,
  orbits,
  sea,
  murmuration,
  rain,
  meteors,
  phyllotaxis,
  halftone,
  letterpress,
  scribe,
  ridgeline,
  grain,
};
