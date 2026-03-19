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
      <BiomeScene state={store.state} isDark={true} />
    </Canvas>
  {:else if store.tier === 'canvas'}
    <BiomeCssFallback state={store.state} />
  {:else}
    <BiomeReducedMotion state={store.state} />
  {/if}
</div>
