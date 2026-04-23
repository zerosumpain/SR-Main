// WebGL2 instanced quad renderer for blood particles.
// Particles are dark (site text colour) on a transparent canvas so the
// page's cream background shows through. Fast-moving particles tint
// toward the burnt-orange site accent.

import { WORLD_X, WORLD_Y, buildFadeMask } from './anatomy';

const VERT = /* glsl */`#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in vec2 a_vel;

uniform vec2  u_resolution;
uniform vec2  u_world;          // (WORLD_X, WORLD_Y)
uniform float u_particleSize;
uniform float u_motionBlur;

out vec2 v_uv;
out float v_speed;
out vec2 v_worldUV;            // particle's world position normalised to [0,1] for fade-mask sample

void main() {
  // Aspect-fit (contain): scale so the entire world fits inside the viewport.
  float scaleX = u_resolution.x / u_world.x;
  float scaleY = u_resolution.y / u_world.y;
  float scale  = min(scaleX, scaleY);
  vec2 worldToPx = vec2(scale);
  vec2 centerPx = u_resolution * 0.5;

  float speed = length(a_vel);
  vec2 dir = speed > 0.001 ? a_vel / speed : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float stretch = 1.0 + u_motionBlur * min(speed, 30.0) / 30.0;
  vec2 local = vec2(a_corner.x * stretch, a_corner.y) * u_particleSize;
  vec2 offset = local.x * dir + local.y * perp;

  vec2 worldXY = a_pos + offset;
  vec2 px = (worldXY - u_world * 0.5) * worldToPx + centerPx;
  vec2 ndc = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);

  v_uv = a_corner;
  v_speed = speed;
  v_worldUV = a_pos / u_world;   // sample fade mask at the particle's centre
}
`;

const FRAG = /* glsl */`#version 300 es
precision highp float;

in vec2 v_uv;
in float v_speed;
in vec2 v_worldUV;

uniform vec3  u_colorBase;
uniform vec3  u_colorAccent;
uniform float u_alpha;
uniform sampler2D u_fadeMask;
uniform float u_fadeStrength;   // 0 = no fade (renderer fallback), 1 = full fade

out vec4 outColor;

void main() {
  float r2 = dot(v_uv, v_uv);
  if (r2 > 1.0) discard;
  float falloff = pow(1.0 - r2, 2.0);
  float t = clamp(v_speed / 22.0, 0.0, 1.0);
  vec3 col = mix(u_colorBase, u_colorAccent, t * 0.55);
  // Wall-fade: alpha drops to zero before the particle reaches any wall.
  // Sampled at the particle CENTRE (not the fragment) so every fragment of
  // a single particle fades together — no half-faded particle edges.
  float wallFade = mix(1.0, texture(u_fadeMask, v_worldUV).r, u_fadeStrength);
  // Premultiplied alpha for clean compositing over the page background.
  float a = falloff * u_alpha * wallFade;
  outColor = vec4(col * a, a);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile failed: ' + log);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export interface RendererTheme {
  base: [number, number, number];   // 0..1 RGB for slow particles
  accent: [number, number, number]; // 0..1 RGB for fast particles
  alpha: number;
  particleSize: number;
}

export const SITE_THEME: RendererTheme = {
  base: [0x1a / 255, 0x10 / 255, 0x08 / 255],
  accent: [0xc4 / 255, 0x57 / 255, 0x0a / 255],
  alpha: 0.85,
  particleSize: 0.5,   // small, uniform
};

export class ParticleRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private cornerBuf: WebGLBuffer;
  private posBuf: WebGLBuffer;
  private velBuf: WebGLBuffer;
  private fadeTex: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private theme: RendererTheme = SITE_THEME;
  private fadeStrength = 1.0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    this.program = link(gl, vs, fs);
    gl.deleteShader(vs); gl.deleteShader(fs);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,  1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const MAX = 20000;
    this.posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX * 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    this.velBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.velBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX * 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);

    this.uniforms = {
      u_resolution:    gl.getUniformLocation(this.program, 'u_resolution'),
      u_world:         gl.getUniformLocation(this.program, 'u_world'),
      u_particleSize:  gl.getUniformLocation(this.program, 'u_particleSize'),
      u_motionBlur:    gl.getUniformLocation(this.program, 'u_motionBlur'),
      u_colorBase:     gl.getUniformLocation(this.program, 'u_colorBase'),
      u_colorAccent:   gl.getUniformLocation(this.program, 'u_colorAccent'),
      u_alpha:         gl.getUniformLocation(this.program, 'u_alpha'),
      u_fadeMask:      gl.getUniformLocation(this.program, 'u_fadeMask'),
      u_fadeStrength:  gl.getUniformLocation(this.program, 'u_fadeStrength'),
    };

    // Build & upload the wall-fade mask once at construction time.
    const mask = buildFadeMask();
    this.fadeTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fadeTex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8,
      mask.width, mask.height, 0,
      gl.RED, gl.UNSIGNED_BYTE, mask.data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setFadeStrength(s: number): void { this.fadeStrength = Math.max(0, Math.min(1, s)); }

  // Replace the fade-mask texture data in place. Width/height MUST match
  // the original allocation from buildFadeMask. Used for the dynamic
  // vessel-pulse mask that breathes with the cardiac cycle.
  updateFadeMask(data: Uint8Array, width: number, height: number): void {
    if (!this.fadeTex) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fadeTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  setTheme(t: RendererTheme): void { this.theme = t; }

  uploadParticles(pos: Float32Array, vel: Float32Array, count: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos, 0, count * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.velBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vel, 0, count * 2);
  }

  draw(width: number, height: number, count: number, bpm: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    // Transparent clear — page background shows through.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    // Premultiplied alpha-over: works on top of any page colour.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.u_resolution!, width, height);
    gl.uniform2f(this.uniforms.u_world!, WORLD_X, WORLD_Y);

    // Uniform size, no motion-blur stretch — every particle is identical
    // and crisp. BPM affects flow speed, not visual size.
    void bpm;
    gl.uniform1f(this.uniforms.u_particleSize!, this.theme.particleSize);
    gl.uniform1f(this.uniforms.u_motionBlur!, 0);

    const t = this.theme;
    gl.uniform3f(this.uniforms.u_colorBase!,   t.base[0],   t.base[1],   t.base[2]);
    gl.uniform3f(this.uniforms.u_colorAccent!, t.accent[0], t.accent[1], t.accent[2]);
    gl.uniform1f(this.uniforms.u_alpha!, t.alpha);

    // Bind fade-mask texture to texture unit 0.
    if (this.fadeTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fadeTex);
      gl.uniform1i(this.uniforms.u_fadeMask!, 0);
    }
    gl.uniform1f(this.uniforms.u_fadeStrength!, this.fadeStrength);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.cornerBuf);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.velBuf);
    if (this.fadeTex) gl.deleteTexture(this.fadeTex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
