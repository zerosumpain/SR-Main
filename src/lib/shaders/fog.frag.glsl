uniform float uFogDensity;  // 0-1 (inverse of sleepQuality/100)
uniform float uTime;
uniform float uDreaming;
uniform float uIsDark;      // 1.0 = dark theme, 0.0 = light theme

varying vec2 vUv;

// Simplex-style noise (2D)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  // Multi-octave noise for organic fog
  float speed = 0.02;
  float n1 = snoise(vUv * 3.0 + vec2(uTime * speed, 0.0)) * 0.5 + 0.5;
  float n2 = snoise(vUv * 6.0 + vec2(0.0, uTime * speed * 0.7)) * 0.5 + 0.5;
  float n3 = snoise(vUv * 12.0 + vec2(uTime * speed * 0.3, uTime * speed * 0.5)) * 0.5 + 0.5;

  float noise = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

  // Dreaming: add aurora-like vertical bands
  float aurora = 0.0;
  if (uDreaming > 0.5) {
    aurora = sin(vUv.x * 8.0 + uTime * 0.15) * 0.5 + 0.5;
    aurora *= sin(vUv.y * 3.14159) * 0.4; // fade at top/bottom
    aurora *= 0.3;
  }

  // Fog intensity: subtler in light mode
  float intensity = mix(0.15, 0.4, uIsDark);
  float alpha = noise * uFogDensity * intensity + aurora;

  // Fog color: theme-dependent
  vec3 darkFogNormal = vec3(0.1, 0.1, 0.15);       // cool grey
  vec3 darkFogDream = vec3(0.15, 0.05, 0.3);        // deep violet
  vec3 lightFogNormal = vec3(0.82, 0.78, 0.75);     // warm cream
  vec3 lightFogDream = vec3(0.85, 0.8, 0.92);       // soft lavender

  vec3 darkFog = uDreaming > 0.5 ? darkFogDream : darkFogNormal;
  vec3 lightFog = uDreaming > 0.5 ? lightFogDream : lightFogNormal;
  vec3 fogColor = mix(lightFog, darkFog, uIsDark);

  gl_FragColor = vec4(fogColor, alpha);
}
