<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { ShaderMaterial, PlaneGeometry } from 'three';
  import skyVert from '$lib/shaders/sky.vert.glsl?raw';
  import skyFrag from '$lib/shaders/sky.frag.glsl?raw';
  import type { BiomeState } from '$lib/biome/state';
  import { DAY_PHASE_MAP } from '$lib/biome/state';

  let { state, isDark = true }: { state: BiomeState; isDark?: boolean } = $props();

  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: {
      uRecovery: { value: 0 },
      uDayPhase: { value: 0 },
      uDreaming: { value: 0 },
      uIsDark: { value: 0 },
      uTime: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uRecovery.value = state.recovery;
    material.uniforms.uDayPhase.value = DAY_PHASE_MAP[state.dayPhase];
    material.uniforms.uDreaming.value = state.dreaming ? 1.0 : 0.0;
    material.uniforms.uIsDark.value = isDark ? 1.0 : 0.0;
  });
</script>

<T.Mesh {geometry} {material} renderOrder={-2} />
