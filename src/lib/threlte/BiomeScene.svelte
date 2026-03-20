<script lang="ts">
  import SkyPlane from './SkyPlane.svelte';
  import FogLayer from './FogLayer.svelte';
  import ParticleField from './ParticleField.svelte';
  import ConnectionLines from './ConnectionLines.svelte';
  import WeatherEffects from './WeatherEffects.svelte';
  import type { BiomeState } from '$lib/biome/state';
  import type { BiomeSettings } from '$lib/biome/settings';
  import { BIOME_SETTINGS_DEFAULTS } from '$lib/biome/settings';

  let { biomeState, isDark = true, settings }: {
    biomeState: BiomeState;
    isDark?: boolean;
    settings?: BiomeSettings;
  } = $props();

  let s = $derived(settings || BIOME_SETTINGS_DEFAULTS);
</script>

<SkyPlane {biomeState} {isDark} />
{#if s.fogEnabled}
  <FogLayer {biomeState} {isDark} fogIntensity={s.fogIntensity} dreamMode={s.dreamMode} />
{/if}
<ParticleField {biomeState} {isDark} {s} />
{#if s.connectionLinesEnabled}
  <ConnectionLines {biomeState} {isDark} />
{/if}
{#if s.weatherEnabled}
  <WeatherEffects {biomeState} {isDark} />
{/if}
