<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import {
    BufferGeometry,
    Float32BufferAttribute,
    LineBasicMaterial,
    AdditiveBlending,
    NormalBlending,
    Color,
  } from 'three';
  import type { BiomeState } from '$lib/biome/state';
  import { cardiacPulse, MAX_CONNECTION_SEGMENTS, CONNECTION_MAX_DIST } from '$lib/biome/state';

  let { state, isDark = true, particlePositions }: {
    state: BiomeState;
    isDark?: boolean;
    particlePositions?: Float32Array;
  } = $props();

  const MAX_POINTS = MAX_CONNECTION_SEGMENTS * 2;
  const linePositions = new Float32Array(MAX_POINTS * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(linePositions, 3));
  geometry.setDrawRange(0, 0);

  let lineColor = $derived(new Color(isDark ? '#8b5cf6' : '#a78bfa'));
  const material = new LineBasicMaterial({
    transparent: true,
    opacity: 0.03,
    blending: NormalBlending,
  });
  $effect(() => {
    material.color.set(lineColor);
    material.blending = isDark ? AdditiveBlending : NormalBlending;
    material.needsUpdate = true;
  });

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    if (!particlePositions) return;

    const beat = cardiacPulse(elapsed, state.pulse, 50);
    material.opacity = (0.03 + beat * 0.12) * (state.recovery / 100);

    // Sample particles and find connections
    const drawCount = Math.min(2000, particlePositions.length / 3);
    const step = Math.max(1, Math.floor(drawCount / 200));
    let lineCount = 0;

    for (let i = 0; i < drawCount && lineCount < MAX_CONNECTION_SEGMENTS; i += step) {
      const ix = i * 3;
      for (let j = i + step; j < drawCount && lineCount < MAX_CONNECTION_SEGMENTS; j += step) {
        const jx = j * 3;
        const dx = particlePositions[ix] - particlePositions[jx];
        const dy = particlePositions[ix + 1] - particlePositions[jx + 1];
        const dz = particlePositions[ix + 2] - particlePositions[jx + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < CONNECTION_MAX_DIST) {
          const base = lineCount * 6;
          linePositions[base] = particlePositions[ix];
          linePositions[base + 1] = particlePositions[ix + 1];
          linePositions[base + 2] = particlePositions[ix + 2];
          linePositions[base + 3] = particlePositions[jx];
          linePositions[base + 4] = particlePositions[jx + 1];
          linePositions[base + 5] = particlePositions[jx + 2];
          lineCount++;
        }
      }
    }

    geometry.setDrawRange(0, lineCount * 2);
    geometry.attributes.position.needsUpdate = true;
  });
</script>

<T.LineSegments {geometry} {material} renderOrder={1} />
