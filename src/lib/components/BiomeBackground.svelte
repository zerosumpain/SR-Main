<script lang="ts">
  import { Canvas } from '@threlte/core';
  import BiomeScene from '$lib/threlte/BiomeScene.svelte';
  import BiomeCssFallback from './BiomeCssFallback.svelte';
  import BiomeReducedMotion from './BiomeReducedMotion.svelte';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  let { store, position = 'fixed', transparent = false }: { store: BiomeStore; position?: 'fixed' | 'absolute'; transparent?: boolean } = $props();
</script>

<div class="inset-0 z-0 pointer-events-none w-full h-full" style="position: {position};">
  {#if store.tier === 'webgl'}
    <Canvas>
      <BiomeScene biomeState={store.state} isDark={false} settings={store.settings} noSky={transparent} />
    </Canvas>
  {:else if store.tier === 'canvas'}
    <BiomeCssFallback biomeState={store.state} {position} />
  {:else}
    <BiomeReducedMotion biomeState={store.state} {position} />
  {/if}
</div>
