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
    PlaneGeometry,
    ShaderMaterial,
  } from 'three';
  import type { BiomeState, WeatherCondition } from '$lib/biome/state';
  import { windToVector } from '$lib/biome/state';

  let { state, isDark = true }: { state: BiomeState; isDark?: boolean } = $props();

  const MAX_WEATHER_PARTICLES = 500;
  const dummy = new Object3D();

  // Weather particle config per condition
  const WEATHER_CONFIG: Record<WeatherCondition, { count: number; gravity: number; size: number; color: string }> = {
    clear: { count: 0, gravity: 0, size: 0, color: '#000000' },
    rain: { count: 400, gravity: 8.0, size: 0.02, color: isDark ? '#6ea8d7' : '#4a6070' },
    thunderstorm: { count: 500, gravity: 8.0, size: 0.02, color: isDark ? '#6ea8d7' : '#4a6070' },
    snow: { count: 300, gravity: 1.0, size: 0.06, color: isDark ? '#e8e8f0' : '#9a9aa0' },
    cloudy: { count: 100, gravity: 0, size: 0.15, color: isDark ? '#334155' : '#9ca3af' },
    fog: { count: 200, gravity: 0, size: 0.08, color: isDark ? '#445566' : '#b0a898' },
  };

  // Initialize positions
  const positions = new Float32Array(MAX_WEATHER_PARTICLES * 3);
  const velocities = new Float32Array(MAX_WEATHER_PARTICLES * 3);
  for (let i = 0; i < MAX_WEATHER_PARTICLES; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = Math.random() * 20 - 5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
    velocities[i * 3] = 0;
    velocities[i * 3 + 1] = 0;
    velocities[i * 3 + 2] = 0;
  }

  const geometry = new SphereGeometry(0.05, 4, 4);
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: isDark ? 0.5 : 0.35,
    blending: isDark ? AdditiveBlending : NormalBlending,
  });

  let mesh = $state.raw<InstancedMesh | undefined>(undefined);

  // Gust system
  let gustIntensity = 0;
  let gustTimer = Math.random() * 10 + 3;
  let gustDirOffset = 0;

  // Lightning
  let lightningOpacity = $state(0);
  let lightningTimer = Math.random() * 10 + 5;

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    if (!mesh) return;

    const config = WEATHER_CONFIG[state.weather.condition];
    if (config.count === 0) {
      mesh.count = 0;
      return;
    }

    // Gust system
    gustTimer -= delta;
    if (gustTimer <= 0) {
      gustIntensity = 0.4 + Math.random() * 0.6;
      gustDirOffset = (Math.random() - 0.5) * 30;
      gustTimer = 3 + Math.random() * 10;
    }
    gustIntensity *= 0.97;

    const [baseWindX, baseWindY] = windToVector(
      state.weather.windDirection + gustDirOffset,
      state.weather.windSpeed * (1 + gustIntensity * 0.6)
    );

    const count = Math.min(config.count, MAX_WEATHER_PARTICLES);
    mesh.count = count;
    material.color.set(config.color);

    for (let i = 0; i < count; i++) {
      const idx = i * 3;

      // Apply physics based on condition
      positions[idx] += baseWindX * 0.001 + velocities[idx];
      positions[idx + 1] -= config.gravity * delta + velocities[idx + 1];

      // Snow wobble
      if (state.weather.condition === 'snow') {
        positions[idx] += Math.sin(elapsed * 1.5 + i * 0.5) * 0.003;
      }

      // Wrap
      if (positions[idx + 1] < -10) {
        positions[idx + 1] = 10;
        positions[idx] = (Math.random() - 0.5) * 20;
      }
      if (positions[idx] > 10) positions[idx] = -10;
      if (positions[idx] < -10) positions[idx] = 10;

      const scale = config.size / 0.05;
      dummy.position.set(positions[idx], positions[idx + 1], positions[idx + 2]);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;

    // Lightning for thunderstorms
    if (state.weather.condition === 'thunderstorm') {
      lightningTimer -= delta;
      if (lightningTimer <= 0) {
        lightningOpacity = isDark ? 0.15 : 0.08;
        lightningTimer = 5 + Math.random() * 10;
      }
      if (lightningOpacity > 0) {
        lightningOpacity *= (1 - delta * 2);
        if (lightningOpacity < 0.001) lightningOpacity = 0;
      }
    }
  });
</script>

<T.InstancedMesh
  bind:ref={mesh}
  args={[geometry, material, MAX_WEATHER_PARTICLES]}
  renderOrder={2}
  frustumCulled={false}
/>

{#if lightningOpacity > 0}
  <T.Mesh renderOrder={3}>
    <T.PlaneGeometry args={[2, 2]} />
    <T.MeshBasicMaterial
      color={isDark ? '#c8d8ff' : '#f5e6c8'}
      transparent={true}
      opacity={lightningOpacity}
      depthTest={false}
      depthWrite={false}
    />
  </T.Mesh>
{/if}
