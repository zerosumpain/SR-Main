<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import {
    InstancedMesh,
    SphereGeometry,
    MeshBasicMaterial,
    Object3D,
    Color,
    AdditiveBlending,
    NormalBlending,
  } from 'three';
  import type { BiomeState } from '$lib/biome/state';
  import { cardiacPulse, windToVector, MAX_PARTICLES } from '$lib/biome/state';

  let { state, isDark = true }: { state: BiomeState; isDark?: boolean } = $props();

  const dummy = new Object3D();
  let baseSize = $derived(isDark ? 0.04 : 0.08);
  let peakColor = $derived(new Color(isDark ? '#00ccff' : '#6b4c0a'));
  let baseGrey = $derived(new Color(isDark ? '#404040' : '#8a7560'));
  let beatFlashColor = $derived(new Color(isDark ? '#ff2222' : '#8b3a1a'));

  // Initialize particle positions and velocities
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
    velocities[i * 3] = (Math.random() - 0.5) * 0.01;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
    velocities[i * 3 + 2] = 0;
  }

  const geometry = new SphereGeometry(0.05, 6, 6);
  const material = new MeshBasicMaterial({
    transparent: true,
    blending: NormalBlending,
  });
  $effect(() => {
    material.blending = isDark ? AdditiveBlending : NormalBlending;
    material.needsUpdate = true;
  });

  let mesh = $state.raw<InstancedMesh | undefined>(undefined);

  function getDrawCount(): number {
    const base = 200 + (state.strain / 100) * (MAX_PARTICLES - 200);
    return Math.round(Math.max(200, Math.min(MAX_PARTICLES, base)));
  }

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    if (!mesh) return;

    const [windX, windY] = windToVector(state.weather.windDirection, state.weather.windSpeed);
    const windScale = 0.0002;
    const drawCount = getDrawCount();
    mesh.count = drawCount;

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

      // Cardiac pulse
      const beat = cardiacPulse(elapsed, state.pulse, 50);

      // Scale
      const scale = baseSize + beat * 0.03;
      dummy.position.set(positions[idx], positions[idx + 1], positions[idx + 2]);
      dummy.scale.setScalar(scale / 0.05); // normalize to geometry radius
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color
      const recoveryT = state.recovery / 150;
      const restColor = baseGrey.clone().lerp(peakColor, recoveryT);
      const finalColor = restColor.clone().lerp(beatFlashColor, Math.pow(beat, 1.2));
      mesh.setColorAt(i, finalColor);
    }

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
