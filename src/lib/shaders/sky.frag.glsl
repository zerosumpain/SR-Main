uniform float uRecovery;    // 0-100
uniform float uDayPhase;    // 0=night, 1=dawn, 2=day, 3=dusk
uniform float uDreaming;    // 0 or 1
uniform float uIsDark;      // 1.0 = dark theme, 0.0 = light theme
uniform float uTime;

varying vec2 vUv;

// HSL to RGB conversion
vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c * 0.5;
  vec3 rgb;
  float hue = h * 6.0;
  if (hue < 1.0) rgb = vec3(c, x, 0.0);
  else if (hue < 2.0) rgb = vec3(x, c, 0.0);
  else if (hue < 3.0) rgb = vec3(0.0, c, x);
  else if (hue < 4.0) rgb = vec3(0.0, x, c);
  else if (hue < 5.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  return rgb + m;
}

void main() {
  // Dark mode hues: Night=indigo, Dawn=amber, Day=blue, Dusk=magenta
  float darkHue;
  if (uDayPhase < 0.5) darkHue = 0.7;
  else if (uDayPhase < 1.5) darkHue = 0.08;
  else if (uDayPhase < 2.5) darkHue = 0.58;
  else darkHue = 0.83;

  // Light mode hues: warm cream base with very subtle day-phase tinting
  // Original bg-background is hsl(60, 10%, 97%) — warm off-white
  float lightHue;
  if (uDayPhase < 0.5) lightHue = 0.6;         // night: hint of cool
  else if (uDayPhase < 1.5) lightHue = 0.1;     // dawn: warm golden
  else if (uDayPhase < 2.5) lightHue = 0.14;    // day: warm cream (close to original)
  else lightHue = 0.85;                           // dusk: hint of warm pink

  float baseHue = mix(lightHue, darkHue, uIsDark);

  // Dreaming override
  if (uDreaming > 0.5) {
    baseHue = mix(
      0.78 + sin(uTime * 0.1) * 0.02,   // light: soft lavender drift
      0.75 + sin(uTime * 0.1) * 0.03,    // dark: deep violet drift
      uIsDark
    );
  }

  // Recovery modulates saturation — light mode stays very subtle
  float darkSat = mix(0.05, 0.6, uRecovery / 100.0);
  float lightSat = mix(0.04, 0.12, uRecovery / 100.0);   // very low, like original 10%
  float saturation = mix(lightSat, darkSat, uIsDark);

  // Vertical gradient lightness
  float darkL = mix(0.02, 0.08, vUv.y);
  float lightL = mix(0.96, 0.98, vUv.y);   // very close to original 97%
  float lightness = mix(lightL, darkL, uIsDark);

  // Subtle time-based drift
  float hue = baseHue + sin(uTime * 0.05) * 0.01;

  vec3 color = hsl2rgb(fract(hue), saturation, lightness);

  gl_FragColor = vec4(color, 1.0);
}
