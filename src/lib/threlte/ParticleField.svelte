<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import {
    InstancedMesh,
    CircleGeometry,
    MeshBasicMaterial,
    Object3D,
    Color,
    NormalBlending,
  } from 'three';
  import type { BiomeState } from '$lib/biome/state';
  import { cardiacPulse, windToVector, MAX_PARTICLES } from '$lib/biome/state';
  import type { BiomeSettings } from '$lib/biome/settings';
  import { BIOME_SETTINGS_DEFAULTS } from '$lib/biome/settings';

  let { biomeState, isDark = true, s }: { biomeState: BiomeState; isDark?: boolean; s?: BiomeSettings } = $props();
  let settings = $derived(s || BIOME_SETTINGS_DEFAULTS);

  const dummy = new Object3D();

  // Subtle, muted palette for light mode
  let peakColor = $derived(new Color(isDark ? '#00ccff' : '#6b4c0a'));
  let baseColor = $derived(new Color(isDark ? '#404040' : '#b5a48e'));
  let beatFlashColor = $derived(new Color(isDark ? '#ff2222' : '#8b3a1a'));

  // Initialize particle positions and velocities
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2; // shallower z spread
    velocities[i * 3] = (Math.random() - 0.5) * 0.008;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.008;
    velocities[i * 3 + 2] = 0;
  }

  // Flat circle facing the camera — no perspective distortion
  const geometry = new CircleGeometry(0.04, 16);
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: isDark ? 0.4 : 0.18,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
  });

  let mesh = $state.raw<InstancedMesh | undefined>(undefined);

  function getDrawCount(): number {
    const base = 200 + (biomeState.strain / 100) * (MAX_PARTICLES - 200);
    return Math.round(Math.max(100, Math.min(MAX_PARTICLES, base * settings.particleDensity)));
  }

  // Advanced effect state (persists between frames)
  let shudderEnergy = 0;
  let prevBeat = 0;
  let comboMultiplier = 1.0;

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    if (!mesh) return;

    const [windX, windY] = windToVector(biomeState.weather.windDirection, biomeState.weather.windSpeed);
    const windScale = 0.0002;
    const drawCount = getDrawCount();
    mesh.count = drawCount;

    // Cardiac pulse — intensity from settings
    const beat = cardiacPulse(elapsed, biomeState.pulse, settings.pulseIntensity);

    // --- Shudder: detect beat onset and inject energy ---
    if (settings.shudderEffect) {
      if (beat > 0.3 && prevBeat < 0.2) {
        shudderEnergy = 1.0; // inject energy on beat
      }
      shudderEnergy *= 0.85; // decay each frame
      prevBeat = beat;
    }

    // --- Combination multiplier ---
    if (settings.combinationEffects) {
      const strainFactor = biomeState.strain / 100;
      const pulseFactor = Math.max(0, (biomeState.pulse - 40)) / 80;
      comboMultiplier = 1 + (strainFactor * pulseFactor) * 0.8; // 1.0 to 1.8
    } else {
      comboMultiplier = 1.0;
    }

    for (let i = 0; i < drawCount; i++) {
      const idx = i * 3;

      // --- Blood vessel mode vs normal wind drift ---
      if (settings.bloodVessel) {
        const normalizedY = (positions[idx + 1] + 10) / 20; // 0-1
        const distFromCenter = Math.abs(normalizedY - 0.5) * 2; // 0 at center, 1 at edges
        const flowProfile = Math.pow(1 - distFromCenter * distFromCenter, 2); // steep parabolic

        const pulseSpeedMul = 1 + (settings.bloodFlowRate / 100) * beat;
        const baseFlow = (0.01 * flowProfile + 0.0001) * pulseSpeedMul;
        const surgeFlow = 0.06 * beat * flowProfile * pulseSpeedMul;

        positions[idx] += baseFlow + surgeFlow;

        // Vertical wobble
        positions[idx + 1] += Math.sin(elapsed * 1.2 + i * 0.73) * 0.002 * flowProfile;

        // Wrap horizontally
        if (positions[idx] > 10) positions[idx] = -10;
      } else {
        // Existing wind drift logic
        positions[idx] += velocities[idx] + windX * windScale;
        positions[idx + 1] += velocities[idx + 1] + windY * windScale;

        // Wrap around boundaries
        if (positions[idx] > 10) positions[idx] = -10;
        if (positions[idx] < -10) positions[idx] = 10;
        if (positions[idx + 1] > 10) positions[idx + 1] = -10;
        if (positions[idx + 1] < -10) positions[idx + 1] = 10;
      }

      // --- Shudder: add vibration offset on beat ---
      if (settings.shudderEffect && shudderEnergy > 0.01) {
        const particlePhase = i * 0.73;
        const vibration = Math.sin(elapsed * 35 * Math.PI * 2 + particlePhase) * shudderEnergy * 0.02;
        positions[idx] += vibration;
        positions[idx + 1] += vibration * 0.7; // slightly less on Y
      }

      // Scale — subtle size pulse, amplified by combo multiplier
      const baseRadius = 0.03 + (i % 5) * 0.006; // slight size variation
      const scale = (baseRadius + beat * 0.019 * comboMultiplier) / 0.04;
      dummy.position.set(positions[idx], positions[idx + 1], positions[idx + 2]);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color — warm shift on beat, stronger flash, amplified by combo multiplier
      const recoveryT = biomeState.recovery / 150;
      const restColor = baseColor.clone().lerp(peakColor, recoveryT);
      const finalColor = restColor.clone().lerp(beatFlashColor, beat * 0.875 * comboMultiplier);
      mesh.setColorAt(i, finalColor);
    }

    // Opacity pulse — big swing on each heartbeat, amplified by combo multiplier
    material.opacity = (isDark ? 0.25 : 0.08) + beat * (isDark ? 0.5 : 0.35) * comboMultiplier;

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
</script>

<T.InstancedMesh
  bind:ref={mesh}
  args={[geometry, material, MAX_PARTICLES]}
  renderOrder={0}
  frustumCulled={false}
/>
