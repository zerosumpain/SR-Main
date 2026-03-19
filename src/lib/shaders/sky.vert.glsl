varying vec2 vUv;
void main() {
  vUv = uv;
  // Position directly in clip space (no projection needed for full-screen quad)
  gl_Position = vec4(position.xy, -1.0, 1.0);
}
