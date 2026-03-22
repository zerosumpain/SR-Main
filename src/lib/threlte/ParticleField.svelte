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
  import { cardiacPulse, windToVector, MAX_PARTICLES, evalVesselPath, VESSEL_PATHS } from '$lib/biome/state';
  import type { BiomeSettings } from '$lib/biome/settings';
  import { BIOME_SETTINGS_DEFAULTS } from '$lib/biome/settings';

  let { biomeState, isDark = true, s }: { biomeState: BiomeState; isDark?: boolean; s?: BiomeSettings } = $props();
  let settings = $derived(s || BIOME_SETTINGS_DEFAULTS);

  const dummy = new Object3D();

  let peakColor = $derived(new Color(isDark ? '#00ccff' : '#6b4c0a'));
  let baseColor = $derived(new Color(isDark ? '#404040' : '#b5a48e'));
  let beatFlashColor = $derived(new Color(isDark ? '#ff2222' : '#8b3a1a'));

  const positions = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const vesselProgress = new Float32Array(MAX_PARTICLES);
  const vesselPathIdx = new Uint8Array(MAX_PARTICLES);
  const vesselLateral = new Float32Array(MAX_PARTICLES);
  const colorHueShift = new Float32Array(MAX_PARTICLES);
  const clusterSeed = new Float32Array(MAX_PARTICLES);

  for (let i = 0; i < MAX_PARTICLES; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2;
    velocities[i * 3] = (Math.random() - 0.5) * 0.008;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.008;
    velocities[i * 3 + 2] = 0;

    const r = Math.random();
    vesselPathIdx[i] = r < 0.5 ? 0 : r < 0.75 ? 1 : 2;
    vesselProgress[i] = Math.random();
    vesselLateral[i] = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    colorHueShift[i] = (Math.random() - 0.5) * 0.15;
    clusterSeed[i] = Math.floor(Math.random() * 40);
  }

  const geometry = new CircleGeometry(0.04, 16);
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.18,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
  });

  let mesh = $state.raw<InstancedMesh | undefined>(undefined);

  function getDrawCount(): number {
    const base = 200 + (biomeState.strain / 100) * (MAX_PARTICLES - 200);
    return Math.round(Math.max(50, Math.min(MAX_PARTICLES, base * settings.particleDensity)));
  }

  let shudderEnergy = 0;
  let prevBeat = 0;
  let comboMultiplier = 1.0;

  let elapsed = 0;
  useTask((delta) => {
    elapsed += delta;
    if (!mesh) return;

    const sizeMul = settings.particleSize;
    const opacityMul = settings.particleOpacity / 100;
    const windMul = settings.windEnabled ? settings.windMultiplier / 100 : 0;
    const shudderMul = settings.shudderIntensity / 100;
    const comboStrength = settings.combinationStrength / 100;
    const vesselSpeedMul = settings.bloodVesselSpeed / 100;
    const vesselSurgeMul = settings.bloodVesselSurge / 100;

    const wind = windToVector(biomeState.weather.windDirection, biomeState.weather.windSpeed);
    const windX = wind[0];
    const windY = wind[1];
    const windScale = 0.0002 * windMul;
    const drawCount = getDrawCount();
    mesh.count = drawCount;

    const globalBeat = settings.pulseEnabled ? cardiacPulse(elapsed, biomeState.pulse, settings.pulseIntensity) : 0;
    const pulseWaveSpeed = 0.3;

    if (settings.shudderEnabled && globalBeat > 0.3 && prevBeat < 0.2) {
      shudderEnergy = 1.0;
    }
    if (settings.shudderEnabled) {
      shudderEnergy *= 0.85;
    } else {
      shudderEnergy = 0;
    }
    prevBeat = globalBeat;

    if (settings.combinationEnabled) {
      const strainFactor = biomeState.strain / 100;
      const pulseFactor = Math.max(0, (biomeState.pulse - 40)) / 80;
      comboMultiplier = 1 + (strainFactor * pulseFactor) * 0.8 * comboStrength;
    } else {
      comboMultiplier = 1.0;
    }

    for (let i = 0; i < drawCount; i++) {
      const idx = i * 3;
      let beat = globalBeat;

      try {
      if (settings.bloodVesselEnabled) {
        const pIdx = vesselPathIdx[i] % 3;

        // Pulse wave: delay beat based on progress along vessel
        if (settings.pulseEnabled) {
          const delay = vesselProgress[i] * pulseWaveSpeed;
          beat = cardiacPulse(elapsed - delay, biomeState.pulse, settings.pulseIntensity);
        }

        // Flow speed: parabolic profile based on lateral offset
        const latDist = Math.abs(vesselLateral[i]);
        const flowProfile = Math.pow(Math.max(0, 1 - latDist * latDist), 2);

        const pulseSpeedMul = 1 + vesselSpeedMul * beat;
        const baseFlow = (0.003 * flowProfile + 0.0001) * pulseSpeedMul;
        const surgeFlow = 0.015 * beat * flowProfile * pulseSpeedMul * vesselSurgeMul;

        // Clustering
        const clusterPhase = clusterSeed[i] * 0.157;
        const clusterBias = Math.sin(elapsed * 0.8 + clusterPhase) * 0.001;

        vesselProgress[i] += baseFlow + surgeFlow + clusterBias;
        if (vesselProgress[i] > 1) vesselProgress[i] -= 1;
        if (vesselProgress[i] < 0) vesselProgress[i] += 1;

        // Evaluate position on path
        const pos = evalVesselPath(pIdx, vesselProgress[i]);

        // Compute tangent for lateral offset
        const pos2 = evalVesselPath(pIdx, Math.min(1, vesselProgress[i] + 0.01));
        const dx = pos2.x - pos.x;
        const dy = pos2.y - pos.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        const vesselWidth = pIdx === 0 ? 2.0 : 1.2;
        const lateralWobble = Math.sin(elapsed * 1.2 + i * 0.73) * 0.05;
        const latOffset = (vesselLateral[i] + lateralWobble) * vesselWidth;

        positions[idx] = pos.x + nx * latOffset;
        positions[idx + 1] = pos.y + ny * latOffset;
      } else {
        positions[idx] += velocities[idx] + windX * windScale;
        positions[idx + 1] += velocities[idx + 1] + windY * windScale;

        if (positions[idx] > 10) positions[idx] = -10;
        if (positions[idx] < -10) positions[idx] = 10;
        if (positions[idx + 1] > 10) positions[idx + 1] = -10;
        if (positions[idx + 1] < -10) positions[idx + 1] = 10;
      }

      // Shudder vibration
      if (settings.shudderEnabled && shudderEnergy > 0.01) {
        const particlePhase = i * 0.73;
        const vibration = Math.sin(elapsed * 35 * Math.PI * 2 + particlePhase) * shudderEnergy * 0.02 * shudderMul;
        positions[idx] += vibration;
        positions[idx + 1] += vibration * 0.7;
      }

      // Scale
      const baseRadius = (0.03 + (i % 5) * 0.006) * sizeMul;
      const scale = (baseRadius + beat * 0.019 * comboMultiplier * sizeMul) / 0.04;
      dummy.position.set(positions[idx], positions[idx + 1], positions[idx + 2]);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color — per-particle variation
      const recoveryT = biomeState.recovery / 150;
      const hueShift = colorHueShift[i];
      const restColor = baseColor.clone().lerp(peakColor, recoveryT);
      restColor.r = Math.max(0, Math.min(1, restColor.r + hueShift));
      restColor.g = Math.max(0, Math.min(1, restColor.g + hueShift * 0.3));
      const finalColor = restColor.lerp(beatFlashColor, beat * 0.875 * comboMultiplier);

      // Deoxygenation gradient in vessel mode
      if (settings.bloodVesselEnabled) {
        const oxygenation = 0.85 + vesselProgress[i] * 0.15;
        finalColor.r *= oxygenation;
        finalColor.g *= oxygenation * 0.9;
        finalColor.b *= oxygenation * 0.85;
      }

      mesh.setColorAt(i, finalColor);
      } catch { /* skip particle */ }
    }

    const baseOpacity = (isDark ? 0.25 : 0.08) * opacityMul;
    const beatOpacity = globalBeat * (isDark ? 0.5 : 0.35) * comboMultiplier * opacityMul;
    material.opacity = baseOpacity + beatOpacity;

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
