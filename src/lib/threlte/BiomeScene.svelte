<script lang="ts">
  import SkyPlane from './SkyPlane.svelte';
  import FogLayer from './FogLayer.svelte';
  import ParticleField from './ParticleField.svelte';
  import ConnectionLines from './ConnectionLines.svelte';
  import WeatherEffects from './WeatherEffects.svelte';
  import type { BiomeState } from '$lib/biome/state';

  let { biomeState, isDark = true }: { biomeState: BiomeState; isDark?: boolean } = $props();
</script>

<SkyPlane {biomeState} {isDark} />
<FogLayer {biomeState} {isDark} />
<ParticleField {biomeState} {isDark} />
<ConnectionLines {biomeState} {isDark} />
<WeatherEffects {biomeState} {isDark} />
