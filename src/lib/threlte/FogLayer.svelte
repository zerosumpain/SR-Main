<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { ShaderMaterial, PlaneGeometry } from 'three';
  import fogVert from '$lib/shaders/fog.vert.glsl?raw';
  import fogFrag from '$lib/shaders/fog.frag.glsl?raw';
  import type { BiomeState } from '$lib/biome/state';

  let { biomeState, isDark = true, fogIntensity = 1.0, dreamMode = true }: { biomeState: BiomeState; isDark?: boolean; fogIntensity?: number; dreamMode?: boolean } = $props();

  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    vertexShader: fogVert,
    fragmentShader: fogFrag,
    uniforms: {
      uFogDensity: { value: 0 },
      uDreaming: { value: 0 },
      uIsDark: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uFogDensity.value = (1 - biomeState.sleepQuality / 100) * fogIntensity;
    material.uniforms.uDreaming.value = (biomeState.dreaming && dreamMode) ? 1.0 : 0.0;
    material.uniforms.uIsDark.value = isDark ? 1.0 : 0.0;
  });
</script>

<T.Mesh {geometry} {material} renderOrder={-1} />
