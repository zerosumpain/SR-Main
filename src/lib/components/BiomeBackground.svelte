<script lang="ts">
  import { Canvas } from '@threlte/core';
  import BiomeScene from '$lib/threlte/BiomeScene.svelte';
  import BiomeCssFallback from './BiomeCssFallback.svelte';
  import BiomeReducedMotion from './BiomeReducedMotion.svelte';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  let { store }: { store: BiomeStore } = $props();
</script>

<div class="fixed inset-0 z-0 pointer-events-none">
  {#if store.tier === 'webgl'}
    <Canvas>
      <BiomeScene biomeState={store.state} isDark={false} settings={store.settings} />
    </Canvas>
  {:else if store.tier === 'canvas'}
    <BiomeCssFallback biomeState={store.state} />
  {:else}
    <BiomeReducedMotion biomeState={store.state} />
  {/if}
</div>
