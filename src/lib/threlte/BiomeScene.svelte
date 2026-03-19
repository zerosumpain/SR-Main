<script lang="ts">
  import SkyPlane from './SkyPlane.svelte';
  import FogLayer from './FogLayer.svelte';
  import ParticleField from './ParticleField.svelte';
  import ConnectionLines from './ConnectionLines.svelte';
  import WeatherEffects from './WeatherEffects.svelte';
  import type { BiomeState } from '$lib/biome/state';

  let { state, isDark = true }: { state: BiomeState; isDark?: boolean } = $props();
</script>

<SkyPlane {state} {isDark} />
<FogLayer {state} {isDark} />
<ParticleField {state} {isDark} />
<ConnectionLines {state} {isDark} />
<WeatherEffects {state} {isDark} />
