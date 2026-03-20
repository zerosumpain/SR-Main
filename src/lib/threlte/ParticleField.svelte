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

  let { biomeState, isDark = true }: { biomeState: BiomeState; isDark?: boolean } = $props();

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
    return Math.round(Math.max(200, Math.min(MAX_PARTICLES, base)));
  }

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    if (!mesh) return;

    const [windX, windY] = windToVector(biomeState.weather.windDirection, biomeState.weather.windSpeed);
    const windScale = 0.0002;
    const drawCount = getDrawCount();
    mesh.count = drawCount;

    // Cardiac pulse — use higher intensity for visible effect
    const beat = cardiacPulse(elapsed, biomeState.pulse, 100);

    for (let i = 0; i < drawCount; i++) {
      const idx = i * 3;

      // Apply velocity + wind
      positions[idx] += velocities[idx] + windX * windScale;
      positions[idx + 1] += velocities[idx + 1] + windY * windScale;

      // Wrap around boundaries
      if (positions[idx] > 10) positions[idx] = -10;
      if (positions[idx] < -10) positions[idx] = 10;
      if (positions[idx + 1] > 10) positions[idx + 1] = -10;
      if (positions[idx + 1] < -10) positions[idx + 1] = 10;

      // Scale — subtle size pulse
      const baseRadius = 0.03 + (i % 5) * 0.006; // slight size variation
      const scale = (baseRadius + beat * 0.019) / 0.04;
      dummy.position.set(positions[idx], positions[idx + 1], positions[idx + 2]);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color — warm shift on beat, stronger flash
      const recoveryT = biomeState.recovery / 150;
      const restColor = baseColor.clone().lerp(peakColor, recoveryT);
      const finalColor = restColor.clone().lerp(beatFlashColor, beat * 0.875);
      mesh.setColorAt(i, finalColor);
    }

    // Opacity pulse — big swing on each heartbeat
    material.opacity = (isDark ? 0.25 : 0.08) + beat * (isDark ? 0.5 : 0.35);

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
