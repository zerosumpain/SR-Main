// WebGL2 instanced glyph renderer for the ASCII heartbeat (EcgAscii.svelte).
//
// The 2D-canvas pen pays for the trail every frame: a full-canvas
// destination-out wipe to fade the phosphor plus fillText rasterisation (and
// shadow blur) for each new column. This renderer moves all of that to the
// GPU: every glyph the 2D pen would draw (hot-coloured glyph over its accent
// shadow-glow) is rasterised ONCE into a pre-tinted texture atlas, each drawn
// cell becomes one instanced quad, and the phosphor fade is computed
// per-fragment from the cell's age — so the per-frame main-thread cost is a
// handful of uniform updates and one or two instanced draw calls, regardless
// of how much trail is alight.
//
// Visual parity notes (measured against what the 2D pen actually paints, not
// its comments):
//  - The 2D pen paints almost every column as the "head" of its draw tick, so
//    the whole trail is the hot colour with the accent glow baked under it
//    (glow off in lite mode). The atlas bakes exactly that composite.
//  - destination-out with a per-draw wipe alpha calibrated to hit 4% at
//    LIFETIME is an exponential decay in age: alpha(age) = 0.04^(age/LIFETIME).
//    The shader evaluates the same curve continuously.
//
// Precedent: src/lib/heart-sim/renderer.ts (WebGL2 instanced quads).

import { LIFETIME } from './ecg-signal';

// Atlas geometry. Glyphs are baked at ATLAS_FONT px into CELL px cells; CELL
// leaves enough padding around the glyph for the baked shadow blur, so each
// quad covers glyph + glow in one fetch.
const ATLAS_FONT = 32;
const CELL = 96;
const GRID = 14; // 14×14 slots
// Every printable Latin-1 code point — the exact range the 2D pen's Uint8Array
// grid can represent. The narrative is not plain ASCII: it always contains
// '·' (183) as the segment separator and usually '°' (176) for temperature.
const CODES: number[] = [];
for (let c = 33; c <= 126; c++) CODES.push(c);
for (let c = 161; c <= 255; c++) CODES.push(c);
// code → atlas slot (-1 = not drawable).
const SLOT = new Int16Array(256).fill(-1);
CODES.forEach((c, i) => (SLOT[c] = i));
// shadowBlur is 8 css px in the 2D pen at a typical ~11px head glyph; baked at
// atlas scale that is 8 * (ATLAS_FONT / 11). The blur then scales with the
// glyph, so tiny peak glyphs get slightly tighter glows — imperceptible on
// characters this small.
const GLOW_BLUR = Math.round((8 * ATLAS_FONT) / 11);
// Age (in LIFETIMEs) past which a cell is invisible (< 0.5/255) and no longer
// drawn.
const CUTOFF_LIFETIMES = 2.0;
// Instance ring capacity. Worst case is ~90 lit cells/s with a 3s visible
// tail — a few hundred live cells; 8192 gives a huge margin for 192KB.
const CAPACITY = 8192;
const FLOATS_PER_INSTANCE = 6; // center.xy, slot, sizePx, birth, (pad)
const STRIDE = FLOATS_PER_INSTANCE * 4;

const VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;   // static quad, [-0.5, 0.5]^2
layout(location = 1) in vec2 a_center;   // cell centre, css px
layout(location = 2) in float a_slot;    // glyph slot index
layout(location = 3) in float a_size;    // drawn font size, css px (0 = empty)
layout(location = 4) in float a_birth;   // commit time, seconds

uniform vec2 u_resolution;  // css px
uniform float u_time;       // seconds, same clock as a_birth
uniform float u_lifetime;
uniform float u_cutoff;     // in lifetimes

out vec2 v_uv;
out float v_fade;

const float GRID_F = ${GRID}.0;

void main() {
  float age = u_time - a_birth;
  if (a_size <= 0.0 || age < 0.0 || age > u_cutoff * u_lifetime) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // collapse: off-screen, zero area
    v_fade = 0.0;
    v_uv = vec2(0.0);
    return;
  }

  // Quad spans the full atlas cell (glyph + glow padding), scaled so the
  // glyph inside renders at a_size css px.
  float quadPx = ${CELL}.0 * (a_size / ${ATLAS_FONT}.0);
  vec2 pos = a_center + a_corner * quadPx;
  vec2 ndc = (pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);

  float col = mod(a_slot, GRID_F);
  float row = floor(a_slot / GRID_F);
  v_uv = (vec2(col, row) + (a_corner + 0.5)) / GRID_F;

  // destination-out phosphor decay, evaluated continuously: 4% at LIFETIME.
  v_fade = pow(0.04, age / u_lifetime);
}
`;

const FRAG = /* glsl */ `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_fade;

uniform sampler2D u_atlas;

out vec4 fragColor;

void main() {
  // Atlas texels are pre-tinted and premultiplied; ageing is a scalar.
  fragColor = texture(u_atlas, v_uv) * v_fade;
}
`;

export interface AsciiGlLayout {
  cssW: number;
  cssH: number;
  dpr: number;
  cellW: number;
  lineH: number;
}

export interface AsciiGlColors {
  hot: [number, number, number]; // 0-255 — glyph fill
  glow: [number, number, number]; // shadow-glow colour
  glowAlpha: number; // 0 disables the glow (lite mode)
}

export interface AsciiGlRenderer {
  layout(l: AsciiGlLayout): void;
  /** Queue one glyph cell. col/row in grid units; t on the caller's clock. */
  commitCell(col: number, row: number, code: number, sizePx: number, t: number): void;
  /** Upload queued cells and render the whole trail at time t. */
  draw(t: number): void;
  destroy(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile: ' + log);
  }
  return sh;
}

// Rasterise the atlas: each cell is the exact composite the 2D pen draws per
// glyph — the hot-coloured character over its blurred accent shadow.
function bakeAtlas(colors: AsciiGlColors): HTMLCanvasElement {
  const cvs = document.createElement('canvas');
  cvs.width = CELL * GRID;
  cvs.height = CELL * GRID;
  const ctx = cvs.getContext('2d');
  if (!ctx) throw new Error('atlas 2d context unavailable');
  ctx.font = `700 ${ATLAS_FONT}px 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgb(${colors.hot[0]},${colors.hot[1]},${colors.hot[2]})`;
  if (colors.glowAlpha > 0) {
    ctx.shadowColor = `rgba(${colors.glow[0]},${colors.glow[1]},${colors.glow[2]},${colors.glowAlpha})`;
    ctx.shadowBlur = GLOW_BLUR;
  }
  for (let slot = 0; slot < CODES.length; slot++) {
    const cx = (slot % GRID) * CELL + CELL / 2;
    const cy = Math.floor(slot / GRID) * CELL + CELL / 2;
    ctx.fillText(String.fromCharCode(CODES[slot]), cx, cy);
  }
  return cvs;
}

export function createAsciiGlRenderer(
  canvas: HTMLCanvasElement,
  colors: AsciiGlColors,
): AsciiGlRenderer | null {
  // Probe on a throwaway canvas BEFORE claiming the real one (a canvas that
  // has handed out a webgl2 context can never hand out a 2d one, and the
  // caller needs 2d for the fallback pen). Also refuse software GL — the 2D
  // pen far outperforms a software-rasterised WebGL pipeline (measured:
  // SwiftShader renders this scene at ~6fps).
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return null;
    const dbg = probe.getExtension('WEBGL_debug_renderer_info');
    const rs = String(probe.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : probe.RENDERER));
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|softpipe|software/i.test(rs)) return null;
  } catch {
    return null;
  }

  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  let destroyed = false;
  let contextLost = false;

  // CPU staging ring. Instances are written sequentially in commit order (so
  // birth times are monotonic along the ring) and wrap; draw() renders only
  // the live range between the expiry tail and the write head.
  const staging = new Float32Array(CAPACITY * FLOATS_PER_INSTANCE);
  let writeIdx = 0; // next instance slot
  let liveCount = 0; // instances between expiry tail and write head
  let dirtyFrom = -1; // first dirty instance since last upload
  let dirtyWrapped = false; // writes wrapped past capacity since last upload
  let cellW = 8;
  let lineH = 14;
  let cssW = 1;
  let cssH = 1;

  let program: WebGLProgram;
  let vao: WebGLVertexArrayObject;
  let quadBuf: WebGLBuffer;
  let instBuf: WebGLBuffer;
  let atlasTex: WebGLTexture;
  let uResolution: WebGLUniformLocation | null;
  let uTime: WebGLUniformLocation | null;

  function uploadAtlas(g: WebGL2RenderingContext) {
    g.bindTexture(g.TEXTURE_2D, atlasTex);
    // Premultiplied to match the ONE / ONE_MINUS_SRC_ALPHA blend.
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, bakeAtlas(colors));
    g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  }

  // (Re)bind the instance attributes starting at ring index `first` — this is
  // how a sub-range of the ring is drawn without a base-instance extension.
  function bindInstanceAttribs(g: WebGL2RenderingContext, first: number) {
    const off = first * STRIDE;
    g.bindBuffer(g.ARRAY_BUFFER, instBuf);
    g.enableVertexAttribArray(1);
    g.vertexAttribPointer(1, 2, g.FLOAT, false, STRIDE, off);
    g.vertexAttribDivisor(1, 1);
    g.enableVertexAttribArray(2);
    g.vertexAttribPointer(2, 1, g.FLOAT, false, STRIDE, off + 8);
    g.vertexAttribDivisor(2, 1);
    g.enableVertexAttribArray(3);
    g.vertexAttribPointer(3, 1, g.FLOAT, false, STRIDE, off + 12);
    g.vertexAttribDivisor(3, 1);
    g.enableVertexAttribArray(4);
    g.vertexAttribPointer(4, 1, g.FLOAT, false, STRIDE, off + 16);
    g.vertexAttribDivisor(4, 1);
  }

  function init(g: WebGL2RenderingContext) {
    const vs = compile(g, g.VERTEX_SHADER, VERT);
    const fs = compile(g, g.FRAGMENT_SHADER, FRAG);
    const prog = g.createProgram();
    if (!prog) throw new Error('createProgram failed');
    g.attachShader(prog, vs);
    g.attachShader(prog, fs);
    g.linkProgram(prog);
    g.deleteShader(vs);
    g.deleteShader(fs);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
      throw new Error('program link: ' + g.getProgramInfoLog(prog));
    }
    program = prog;

    const vaoN = g.createVertexArray();
    if (!vaoN) throw new Error('createVertexArray failed');
    vao = vaoN;
    g.bindVertexArray(vao);

    quadBuf = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, quadBuf);
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      g.STATIC_DRAW,
    );
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);

    instBuf = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, instBuf);
    g.bufferData(g.ARRAY_BUFFER, staging.byteLength, g.DYNAMIC_DRAW);
    bindInstanceAttribs(g, 0);
    g.bindVertexArray(null);

    atlasTex = g.createTexture()!;
    uploadAtlas(g);
    // Re-bake once the webfont is definitely in — the first bake may have used
    // the fallback mono if JetBrains Mono hadn't loaded yet.
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts
        .load(`700 ${ATLAS_FONT}px 'JetBrains Mono'`)
        .then(() => {
          if (!destroyed && !contextLost && gl) uploadAtlas(gl);
        })
        .catch(() => {});
    }

    g.useProgram(program);
    uResolution = g.getUniformLocation(program, 'u_resolution');
    uTime = g.getUniformLocation(program, 'u_time');
    g.uniform1f(g.getUniformLocation(program, 'u_lifetime'), LIFETIME);
    g.uniform1f(g.getUniformLocation(program, 'u_cutoff'), CUTOFF_LIFETIMES);
    g.uniform1i(g.getUniformLocation(program, 'u_atlas'), 0);

    g.disable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.clearColor(0, 0, 0, 0);
  }

  try {
    init(gl);
  } catch {
    return null; // caller falls back to the 2D pen
  }

  function clearTrail() {
    staging.fill(0);
    writeIdx = 0;
    liveCount = 0;
    dirtyFrom = 0;
    dirtyWrapped = true; // force a full re-upload
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
  };
  const onRestored = () => {
    if (destroyed || !gl) return;
    try {
      init(gl);
      clearTrail();
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(program);
      if (uResolution) gl.uniform2f(uResolution, cssW, cssH);
      contextLost = false;
    } catch {
      // stay lost — draw() keeps no-opping, the trail just disappears
    }
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    layout(l: AsciiGlLayout) {
      cellW = l.cellW;
      lineH = l.lineH;
      cssW = l.cssW;
      cssH = l.cssH;
      canvas.width = Math.round(l.cssW * l.dpr);
      canvas.height = Math.round(l.cssH * l.dpr);
      if (!gl || contextLost) return;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(program);
      if (uResolution) gl.uniform2f(uResolution, cssW, cssH);
      clearTrail(); // grid metrics changed — stale cells would be misplaced
    },

    commitCell(col: number, row: number, code: number, sizePx: number, t: number) {
      const slot = code >= 0 && code < 256 ? SLOT[code] : -1;
      if (slot < 0) return;
      const o = writeIdx * FLOATS_PER_INSTANCE;
      staging[o] = col * cellW + cellW / 2;
      staging[o + 1] = row * lineH + lineH / 2;
      staging[o + 2] = slot;
      staging[o + 3] = sizePx;
      staging[o + 4] = t;
      if (dirtyFrom < 0) dirtyFrom = writeIdx;
      writeIdx = (writeIdx + 1) % CAPACITY;
      if (writeIdx === 0) dirtyWrapped = true;
      if (liveCount < CAPACITY) liveCount++;
    },

    draw(t: number) {
      if (!gl || contextLost || destroyed) return;
      const g = gl;
      g.useProgram(program);
      g.bindVertexArray(vao);
      g.bindBuffer(g.ARRAY_BUFFER, instBuf);
      if (dirtyWrapped) {
        g.bufferSubData(g.ARRAY_BUFFER, 0, staging);
      } else if (dirtyFrom >= 0) {
        const from = dirtyFrom * FLOATS_PER_INSTANCE;
        const to = writeIdx * FLOATS_PER_INSTANCE;
        g.bufferSubData(g.ARRAY_BUFFER, from * 4, staging.subarray(from, to));
      }
      dirtyFrom = -1;
      dirtyWrapped = false;

      // Advance the expiry tail past cells the shader would discard anyway —
      // instances are in commit order, so the live set is one contiguous ring
      // range ending at the write head.
      const cutoff = t - CUTOFF_LIFETIMES * LIFETIME;
      let tail = (writeIdx - liveCount + CAPACITY) % CAPACITY;
      while (liveCount > 0 && staging[tail * FLOATS_PER_INSTANCE + 4] < cutoff) {
        tail = (tail + 1) % CAPACITY;
        liveCount--;
      }

      if (uTime) g.uniform1f(uTime, t);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, atlasTex);
      g.clear(g.COLOR_BUFFER_BIT);
      if (liveCount > 0) {
        const untilEnd = CAPACITY - tail;
        if (liveCount <= untilEnd) {
          bindInstanceAttribs(g, tail);
          g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, liveCount);
        } else {
          bindInstanceAttribs(g, tail);
          g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, untilEnd);
          bindInstanceAttribs(g, 0);
          g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, liveCount - untilEnd);
        }
      }
      g.bindVertexArray(null);
    },

    destroy() {
      destroyed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (gl && !contextLost) {
        gl.deleteBuffer(quadBuf);
        gl.deleteBuffer(instBuf);
        gl.deleteTexture(atlasTex);
        gl.deleteProgram(program);
        gl.deleteVertexArray(vao);
      }
      gl = null;
    },
  };
}
